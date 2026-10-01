"""What the room asked outlives the afternoon it was asked in.

Two kinds of person write into the hub, and they used to lose their
words two different ways.

A guest's were deleted. Guest rows are forgotten when the hall empties
- rightly, a name given at a door is not a relationship with this
platform - and HubPost.guest cascaded, so the questions went with
them. One a host had not got to yet was gone for good.

An account holder's survived in the table but could not be reached:
the hub's door closed when the event ended, and the host had no screen
they ever appeared on, so they were never decided either.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.meetings.lifecycle import forget_guests
from src.apps.meetings.models import (
    Event, GuestAttendee, HubPost,
)
from src.apps.meetings.tests.factories import make_event, make_host

User = get_user_model()
API = '/api/v1'


class AGuestsQuestionsTests(APITestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(hours=3)
        self.event = make_event(self.host, start=start, minutes=120)
        self.guest = GuestAttendee.objects.create(
            event=self.event, full_name='Rahul Ingnam',
            status=GuestAttendee.Status.ADMITTED,
            decided_at=start,
        )
        self.asked = HubPost.objects.create(
            event=self.event, guest=self.guest,
            kind=HubPost.Kind.QUESTION, body='What is Kataho?',
            status=HubPost.Status.PENDING,
        )
        self.suggested = HubPost.objects.create(
            event=self.event, guest=self.guest,
            kind=HubPost.Kind.SUGGESTION, body='Do this proper',
            status=HubPost.Status.LOOKING,
        )

    def end_it(self):
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()
        forget_guests(self.event)

    def test_the_question_is_still_there_once_they_are_forgotten(self):
        self.end_it()

        self.assertTrue(HubPost.objects.filter(id=self.asked.id).exists())

    def test_and_the_suggestion(self):
        self.end_it()

        self.assertTrue(HubPost.objects.filter(id=self.suggested.id).exists())

    def test_the_guest_row_itself_is_still_forgotten(self):
        """Keeping their words is not a reason to keep them."""
        self.end_it()

        self.assertFalse(
            GuestAttendee.objects.filter(id=self.guest.id).exists()
        )

    def test_it_keeps_their_name(self):
        self.end_it()

        self.asked.refresh_from_db()
        self.assertEqual(self.asked.author_label, 'Rahul Ingnam')

    def test_the_host_can_still_decide_it_afterwards(self):
        self.end_it()
        self.client.force_authenticate(self.host)

        answer = self.client.post(
            f'{API}/events/{self.event.id}/moderate_message/',
            {'message_id': str(self.asked.id), 'decision': 'approve'},
            format='json',
        )

        self.assertEqual(answer.status_code, 200, answer.content)
        self.asked.refresh_from_db()
        self.assertEqual(self.asked.status, HubPost.Status.PUBLISHED)

    def test_and_it_is_waiting_on_their_screen_to_be_decided(self):
        self.end_it()
        self.client.force_authenticate(self.host)

        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        waiting = [r['body'] for r in body['pending']]
        self.assertIn('What is Kataho?', waiting)
        self.assertIn('Do this proper', waiting)

    def test_the_name_is_shown_against_it_on_that_screen(self):
        self.end_it()
        self.client.force_authenticate(self.host)

        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        row = next(r for r in body['pending'] if r['body'] == 'What is Kataho?')
        self.assertEqual(row['sender_name'], 'Rahul Ingnam')


class AnAccountHoldersQuestionsTests(APITestCase):
    """Never deleted; they simply could not be reached."""

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(hours=3)
        self.event = make_event(self.host, start=start, minutes=120)
        self.asker = User.objects.create_user(
            username='asker', email='asker@gmail.com', password='pw'
        )
        self.event.invites.create(email='asker@gmail.com')
        self.asked = HubPost.objects.create(
            event=self.event, user=self.asker,
            kind=HubPost.Kind.QUESTION, body='What is Kataho?',
            status=HubPost.Status.PENDING,
        )
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()
        forget_guests(self.event)

    def test_it_survives_the_end_of_the_event(self):
        self.assertTrue(HubPost.objects.filter(id=self.asked.id).exists())

    def test_it_is_waiting_on_the_host_s_screen(self):
        self.client.force_authenticate(self.host)

        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        self.assertIn('What is Kataho?', [r['body'] for r in body['pending']])

    def test_and_the_asker_can_still_read_their_own(self):
        self.client.force_authenticate(self.asker)

        board = self.client.get(f'{API}/events/{self.event.code}/hub/').json()

        self.assertIn(
            'What is Kataho?', [q['body'] for q in board['questions']]
        )
