"""Starting, ending, and the difference between ended and never started."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.lifecycle import (
    close_meeting_if_spent, deadline_passed, has_more_to_run,
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
    """A slot that has been and gone is a plan the host has fallen behind.

    It used to be a refusal: the schedule was what everybody else was
    reading, so it had to be corrected before the session could run. The
    timetable is elastic now - it follows the host rather than the other
    way round - so starting late moves the session to now and takes the
    rest of the day with it.
    """

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.client = signed_in(self.host)
        self.past = timezone.now() - timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=self.past)
        self.overdue = make_session(self.meeting, self.past, 60, 'Yesterday')

    def test_deadline_passed_reads_the_schedule(self):
        self.assertTrue(deadline_passed(self.overdue))

    def test_starting_after_the_slot_begins_it_now(self):
        response = self.client.post(f'{API}/sessions/{self.overdue.id}/start/')

        self.assertEqual(response.status_code, 200)
        started = Session.objects.get(id=self.overdue.id)
        self.assertEqual(started.status, Session.Status.LIVE)
        # Its hour begins now, not three hours ago.
        self.assertLess(
            abs((started.starts_at - timezone.now()).total_seconds()), 90
        )
        # And it still gets the hour it was given.
        self.assertEqual(started.duration_minutes, 60)

    def test_starting_it_opens_the_meeting(self):
        self.client.post(f'{API}/sessions/{self.overdue.id}/start/')
        self.assertEqual(
            Meeting.objects.get(id=self.meeting.id).status, Meeting.Status.ACTIVE
        )

    def test_the_rest_of_the_day_follows_it_down(self):
        later = make_session(
            self.meeting, self.past + timezone.timedelta(minutes=75), 30, 'After'
        )

        self.client.post(f'{API}/sessions/{self.overdue.id}/start/')

        moved = Session.objects.get(id=later.id)
        # It kept its quarter of an hour behind the first one's hour.
        gap = moved.starts_at - Session.objects.get(id=self.overdue.id).starts_at
        self.assertEqual(gap, timezone.timedelta(minutes=75))

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

    def test_a_session_running_long_is_left_alone(self):
        # Two hours past its half hour, and still the room's session: it
        # ends when the host ends it. Its end time is a plan, printed on a
        # programme; the person at the front is what is happening.
        started = self.now - timezone.timedelta(hours=2)
        meeting = make_meeting(self.host, self.event, start=started)
        session = make_session(meeting, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.get(f'{API}/sessions/?meeting={meeting.id}')

        self.assertEqual(Session.objects.get(id=session.id).status, Session.Status.LIVE)

    def test_and_so_is_one_left_on_stage_for_days(self):
        """There is no grace period, because there is no rule to be
        graceful about.

        A sweep used to close anything still live half a day past its slot,
        on the reasoning that nobody could still be in the room. But the
        clock does not know that, and being wrong about it takes a meeting
        away from people who are in it. Only a person ends a session now.
        """
        started = self.now - timezone.timedelta(days=3)
        meeting = make_meeting(self.host, self.event, start=started)
        session = make_session(meeting, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.get(f'{API}/sessions/?meeting={meeting.id}')
        self.client.get(f'{API}/events/')

        still = Session.objects.get(id=session.id)
        self.assertEqual(still.status, Session.Status.LIVE)
        self.assertIsNone(still.ended_at)

    def test_a_session_nobody_started_is_never_ended(self):
        past = self.now - timezone.timedelta(days=1)
        meeting = make_meeting(self.host, self.event, start=past)
        session = make_session(meeting, past, 60)

        self.client.get(f'{API}/sessions/?meeting={meeting.id}')

        untouched = Session.objects.get(id=session.id)
        self.assertEqual(untouched.status, Session.Status.SCHEDULED)
        self.assertIsNone(untouched.ended_at)
        self.assertIsNone(untouched.started_at)

    def test_the_host_ending_it_is_what_ends_it(self):
        # The other half of the same rule: it does end, when somebody says
        # so, and nothing about the clock is involved either way.
        started = self.now - timezone.timedelta(hours=5)
        meeting = make_meeting(self.host, self.event, start=started)
        meeting.status = Meeting.Status.ACTIVE
        meeting.started_at = started
        meeting.save()
        session = make_session(meeting, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.post(f'{API}/sessions/{session.id}/end/')

        closed = Session.objects.get(id=session.id)
        self.assertEqual(closed.status, Session.Status.DONE)
        self.assertIsNotNone(closed.ended_at)

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


class RunningOrderDecidesTheEndTests(TestCase):
    """A meeting is finished when its sessions are, not when its clock is.

    The reported failure: a meeting read as finished while one of its
    sessions was still to come, with the host's own On stage button sitting
    right beside it.
    """

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.began = timezone.now() - timezone.timedelta(hours=1)
        self.meeting = make_meeting(self.host, self.event, start=self.began, minutes=30)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = self.began
        self.meeting.save()
        self.ran = make_session(self.meeting, self.began, 20, 'Already ran')
        self.ran.status = Session.Status.DONE
        self.ran.save(update_fields=['status'])

    def reloaded(self):
        return Meeting.objects.get(id=self.meeting.id)

    def test_a_session_still_to_come_keeps_the_meeting_open(self):
        make_session(
            self.meeting, timezone.now() + timezone.timedelta(minutes=20), 30, 'Yet to run'
        )

        self.assertTrue(has_more_to_run(self.meeting))
        self.assertFalse(close_meeting_if_spent(self.meeting))
        self.assertEqual(self.reloaded().status, Meeting.Status.ACTIVE)

    def test_a_session_in_its_slot_keeps_it_open(self):
        make_session(
            self.meeting, timezone.now() - timezone.timedelta(minutes=5), 30, 'Running now'
        )

        self.assertTrue(has_more_to_run(self.meeting))
        self.assertFalse(close_meeting_if_spent(self.meeting))

    def test_something_on_stage_keeps_it_open(self):
        live = make_session(self.meeting, timezone.now(), 30, 'On stage')
        live.status = Session.Status.LIVE
        live.save(update_fields=['status'])

        self.assertTrue(has_more_to_run(self.meeting))

    def test_a_missed_session_does_not_keep_it_open_for_ever(self):
        # Never started and its time long gone: missed, not pending.
        make_session(
            self.meeting, self.began - timezone.timedelta(hours=2), 30, 'Nobody ran it'
        )

        self.assertFalse(has_more_to_run(self.meeting))
        self.assertTrue(close_meeting_if_spent(self.meeting))

    def test_it_closes_once_the_running_order_is_done(self):
        self.assertFalse(has_more_to_run(self.meeting))

        self.assertTrue(close_meeting_if_spent(self.meeting))
        self.assertEqual(self.reloaded().status, Meeting.Status.ENDED)

    def test_reading_the_meeting_does_not_end_it_early(self):
        from rest_framework.test import APIClient
        from src.apps.accounts.tokens import issue_tokens

        make_session(
            self.meeting, timezone.now() + timezone.timedelta(minutes=20), 30, 'Yet to run'
        )
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_tokens(self.host)['access']}"
        )

        # Its own window ran out an hour ago; the session has not.
        response = client.get(f'{API}/meetings/{self.meeting.meeting_code}/')

        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(self.reloaded().status, Meeting.Status.ENDED)
