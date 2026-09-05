"""What the room's counter measures from.

Every client renders the elapsed time from ``started_at``, so that stamp is
the clock. It has to mean "when this sitting began" - not "when this was
first ever opened", which is what left a meeting opened today counting from
yesterday.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'
MINUTE = timezone.timedelta(minutes=1)


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class MeetingClockTests(TestCase):
    """Opening a meeting from the room itself."""

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        # A window that is still open, so nothing auto-closes it underneath
        # the test - a meeting whose time has passed is ended on sight and
        # refuses to start at all, which is checked separately below.
        self.began = timezone.now() - timezone.timedelta(minutes=10)
        self.meeting = make_meeting(self.host, self.event, start=self.began, minutes=240)
        self.client = signed_in(self.host)

    def start(self):
        return self.client.post(f'{API}/meetings/{self.meeting.id}/start/')

    def reloaded(self):
        return Meeting.objects.get(id=self.meeting.id)

    def test_opening_it_starts_the_clock_now_not_at_its_slot(self):
        self.assertEqual(self.start().status_code, 200)

        started = self.reloaded().started_at
        self.assertGreater(started, timezone.now() - MINUTE)
        # Ten minutes late to your own meeting should not read as ten
        # minutes elapsed.
        self.assertGreater(started, self.began)

    def test_a_stale_stamp_from_an_earlier_sitting_is_replaced(self):
        # The reported case: the meeting carries a stamp from a sitting a
        # day ago, and is opened again today.
        self.meeting.started_at = timezone.now() - timezone.timedelta(hours=23)
        self.meeting.save(update_fields=['started_at'])

        self.start()

        self.assertGreater(self.reloaded().started_at, timezone.now() - MINUTE)

    def test_reopening_clears_the_earlier_ending(self):
        self.meeting.started_at = timezone.now() - timezone.timedelta(hours=23)
        self.meeting.ended_at = timezone.now() - timezone.timedelta(hours=22)
        self.meeting.save(update_fields=['started_at', 'ended_at'])

        self.start()

        reopened = self.reloaded()
        self.assertIsNone(reopened.ended_at)
        self.assertEqual(reopened.status, Meeting.Status.ACTIVE)

    def test_rejoining_a_running_meeting_does_not_restart_the_clock(self):
        self.start()
        first = self.reloaded().started_at

        self.start()

        self.assertEqual(self.reloaded().started_at, first)

    def test_a_meeting_whose_time_has_passed_is_not_opened(self):
        # Existing behaviour, pinned here because it is why the reported
        # case came in through a session rather than this endpoint.
        stale = make_meeting(
            self.host, self.event,
            start=timezone.now() - timezone.timedelta(hours=23), minutes=60,
        )

        response = self.client.post(f'{API}/meetings/{stale.id}/start/')

        self.assertEqual(response.status_code, 400)
        self.assertIsNone(Meeting.objects.get(id=stale.id).started_at)


class SessionClockTests(TestCase):
    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.now = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=self.now)
        self.session = make_session(self.meeting, self.now, 60)
        self.client = signed_in(self.host)

    def start(self):
        return self.client.post(f'{API}/sessions/{self.session.id}/start/')

    def test_a_session_run_again_counts_from_the_new_run(self):
        yesterday = self.now - timezone.timedelta(hours=23)
        self.session.started_at = yesterday
        self.session.ended_at = yesterday + timezone.timedelta(minutes=5)
        self.session.status = Session.Status.DONE
        self.session.save()

        self.start()

        restarted = Session.objects.get(id=self.session.id)
        self.assertGreater(restarted.started_at, timezone.now() - MINUTE)
        self.assertIsNone(restarted.ended_at)

    def test_putting_a_session_on_stage_starts_the_meeting_clock_now(self):
        self.meeting.started_at = self.now - timezone.timedelta(hours=23)
        self.meeting.status = Meeting.Status.ENDED
        self.meeting.save()

        self.start()

        self.assertGreater(
            Meeting.objects.get(id=self.meeting.id).started_at,
            timezone.now() - MINUTE,
        )

    def test_a_meeting_already_running_keeps_its_clock(self):
        self.start()
        running = Meeting.objects.get(id=self.meeting.id).started_at

        second = make_session(
            self.meeting, self.now + timezone.timedelta(minutes=75), 30
        )
        self.client.post(f'{API}/sessions/{second.id}/start/')

        self.assertEqual(Meeting.objects.get(id=self.meeting.id).started_at, running)

    def test_starting_a_session_twice_does_not_restart_it(self):
        self.start()
        first = Session.objects.get(id=self.session.id).started_at

        self.start()

        self.assertEqual(Session.objects.get(id=self.session.id).started_at, first)
