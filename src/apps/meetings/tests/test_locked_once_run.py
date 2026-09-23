"""What can no longer be changed once it has happened.

A plan is editable because it is a plan. The moment an event opens, its
hour stops being a proposal: people came at it, the register is timed
from it, and the running order was laid out against it. The same goes
for a talk that has run - attendance was taken against the hour it
actually ran at, and for the speaker who actually gave it.

What each produced is a different matter and stays open, because it
arrives after the fact by design: summaries, files and photographs.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import Event, Session
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class AnEventThatHasOpenedTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.start = timezone.now() - timezone.timedelta(hours=1)
        self.event = make_event(self.host, start=self.start, minutes=180)
        self.client = signed_in(self.host)
        self.url = f'{API}/events/{self.event.id}/'

    def running(self):
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = self.start
        self.event.save(update_fields=['status', 'started_at'])

    def move_to(self, when):
        return self.client.patch(
            self.url, {'scheduled_start': when.isoformat()}, format='json'
        )

    def test_its_hour_cannot_be_moved(self):
        self.running()
        was = self.event.scheduled_start

        got = self.move_to(self.start + timezone.timedelta(hours=2))

        self.assertEqual(got.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.scheduled_start, was)

    def test_nor_after_it_has_finished(self):
        self.event.status = Event.Status.ENDED
        self.event.started_at = self.start
        self.event.save(update_fields=['status', 'started_at'])

        self.assertEqual(
            self.move_to(self.start + timezone.timedelta(hours=2)).status_code, 400
        )

    def test_one_that_has_not_opened_still_moves(self):
        got = self.move_to(self.start + timezone.timedelta(days=1))

        self.assertEqual(got.status_code, 200)

    def test_everything_else_about_it_still_changes(self):
        """Only the hour is fixed. What it is called is not."""
        self.running()

        got = self.client.patch(self.url, {'title': 'Renamed'}, format='json')

        self.assertEqual(got.status_code, 200)
        self.event.refresh_from_db()
        self.assertEqual(self.event.title, 'Renamed')

    def test_sending_the_hour_it_already_has_is_not_a_change(self):
        """A form that resends every field must not be refused for it."""
        self.running()

        got = self.move_to(self.event.scheduled_start)

        self.assertEqual(got.status_code, 200)


class AnAgendaThatHasRunTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(hours=2)
        self.event = make_event(self.host, start=start, minutes=240)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()

        self.done = make_session(self.event, start, 30, 'Opening')
        self.done.status = Session.Status.DONE
        self.done.started_at = start
        self.done.ended_at = start + timezone.timedelta(minutes=30)
        self.done.save()

        self.later = make_session(
            self.event, start + timezone.timedelta(hours=3), 30, 'Closing'
        )
        self.client = signed_in(self.host)

    def url(self, session):
        return f'{API}/sessions/{session.id}/'

    def test_its_speaker_cannot_be_rewritten(self):
        got = self.client.patch(
            self.url(self.done), {'speaker_name': 'Somebody Else'}, format='json'
        )

        self.assertEqual(got.status_code, 400)
        self.done.refresh_from_db()
        self.assertNotEqual(self.done.speaker_name, 'Somebody Else')

    def test_nor_its_hour(self):
        was = self.done.starts_at

        got = self.client.patch(
            self.url(self.done),
            {'starts_at': (was + timezone.timedelta(hours=1)).isoformat()},
            format='json',
        )

        self.assertEqual(got.status_code, 400)
        self.done.refresh_from_db()
        self.assertEqual(self.done.starts_at, was)

    def test_nor_what_it_was_called(self):
        self.assertEqual(
            self.client.patch(
                self.url(self.done), {'title': 'Renamed'}, format='json'
            ).status_code,
            400,
        )

    def test_one_the_host_skipped_is_closed_the_same_way(self):
        self.later.status = Session.Status.SKIPPED
        self.later.save(update_fields=['status'])

        self.assertEqual(
            self.client.patch(
                self.url(self.later), {'title': 'Renamed'}, format='json'
            ).status_code,
            400,
        )

    def test_and_so_is_the_one_on_stage(self):
        """It has started, so its hour is a fact rather than a plan."""
        self.later.status = Session.Status.LIVE
        self.later.started_at = timezone.now()
        self.later.save(update_fields=['status', 'started_at'])

        self.assertEqual(
            self.client.patch(
                self.url(self.later), {'title': 'Renamed'}, format='json'
            ).status_code,
            400,
        )

    def test_one_still_to_come_changes_freely(self):
        got = self.client.patch(
            self.url(self.later), {'title': 'Renamed'}, format='json'
        )

        self.assertEqual(got.status_code, 200)
        self.later.refresh_from_db()
        self.assertEqual(self.later.title, 'Renamed')

    def test_resending_what_it_already_says_is_not_a_change(self):
        got = self.client.patch(
            self.url(self.done), {'title': self.done.title}, format='json'
        )

        self.assertEqual(got.status_code, 200)

    # -- what it produced stays open --------------------------------------

    def test_its_summary_can_still_be_written(self):
        """A summary is written afterwards. That is the whole point of it."""
        got = self.client.put(
            f'{API}/sessions/{self.done.id}/summary/',
            {'body': 'What the opening came to.'},
            format='json',
        )

        self.assertEqual(got.status_code, 200)

    def test_and_a_photograph_folder_still_made(self):
        got = self.client.post(
            f'{API}/events/{self.event.code}/photos/folders/',
            {'name': 'Opening'},
            format='json',
        )

        self.assertIn(got.status_code, (200, 201))
