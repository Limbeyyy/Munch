"""Ending a meeting must empty the room, not just close the books.

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
    GuestAttendee, Meeting, MeetingParticipant, Session,
)
from src.apps.meetings.tests.factories import make_host, make_meeting, make_session
from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns

API = '/api/v1'


def app():
    return JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns))


async def joined(meeting, user):
    """A signed-in person's socket, connected to the room."""
    token = str(AccessToken.for_user(user))
    comm = WebsocketCommunicator(
        app(), f'/ws/meeting/{meeting.meeting_code}/?token={token}'
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
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.save()
        self.session = make_session(
            self.meeting, start, 60, 'Haldi', status=Session.Status.LIVE
        )
        self.session.started_at = start
        self.session.save()

        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )

    def end_it(self):
        from django.test import Client
        client = Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
            HTTP_HOST='localhost',
        )
        return client.post(f'{API}/meetings/{self.meeting.id}/end/')

    async def test_the_room_is_told_and_the_socket_is_shut(self):
        comm = await joined(self.meeting, self.attendee)
        # The socket announces the arrival to the room; that is not the news.
        await comm.receive_json_from()

        response = await database_sync_to_async(self.end_it)()
        self.assertEqual(response.status_code, 200)

        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'meeting_ended')
        self.assertEqual(said['reason'], 'host_ended')

        # Shut by the server, so a client that ignores the message still
        # leaves the room.
        shut = await comm.receive_output()
        self.assertEqual(shut['type'], 'websocket.close')
        await comm.disconnect()

    async def test_a_guest_is_evicted_too(self):
        guest = await database_sync_to_async(GuestAttendee.objects.create)(
            meeting=self.meeting, full_name='Bishnu', phone='9812345678',
            status=GuestAttendee.Status.ADMITTED,
        )
        from src.apps.meetings.guest_tokens import make_guest_token

        token = await database_sync_to_async(make_guest_token)(guest)
        comm = WebsocketCommunicator(
            app(), f'/ws/meeting/{self.meeting.meeting_code}/?guest_token={token}'
        )
        connected, _ = await comm.connect()
        self.assertTrue(connected)

        await database_sync_to_async(self.end_it)()

        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'meeting_ended')
        await comm.disconnect()

    async def test_the_room_is_emptied_when_the_time_runs_out(self):
        # Not the host's button: the sweep that closes a session whose slot
        # has gone. That path closed the books and left everybody sitting
        # in a meeting that had ended.
        from src.apps.meetings.lifecycle import sweep_expired

        def wind_forward():
            past = timezone.now() - timezone.timedelta(hours=3)
            self.session.starts_at = past
            self.session.duration_minutes = 30
            self.session.save()
            self.meeting.scheduled_end = past + timezone.timedelta(minutes=30)
            self.meeting.save()

        await database_sync_to_async(wind_forward)()
        comm = await joined(self.meeting, self.attendee)
        await comm.receive_json_from()

        closed = await database_sync_to_async(sweep_expired)()
        self.assertEqual(closed, 1)

        # The session going off stage is announced first; the room being
        # shut follows it.
        first = await comm.receive_json_from()
        self.assertEqual(first['type'], 'state_update')
        self.assertTrue(first['state'].get('session_ended'))

        said = await comm.receive_json_from()
        self.assertEqual(said['type'], 'meeting_ended')
        self.assertEqual(said['reason'], 'time_elapsed')
        await comm.disconnect()

        left = await database_sync_to_async(
            lambda: MeetingParticipant.objects.filter(
                meeting=self.meeting, is_active=True
            ).count()
        )()
        self.assertEqual(left, 0)

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

    async def test_ending_the_last_session_by_hand_shuts_the_room_at_once(self):
        # Not at half past when the meeting's own window closes: the host
        # has said it is over, so everybody is told now.
        comm = await joined(self.meeting, self.attendee)
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
        self.assertTrue(response.json()['meeting_ended'])
        self.assertEqual(response.json()['meeting_status'], Meeting.Status.ENDED)

        seen = set()
        for _ in range(4):
            said = await comm.receive_json_from()
            seen.add(said['type'])
            if said['type'] == 'meeting_ended':
                break
        self.assertIn('meeting_ended', seen)
        await comm.disconnect()

    def test_the_meeting_stays_open_while_a_session_is_still_to_come(self):
        # Ending the first of two is not ending the meeting.
        later = make_session(
            self.meeting,
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

        self.assertFalse(body['meeting_ended'])
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.status, Meeting.Status.ACTIVE)
        self.assertTrue(later.id)

    def test_the_register_survives_the_room_being_emptied_that_way(self):
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
        self.assertFalse(
            MeetingParticipant.objects.filter(
                meeting=self.meeting, is_active=True
            ).exists()
        )

    def test_the_books_are_closed_as_well(self):
        self.end_it()

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.status, Meeting.Status.ENDED)
        self.assertFalse(
            MeetingParticipant.objects.filter(meeting=self.meeting, is_active=True).exists()
        )
