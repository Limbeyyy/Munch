"""What reaches the host's queue, and what goes straight through.

Everything written in the room is written to somebody - the host or a
speaker - and the host decides what becomes of each one: a question for
the board, a suggestion, or nothing. That decision is only possible for
messages that are held for it, so which ones are held is the whole of
this.

Driven over real websockets against the real consumer, because the rule
lives in the thing that saves the message and nowhere else.
"""
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.models import (
    ChatMessage, GuestAttendee, Meeting, MeetingParticipant, Session,
)
from src.apps.meetings.tests.factories import make_host, make_meeting, make_session
from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns


def app():
    return JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns))


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class WhatTheHostIsAskedToSortTests(TransactionTestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.speaker = make_host('speaker@example.com')
        self.attendee = make_host('attendee@example.com')

        start = timezone.now() - timezone.timedelta(minutes=10)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.chat_enabled = True
        self.meeting.direct_messages_enabled = True
        self.meeting.save()
        make_session(self.meeting, start, 60, 'Haldi', status=Session.Status.LIVE)

        for user, role in (
            (self.host, MeetingParticipant.Role.HOST),
            (self.speaker, MeetingParticipant.Role.PRESENTER),
            (self.attendee, MeetingParticipant.Role.ATTENDEE),
        ):
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=user, role=role, is_active=True
            )

    async def speaking_as(self, user):
        token = str(AccessToken.for_user(user))
        comm = WebsocketCommunicator(
            app(), f'/ws/meeting/{self.meeting.meeting_code}/?token={token}'
        )
        connected, _ = await comm.connect()
        assert connected, f'{user.email} could not reach the room'
        return comm

    async def as_a_guest(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        guest = await database_sync_to_async(GuestAttendee.objects.create)(
            meeting=self.meeting, full_name='Bishnu Prasad',
            status=GuestAttendee.Status.ADMITTED,
        )
        token = await database_sync_to_async(make_guest_token)(guest)
        comm = WebsocketCommunicator(
            app(), f'/ws/meeting/{self.meeting.meeting_code}/?guest_token={token}'
        )
        connected, _ = await comm.connect()
        assert connected, 'the guest could not reach the room'
        return comm

    async def write(self, comm, body, to):
        await comm.send_json_to({
            'type': 'chat_message', 'message': body, 'recipient_id': str(to.id),
        })
        # The sender's own copy comes back either way; the status on it is
        # what says whether it is waiting.
        for _ in range(4):
            said = await comm.receive_json_from()
            if said.get('type') in ('chat_message', 'chat_pending'):
                return said
        raise AssertionError('the room said nothing about that message')

    def status_of(self, body):
        return ChatMessage.objects.get(body=body).moderation_status

    # -- what is held -----------------------------------------------------

    async def test_a_question_put_to_the_host_waits_for_sorting(self):
        """The gap this closes.

        A message to the host went straight through, so it never reached
        the queue and could never be put up as a question - which is the
        one thing most likely to be asked of a host.
        """
        comm = await self.speaking_as(self.attendee)

        await self.write(comm, 'Why this budget?', to=self.host)
        await comm.disconnect()

        held = await database_sync_to_async(self.status_of)('Why this budget?')
        self.assertEqual(held, ChatMessage.Moderation.PENDING)

    async def test_and_so_does_one_put_to_the_speaker(self):
        comm = await self.speaking_as(self.attendee)

        await self.write(comm, 'Could you repeat the figure?', to=self.speaker)
        await comm.disconnect()

        held = await database_sync_to_async(self.status_of)(
            'Could you repeat the figure?'
        )
        self.assertEqual(held, ChatMessage.Moderation.PENDING)

    async def test_a_guest_is_treated_as_anybody_else_in_the_room(self):
        comm = await self.as_a_guest()

        await self.write(comm, 'Please slow the transcript down', to=self.host)
        await comm.disconnect()

        held = await database_sync_to_async(self.status_of)(
            'Please slow the transcript down'
        )
        self.assertEqual(held, ChatMessage.Moderation.PENDING)

    async def test_the_host_still_sees_it_at_once(self):
        # Holding it is not hiding it from them: it is asking what the room
        # should be shown, not whether they may read it.
        watching = await self.speaking_as(self.host)
        await watching.receive_json_from()  # their own arrival
        writing = await self.speaking_as(self.attendee)
        await watching.receive_json_from()  # and the attendee's

        await self.write(writing, 'Why this budget?', to=self.host)

        said = await watching.receive_json_from()
        self.assertEqual(said['type'], 'chat_pending')
        self.assertEqual(said['message'], 'Why this budget?')
        await watching.disconnect()
        await writing.disconnect()

    # -- what is not ------------------------------------------------------

    async def test_the_desk_and_the_front_of_the_room_talk_freely(self):
        # Nobody moderates the host writing to their speaker.
        comm = await self.speaking_as(self.host)

        await self.write(comm, 'Five minutes left', to=self.speaker)
        await comm.disconnect()

        sent = await database_sync_to_async(self.status_of)('Five minutes left')
        self.assertEqual(sent, ChatMessage.Moderation.NOT_REQUIRED)

    async def test_nor_a_speaker_answering_the_desk(self):
        comm = await self.speaking_as(self.speaker)

        await self.write(comm, 'Understood', to=self.host)
        await comm.disconnect()

        sent = await database_sync_to_async(self.status_of)('Understood')
        self.assertEqual(sent, ChatMessage.Moderation.NOT_REQUIRED)


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class SortingFromTheQueueTests(TransactionTestCase):
    """And what the host can then do with one, which is the point of holding it."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.chat_enabled = True
        self.meeting.direct_messages_enabled = True
        self.meeting.save()
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )
        self.asked = ChatMessage.objects.create(
            meeting=self.meeting, sender=self.attendee, recipient=self.host,
            body='Why this budget?',
            moderation_status=ChatMessage.Moderation.PENDING,
        )

    def as_host(self):
        from django.test import Client

        return Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}',
            HTTP_HOST='localhost',
        )

    def test_it_is_in_the_queue_the_room_reads(self):
        waiting = self.as_host().get(
            f'/api/v1/meetings/{self.meeting.id}/pending_messages/'
        ).json()

        self.assertEqual([m['body'] for m in waiting], ['Why this budget?'])

    def sort(self, decision, topic=None):
        body = {'message_id': str(self.asked.id), 'decision': decision}
        if topic:
            body['topic'] = topic
        return self.as_host().post(
            f'/api/v1/meetings/{self.meeting.id}/moderate_message/',
            body, content_type='application/json',
        )

    def test_one_press_puts_it_up_as_a_question(self):
        response = self.sort('approve', 'faq')

        self.assertEqual(response.status_code, 200)
        self.asked.refresh_from_db()
        self.assertEqual(self.asked.moderation_status, ChatMessage.Moderation.APPROVED)
        self.assertEqual(self.asked.topic, ChatMessage.Topic.FAQ)

    def test_or_as_a_suggestion(self):
        response = self.sort('approve', 'suggestion')

        self.assertEqual(response.status_code, 200)
        self.asked.refresh_from_db()
        self.assertEqual(self.asked.topic, ChatMessage.Topic.SUGGESTION)

    def test_and_then_the_room_can_read_it(self):
        self.sort('approve', 'faq')

        board = self.as_host().get(
            f'/api/v1/meetings/{self.meeting.id}/board/'
        ).json()

        self.assertEqual([q['body'] for q in board['faq']], ['Why this budget?'])

    def test_or_it_stays_between_the_two_of_them(self):
        self.sort('decline')

        self.asked.refresh_from_db()
        self.assertEqual(self.asked.moderation_status, ChatMessage.Moderation.DECLINED)
        board = self.as_host().get(
            f'/api/v1/meetings/{self.meeting.id}/board/'
        ).json()
        self.assertEqual(board['faq'], [])
        self.assertEqual(board['suggestions'], [])


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class WritingToSomebodyWhoSteppedOutTests(TransactionTestCase):
    """You write to a person, not to a socket.

    The recipient had to be connected at that instant or the message was
    refused - "Could not send message", with nothing to say why. A host who
    shut their tab for five minutes is still the host, the chat still
    offers them, and what is written to them should wait rather than
    bounce.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.chat_enabled = True
        self.meeting.direct_messages_enabled = True
        self.meeting.save()
        make_session(self.meeting, start, 60, 'Haldi', status=Session.Status.LIVE)

        # The host's own row, left behind when they closed the tab.
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.host,
            role=MeetingParticipant.Role.HOST, is_active=False,
        )
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )

    async def write(self, comm, body, to_id):
        await comm.send_json_to({
            'type': 'chat_message', 'message': body, 'recipient_id': str(to_id),
        })
        for _ in range(4):
            said = await comm.receive_json_from()
            if said.get('type') in ('chat_message', 'chat_pending', 'chat_error'):
                return said
        raise AssertionError('the room said nothing about that message')

    async def speaking_as(self, user):
        token = str(AccessToken.for_user(user))
        comm = WebsocketCommunicator(
            app(), f'/ws/meeting/{self.meeting.meeting_code}/?token={token}'
        )
        connected, _ = await comm.connect()
        assert connected
        return comm

    async def test_a_message_to_a_host_who_is_away_is_taken(self):
        comm = await self.speaking_as(self.attendee)

        said = await self.write(comm, 'Why this budget?', self.host.id)
        await comm.disconnect()

        self.assertNotEqual(said.get('type'), 'chat_error')
        held = await database_sync_to_async(
            lambda: ChatMessage.objects.get(body='Why this budget?')
        )()
        self.assertEqual(held.recipient_id, self.host.id)

    async def test_and_waits_for_them_rather_than_bouncing(self):
        comm = await self.speaking_as(self.attendee)

        await self.write(comm, 'Waiting here', self.host.id)
        await comm.disconnect()

        status = await database_sync_to_async(
            lambda: ChatMessage.objects.get(body='Waiting here').moderation_status
        )()
        self.assertEqual(status, ChatMessage.Moderation.PENDING)

    async def test_a_guest_who_stepped_out_can_still_be_answered(self):
        guest = await database_sync_to_async(GuestAttendee.objects.create)(
            meeting=self.meeting, full_name='Bishnu Prasad',
            status=GuestAttendee.Status.LEFT,
        )
        comm = await self.speaking_as(self.host)

        said = await self.write(comm, 'You asked about the hall', guest.id)
        await comm.disconnect()

        self.assertNotEqual(said.get('type'), 'chat_error')

    async def test_somebody_who_was_never_in_this_meeting_still_is_not(self):
        stranger = await database_sync_to_async(make_host)('stranger@example.com')
        comm = await self.speaking_as(self.attendee)

        said = await self.write(comm, 'Hello?', stranger.id)
        await comm.disconnect()

        self.assertEqual(said.get('type'), 'chat_error')
