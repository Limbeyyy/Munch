"""What the host is asked to decide, and what became of each decision.

The moderation screen reads one event and shows three piles of the same
thing: waiting, put up, turned down. Two things have to hold for it to be
readable at all - a message has to remember which talk was on stage when
it was written, and it has to remember what the writer offered it as.
Without the first the screen cannot group anything; without the second a
pending entry cannot be filed under questions or under suggestions,
because nobody has said which it is yet.
"""
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.models import (
    ChatMessage, Event, EventParticipant, Session,
)
from src.apps.meetings.tests.factories import make_host, make_event, make_session
from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns


def app():
    return JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns))


class Room:
    """A live event with a host, a speaker and somebody in the audience."""

    def build(self):
        self.host = make_host('host@example.com')
        self.speaker = make_host('speaker@example.com')
        self.attendee = make_host('attendee@example.com')

        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.chat_enabled = True
        self.event.direct_messages_enabled = True
        self.event.save()

        self.opening = make_session(
            self.event, start, 60, 'Field Response Coordination',
            status=Session.Status.LIVE,
        )
        self.later = make_session(
            self.event, start + timezone.timedelta(minutes=60), 60,
            'Resource Allocation',
        )

        for user, role in (
            (self.host, EventParticipant.Role.HOST),
            (self.speaker, EventParticipant.Role.PRESENTER),
            (self.attendee, EventParticipant.Role.ATTENDEE),
        ):
            EventParticipant.objects.create(
                event=self.event, user=user, role=role, is_active=True
            )


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class WhatItWasOfferedAsTests(Room, TransactionTestCase):
    def setUp(self):
        self.build()

    async def ask(self, body, topic):
        token = str(AccessToken.for_user(self.attendee))
        comm = WebsocketCommunicator(
            app(), f'/ws/event/{self.event.code}/?token={token}'
        )
        connected, _ = await comm.connect()
        assert connected, 'the attendee could not reach the room'
        await comm.send_json_to({
            'type': 'chat_message', 'message': body,
            'recipient_id': str(self.host.id), 'topic': topic,
        })
        for _ in range(4):
            said = await comm.receive_json_from()
            if said.get('type') in ('chat_message', 'chat_pending'):
                break
        await comm.disconnect()

    def topic_of(self, body):
        return ChatMessage.objects.get(body=body).topic

    async def test_a_question_arrives_already_filed_as_one(self):
        """The gap this closes.

        The composer sits under the questions board or the suggestions
        board, so the writer has already said which they meant. That was
        being thrown away, and a message waiting for review belonged to
        neither tab of the screen that is meant to review it.
        """
        await self.ask('Why this budget?', 'faq')

        filed = await database_sync_to_async(self.topic_of)('Why this budget?')
        self.assertEqual(filed, ChatMessage.Topic.FAQ)

    async def test_and_a_suggestion_as_a_suggestion(self):
        await self.ask('Print the maps larger', 'suggestion')

        filed = await database_sync_to_async(self.topic_of)('Print the maps larger')
        self.assertEqual(filed, ChatMessage.Topic.SUGGESTION)

    async def test_a_topic_nobody_recognises_files_it_under_nothing(self):
        await self.ask('Hello', 'announcement')

        filed = await database_sync_to_async(self.topic_of)('Hello')
        self.assertEqual(filed, ChatMessage.Topic.NONE)

    async def test_and_it_stays_off_the_board_until_the_host_says_so(self):
        """Carrying a topic is not publishing. Only approval is."""
        from src.apps.meetings.board import board_for

        await self.ask('Why this budget?', 'faq')

        board = await database_sync_to_async(board_for)(self.event)
        self.assertEqual(board['faq'], [])

    async def test_it_remembers_what_was_on_stage(self):
        await self.ask('Why this budget?', 'faq')

        said = await database_sync_to_async(
            lambda: ChatMessage.objects.get(body='Why this budget?').session_id
        )()
        self.assertEqual(said, self.opening.id)


class TheQueueTests(Room, TestCase):
    """The three piles, as the screen reads them."""

    def setUp(self):
        self.build()
        self.client = APIClient()
        self.client.force_authenticate(self.host)

    def write(self, body, **over):
        fields = {
            'event': self.event, 'sender': self.attendee,
            'session': self.opening, 'body': body,
            'topic': ChatMessage.Topic.FAQ,
            'moderation_status': ChatMessage.Moderation.PENDING,
        }
        fields.update(over)
        return ChatMessage.objects.create(**fields)

    def read(self):
        return self.client.get(
            f'/api/v1/events/{self.event.id}/moderation_queue/'
        )

    def test_it_sorts_by_what_became_of_each_one(self):
        self.write('Waiting on you')
        self.write('Put up', moderation_status=ChatMessage.Moderation.APPROVED)
        self.write('Turned down', moderation_status=ChatMessage.Moderation.DECLINED)

        got = self.read()

        self.assertEqual(got.status_code, 200)
        self.assertEqual([r['body'] for r in got.data['pending']], ['Waiting on you'])
        self.assertEqual([r['body'] for r in got.data['approved']], ['Put up'])
        self.assertEqual([r['body'] for r in got.data['rejected']], ['Turned down'])

    def test_each_entry_names_the_talk_it_was_asked_during(self):
        self.write('Why this budget?')

        entry = self.read().data['pending'][0]

        self.assertEqual(entry['session'], self.opening.id)
        self.assertEqual(entry['session_title'], 'Field Response Coordination')

    def test_it_lists_the_running_order_to_group_them_under(self):
        got = self.read()

        self.assertEqual(
            [one['title'] for one in got.data['sessions']],
            ['Field Response Coordination', 'Resource Allocation'],
        )

    def test_something_already_decided_says_who_decided_it(self):
        self.write(
            'Put up', moderation_status=ChatMessage.Moderation.APPROVED,
            moderated_by=self.host, moderated_at=timezone.now(),
        )

        entry = self.read().data['approved'][0]

        self.assertEqual(entry['moderated_by_name'], self.host.display_name
                         or self.host.email)
        self.assertIsNotNone(entry['moderated_at'])

    def test_what_was_removed_is_in_none_of_the_piles(self):
        """Removed is discarded, not turned down. It is not a decision to show."""
        self.write('Gone', moderation_status=ChatMessage.Moderation.REMOVED)

        got = self.read().data

        self.assertEqual(got['pending'] + got['approved'] + got['rejected'], [])

    def test_nobody_but_the_host_reads_it(self):
        self.client.force_authenticate(self.attendee)

        self.assertEqual(self.read().status_code, 403)
