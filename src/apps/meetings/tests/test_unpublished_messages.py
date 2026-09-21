"""What survives an event is exactly what its board says.

A message is written to be put up. If the host puts it up it becomes a
question or a suggestion and belongs to the event's record; if they
decline it, or never get to it before the day is over, there is nothing
to keep - it was never read by anybody but them, and this system holds
no private messages.
"""
from django.test import TestCase
from django.utils import timezone

from src.apps.meetings.lifecycle import discard_unpublished
from src.apps.meetings.models import ChatMessage, Event
from src.apps.meetings.services.event_service import EventService
from src.apps.meetings.tests.factories import make_event, make_host


class DiscardUnpublishedTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.someone = make_host('asker@example.com')
        self.event = make_event(self.host, start=timezone.now())

    def wrote(self, **over):
        fields = {
            'event': self.event,
            'sender': self.someone,
            'body': 'when is the reception?',
            'topic': ChatMessage.Topic.NONE,
            'moderation_status': ChatMessage.Moderation.PENDING,
        }
        fields.update(over)
        return ChatMessage.objects.create(**fields)

    def test_a_question_the_host_put_up_is_kept(self):
        kept = self.wrote(
            topic=ChatMessage.Topic.FAQ,
            moderation_status=ChatMessage.Moderation.APPROVED,
        )

        discard_unpublished(self.event)

        self.assertTrue(ChatMessage.objects.filter(id=kept.id).exists())

    def test_a_suggestion_the_host_put_up_is_kept(self):
        kept = self.wrote(
            topic=ChatMessage.Topic.SUGGESTION,
            moderation_status=ChatMessage.Moderation.APPROVED,
        )

        discard_unpublished(self.event)

        self.assertTrue(ChatMessage.objects.filter(id=kept.id).exists())

    def test_one_still_waiting_is_thrown_away(self):
        waiting = self.wrote()

        discard_unpublished(self.event)

        self.assertFalse(ChatMessage.objects.filter(id=waiting.id).exists())

    def test_one_the_host_declined_is_thrown_away(self):
        declined = self.wrote(
            moderation_status=ChatMessage.Moderation.DECLINED
        )

        discard_unpublished(self.event)

        self.assertFalse(ChatMessage.objects.filter(id=declined.id).exists())

    def test_one_let_through_but_never_filed_goes_too(self):
        # Approved without a topic never reached the board, so nobody
        # but the host ever read it.
        loose = self.wrote(
            moderation_status=ChatMessage.Moderation.APPROVED,
            topic=ChatMessage.Topic.NONE,
        )

        discard_unpublished(self.event)

        self.assertFalse(ChatMessage.objects.filter(id=loose.id).exists())

    def test_another_event_is_left_alone(self):
        elsewhere = make_event(self.host, start=timezone.now())
        theirs = ChatMessage.objects.create(
            event=elsewhere, sender=self.someone, body='not mine',
            topic=ChatMessage.Topic.NONE,
        )

        discard_unpublished(self.event)

        self.assertTrue(ChatMessage.objects.filter(id=theirs.id).exists())

    def test_ending_the_event_does_it(self):
        waiting = self.wrote()
        kept = self.wrote(topic=ChatMessage.Topic.FAQ)
        self.event.status = Event.Status.ACTIVE
        self.event.save(update_fields=['status'])

        EventService.end_event(str(self.event.id))

        self.assertFalse(ChatMessage.objects.filter(id=waiting.id).exists())
        self.assertTrue(ChatMessage.objects.filter(id=kept.id).exists())
