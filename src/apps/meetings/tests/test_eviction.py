"""Ending a event must empty the room, not just close the books.

Attendance is taken from whoever is present when a session closes, so the
room is deliberately cleared after that snapshot - but it must actually be
cleared. These drive real websockets against the real consumer, because the
part that was missing before was never the database row.
"""
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.models import (
    GuestAttendee, Event, EventParticipant, Session,
)
from src.apps.meetings.tests.factories import make_host, make_event, make_session
from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns

API = '/api/v1'


def app():
    return JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns))


async def joined(event, user):
    """A signed-in person's socket, connected to the room."""
    token = str(AccessToken.for_user(user))
    comm = WebsocketCommunicator(
        app(), f'/ws/event/{event.code}/?token={token}'
    )
    connected, _ = await comm.connect()
    assert connected, 'the attendee could not reach the room'
    return comm


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class EvictionTests(TransactionTestCase):
    """The whole path: the host's request, the room's sockets."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(
            self.event, start, 60, 'Haldi', status=Session.Status.LIVE
        )
        self.session.started_at = start
        self.session.save()

        EventParticipant.objects.create(
            event=self.event, user=self.attendee,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

    def end_it(self):
        from django.test import Client
        client = Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
            HTTP_HOST='localhost',
        )
        return client.post(f'{API}/events/{self.event.id}/end/')

    async def test_the_room_is_told_and_the_socket_is_shut(self):
        comm = await joined(self.event, self.attendee)
        # The socket announces the arrival to the room; that is not the news.
        await comm.receive_json_from()

        response = await database_sync_to_async(self.end_it)()
        self.assertEqual(response.status_code, 200)

        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'event_ended')
        self.assertEqual(said['reason'], 'host_ended')

        # Shut by the server, so a client that ignores the message still
        # leaves the room.
        shut = await comm.receive_output()
        self.assertEqual(shut['type'], 'websocket.close')
        await comm.disconnect()

    async def test_a_guest_is_evicted_too(self):
        guest = await database_sync_to_async(GuestAttendee.objects.create)(
            event=self.event, full_name='Bishnu', phone='9812345678',
            status=GuestAttendee.Status.ADMITTED,
        )
        from src.apps.meetings.guest_tokens import make_guest_token

        token = await database_sync_to_async(make_guest_token)(guest)
        comm = WebsocketCommunicator(
            app(), f'/ws/event/{self.event.code}/?guest_token={token}'
        )
        connected, _ = await comm.connect()
        self.assertTrue(connected)

        await database_sync_to_async(self.end_it)()

        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'event_ended')
        await comm.disconnect()

    async def test_the_room_is_not_emptied_when_its_hour_passes(self):
        """The reported case, from the guest's side.

        A guest sat in a room where nothing was on stage - the talk had
        finished and the host had not started the next - and was thrown
        out, by their own page asking how things were. A event's closing
        time is a plan like everything else on the timetable. The host ends
        the event; until then everybody in it stays in it.
        """
        def wind_forward():
            past = timezone.now() - timezone.timedelta(hours=2)
            self.session.starts_at = past
            self.session.duration_minutes = 30
            self.session.status = Session.Status.DONE
            self.session.started_at = past
            self.session.ended_at = past + timezone.timedelta(minutes=30)
            self.session.save()
            self.event.scheduled_end = past + timezone.timedelta(minutes=30)
            self.event.save()

        def read_everything():
            from django.test import Client

            client = Client(
                HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
                HTTP_HOST='localhost',
            )
            return client.get(f'{API}/events/{self.event.id}/').status_code

        await database_sync_to_async(wind_forward)()
        self.assertEqual(await database_sync_to_async(read_everything)(), 200)

        state = await database_sync_to_async(
            lambda: Event.objects.get(id=self.event.id).status
        )()
        self.assertEqual(state, Event.Status.ACTIVE)

        still_in = await database_sync_to_async(
            lambda: EventParticipant.objects.filter(
                event=self.event, is_active=True
            ).count()
        )()
        self.assertEqual(still_in, 1)

    async def test_but_a_talk_still_on_stage_keeps_the_room_open(self):
        # The window has passed and somebody is still speaking. The room is
        # theirs until they are done with it.
        def wind_forward():
            past = timezone.now() - timezone.timedelta(hours=2)
            self.event.scheduled_end = past
            self.event.save()

        def read_the_meeting():
            from django.test import Client

            client = Client(
                HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
                HTTP_HOST='localhost',
            )
            return client.get(f'{API}/events/{self.event.id}/')

        await database_sync_to_async(wind_forward)()
        await database_sync_to_async(read_the_meeting)()

        still = await database_sync_to_async(
            lambda: Event.objects.get(id=self.event.id).status
        )()
        self.assertEqual(still, Event.Status.ACTIVE)

    def test_the_register_is_taken_before_the_room_is_emptied(self):
        # The order matters and nothing else here proves it: attendance is
        # whoever is present when the session closes.
        from src.apps.meetings.models import SessionAttendance

        self.end_it()

        self.assertEqual(
            SessionAttendance.objects.filter(
                session=self.session, user=self.attendee
            ).count(),
            1,
        )

    async def test_ending_the_last_session_leaves_the_room_standing(self):
        """The room is the event's, and it outlives every talk in it.

        Ending a session ends the session - its transcript, its chat and
        its resources are closed off and belong to it. The room goes on,
        offering the host another one to start. Only the host ending the
        event empties it.
        """
        comm = await joined(self.event, self.attendee)
        await comm.receive_json_from()

        def end_session():
            from django.test import Client

            client = Client(
                HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
                HTTP_HOST='localhost',
            )
            return client.post(f'{API}/sessions/{self.session.id}/end/')

        response = await database_sync_to_async(end_session)()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['event_ended'])
        self.assertEqual(response.json()['event_status'], Event.Status.ACTIVE)

        # The room hears the session go off stage, and nothing else.
        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'state_update')
        self.assertTrue(said['state'].get('session_ended'))
        await comm.disconnect()

        still_in = await database_sync_to_async(
            lambda: EventParticipant.objects.filter(
                event=self.event, is_active=True
            ).count()
        )()
        self.assertEqual(still_in, 1)

    def test_the_meeting_stays_open_while_a_session_is_still_to_come(self):
        # Ending the first of two is not ending the event.
        later = make_session(
            self.event,
            timezone.now() + timezone.timedelta(hours=1),
            60,
            'Sagun',
        )
        from django.test import Client

        client = Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
            HTTP_HOST='localhost',
        )
        body = client.post(f'{API}/sessions/{self.session.id}/end/').json()

        self.assertFalse(body['event_ended'])
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.Status.ACTIVE)
        self.assertTrue(later.id)

    def test_the_register_is_taken_without_emptying_the_room(self):
        # Attendance for the talk is settled the moment it closes; the
        # people it counted are still in the room for the next one.
        from src.apps.meetings.models import SessionAttendance
        from django.test import Client

        client = Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
            HTTP_HOST='localhost',
        )
        client.post(f'{API}/sessions/{self.session.id}/end/')

        self.assertTrue(
            SessionAttendance.objects.filter(
                session=self.session, user=self.attendee
            ).exists()
        )
        self.assertTrue(
            EventParticipant.objects.filter(
                event=self.event, is_active=True
            ).exists()
        )

    def test_the_books_are_closed_as_well(self):
        self.end_it()

        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.Status.ENDED)
        self.assertFalse(
            EventParticipant.objects.filter(event=self.event, is_active=True).exists()
        )
