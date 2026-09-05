"""Starting, ending, and the difference between ended and never started."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.lifecycle import (
    close_meeting_if_spent, deadline_passed, sweep_expired,
)
from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.tests.factories import (
    at, make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')
    return client


class DeadlineTests(TestCase):
    """A slot that has been and gone cannot simply be opened late."""

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.client = signed_in(self.host)
        self.past = timezone.now() - timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=self.past)
        self.overdue = make_session(self.meeting, self.past, 60, 'Yesterday')

    def test_deadline_passed_reads_the_schedule(self):
        self.assertTrue(deadline_passed(self.overdue))

    def test_starting_after_the_deadline_is_refused(self):
        response = self.client.post(f'{API}/sessions/{self.overdue.id}/start/')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'deadline_passed')
        self.assertEqual(
            Session.objects.get(id=self.overdue.id).status, Session.Status.SCHEDULED
        )

    def test_the_refusal_leaves_the_meeting_alone(self):
        self.client.post(f'{API}/sessions/{self.overdue.id}/start/')
        self.assertEqual(
            Meeting.objects.get(id=self.meeting.id).status, Meeting.Status.SCHEDULED
        )

    def test_rescheduling_makes_it_startable_again(self):
        soon = timezone.now() + timezone.timedelta(minutes=30)
        moved = self.client.patch(
            f'{API}/sessions/{self.overdue.id}/',
            {'starts_at': soon.isoformat()},
            format='json',
        )
        self.assertEqual(moved.status_code, 200)

        started = self.client.post(f'{API}/sessions/{self.overdue.id}/start/')
        self.assertEqual(started.status_code, 200)
        self.assertEqual(
            Session.objects.get(id=self.overdue.id).status, Session.Status.LIVE
        )

    def test_a_session_still_in_its_slot_starts_normally(self):
        now = timezone.now()
        meeting = make_meeting(self.host, self.event, start=now)
        session = make_session(meeting, now, 60, 'Right now')

        response = self.client.post(f'{API}/sessions/{session.id}/start/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Session.objects.get(id=session.id).status, Session.Status.LIVE)


class EndingTests(TestCase):
    """Ended and never started are different states, and stay that way."""

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.client = signed_in(self.host)
        self.now = timezone.now()

    def test_the_host_ending_a_session_closes_it(self):
        meeting = make_meeting(self.host, self.event, start=self.now)
        session = make_session(meeting, self.now, 60)
        self.client.post(f'{API}/sessions/{session.id}/start/')

        response = self.client.post(f'{API}/sessions/{session.id}/end/')

        self.assertEqual(response.status_code, 200)
        closed = Session.objects.get(id=session.id)
        self.assertEqual(closed.status, Session.Status.DONE)
        self.assertIsNotNone(closed.ended_at)

    def test_a_session_left_running_past_its_slot_is_closed(self):
        started = self.now - timezone.timedelta(hours=2)
        meeting = make_meeting(self.host, self.event, start=started)
        session = make_session(meeting, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.assertEqual(sweep_expired(), 1)

        closed = Session.objects.get(id=session.id)
        self.assertEqual(closed.status, Session.Status.DONE)
        # It is recorded as finishing when it was meant to, not when the
        # sweep happened to notice.
        self.assertEqual(closed.ended_at, started + timezone.timedelta(minutes=30))

    def test_a_session_nobody_started_is_never_ended(self):
        past = self.now - timezone.timedelta(days=1)
        meeting = make_meeting(self.host, self.event, start=past)
        session = make_session(meeting, past, 60)

        sweep_expired()

        untouched = Session.objects.get(id=session.id)
        self.assertEqual(untouched.status, Session.Status.SCHEDULED)
        self.assertIsNone(untouched.ended_at)
        self.assertIsNone(untouched.started_at)

    def test_a_session_still_inside_its_slot_keeps_running(self):
        meeting = make_meeting(self.host, self.event, start=self.now)
        session = make_session(meeting, self.now, 60, status=Session.Status.LIVE)

        self.assertEqual(sweep_expired(), 0)
        self.assertEqual(Session.objects.get(id=session.id).status, Session.Status.LIVE)

    def test_the_sweep_can_be_run_twice_without_harm(self):
        started = self.now - timezone.timedelta(hours=2)
        meeting = make_meeting(self.host, self.event, start=started)
        make_session(meeting, started, 30, status=Session.Status.LIVE)

        self.assertEqual(sweep_expired(), 1)
        self.assertEqual(sweep_expired(), 0)

    def test_reading_the_running_order_closes_what_overran(self):
        started = self.now - timezone.timedelta(hours=2)
        meeting = make_meeting(self.host, self.event, start=started)
        session = make_session(meeting, started, 30, status=Session.Status.LIVE)

        self.client.get(f'{API}/sessions/?meeting={meeting.id}')

        self.assertEqual(Session.objects.get(id=session.id).status, Session.Status.DONE)

    def test_a_spent_meeting_closes_once_nothing_is_running(self):
        started = self.now - timezone.timedelta(hours=3)
        meeting = make_meeting(self.host, self.event, start=started, minutes=60)
        meeting.status = Meeting.Status.ACTIVE
        meeting.save(update_fields=['status'])
        make_session(meeting, started, 30, status=Session.Status.DONE)

        self.assertTrue(close_meeting_if_spent(meeting))
        self.assertEqual(Meeting.objects.get(id=meeting.id).status, Meeting.Status.ENDED)

    def test_a_meeting_nobody_opened_is_not_closed(self):
        started = self.now - timezone.timedelta(hours=3)
        meeting = make_meeting(self.host, self.event, start=started, minutes=60)

        self.assertFalse(close_meeting_if_spent(meeting))
        self.assertEqual(
            Meeting.objects.get(id=meeting.id).status, Meeting.Status.SCHEDULED
        )

    def test_a_meeting_with_something_still_on_stage_stays_open(self):
        meeting = make_meeting(self.host, self.event, start=self.now - timezone.timedelta(hours=3))
        meeting.status = Meeting.Status.ACTIVE
        meeting.save(update_fields=['status'])
        make_session(meeting, self.now, 60, status=Session.Status.LIVE)

        self.assertFalse(close_meeting_if_spent(meeting))
