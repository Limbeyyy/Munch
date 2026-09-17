"""Starting, ending, and the difference between ended and never started."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.lifecycle import deadline_passed, has_more_to_run
from src.apps.meetings.models import Event, Session
from src.apps.meetings.tests.factories import (
    at, make_event, make_host, make_session,
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
        self.client = signed_in(self.host)
        self.past = timezone.now() - timezone.timedelta(hours=3)
        self.event = make_event(self.host, start=self.past)
        self.overdue = make_session(self.event, self.past, 60, 'Yesterday')

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
            Event.objects.get(id=self.event.id).status, Event.Status.ACTIVE
        )

    def test_the_rest_of_the_day_follows_it_down(self):
        later = make_session(
            self.event, self.past + timezone.timedelta(minutes=75), 30, 'After'
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
        event = make_event(self.host, start=now)
        session = make_session(event, now, 60, 'Right now')

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
        event = make_event(self.host, start=self.now)
        session = make_session(event, self.now, 60)
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
        event = make_event(self.host, start=started)
        session = make_session(event, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.get(f'{API}/sessions/?event={event.id}')

        self.assertEqual(Session.objects.get(id=session.id).status, Session.Status.LIVE)

    def test_and_so_is_one_left_on_stage_for_days(self):
        """There is no grace period, because there is no rule to be
        graceful about.

        A sweep used to close anything still live half a day past its slot,
        on the reasoning that nobody could still be in the room. But the
        clock does not know that, and being wrong about it takes a event
        away from people who are in it. Only a person ends a session now.
        """
        started = self.now - timezone.timedelta(days=3)
        event = make_event(self.host, start=started)
        session = make_session(event, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.get(f'{API}/sessions/?event={event.id}')
        self.client.get(f'{API}/events/')

        still = Session.objects.get(id=session.id)
        self.assertEqual(still.status, Session.Status.LIVE)
        self.assertIsNone(still.ended_at)

    def test_a_session_nobody_started_is_never_ended(self):
        past = self.now - timezone.timedelta(days=1)
        event = make_event(self.host, start=past)
        session = make_session(event, past, 60)

        self.client.get(f'{API}/sessions/?event={event.id}')

        untouched = Session.objects.get(id=session.id)
        self.assertEqual(untouched.status, Session.Status.SCHEDULED)
        self.assertIsNone(untouched.ended_at)
        self.assertIsNone(untouched.started_at)

    def test_the_host_ending_it_is_what_ends_it(self):
        # The other half of the same rule: it does end, when somebody says
        # so, and nothing about the clock is involved either way.
        started = self.now - timezone.timedelta(hours=5)
        event = make_event(self.host, start=started)
        event.status = Event.Status.ACTIVE
        event.started_at = started
        event.save()
        session = make_session(event, started, 30, status=Session.Status.LIVE)
        session.started_at = started
        session.save(update_fields=['started_at'])

        self.client.post(f'{API}/sessions/{session.id}/end/')

        closed = Session.objects.get(id=session.id)
        self.assertEqual(closed.status, Session.Status.DONE)
        self.assertIsNotNone(closed.ended_at)

    def test_nothing_here_closes_a_meeting_by_the_clock(self):
        """The rule that used to, and does not any more.

        A event whose window had passed with nothing left to run closed
        itself, and every read of it checked. A closing time is a plan; a
        room with people in it is not. The host ends the event.
        """
        past = self.now - timezone.timedelta(hours=3)
        event = make_event(self.host, start=past, minutes=60)
        event.status = Event.Status.ACTIVE
        event.started_at = past
        event.save()
        make_session(event, past, 30, status=Session.Status.DONE)

        # Read it every way the app reads it.
        self.client.get(f'{API}/events/{event.id}/')
        self.client.get(f'{API}/sessions/?event={event.id}')
        self.client.get(f'{API}/events/')

        self.assertEqual(
            Event.objects.get(id=event.id).status, Event.Status.ACTIVE
        )


class WhatIsLeftToRunTests(TestCase):
    """Whether a event still has something in it.

    Nothing closes a event on the strength of this any more - the host
    does that - but the question is still asked, and is still worth
    getting right: a session still to come is still to come, and one
    nobody ever ran is missed rather than pending.
    """

    def setUp(self):
        self.host = make_host()
        self.began = timezone.now() - timezone.timedelta(hours=1)
        self.event = make_event(self.host, start=self.began, minutes=30)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = self.began
        self.event.save()
        self.ran = make_session(self.event, self.began, 20, 'Already ran')
        self.ran.status = Session.Status.DONE
        self.ran.save(update_fields=['status'])

    def reloaded(self):
        return Event.objects.get(id=self.event.id)

    def test_a_session_still_to_come_counts(self):
        make_session(
            self.event, timezone.now() + timezone.timedelta(minutes=20), 30, 'Yet to run'
        )

        self.assertTrue(has_more_to_run(self.event))

    def test_a_session_in_its_slot_counts(self):
        make_session(
            self.event, timezone.now() - timezone.timedelta(minutes=5), 30, 'Running now'
        )

        self.assertTrue(has_more_to_run(self.event))

    def test_something_on_stage_counts(self):
        live = make_session(self.event, timezone.now(), 30, 'On stage')
        live.status = Session.Status.LIVE
        live.save(update_fields=['status'])

        self.assertTrue(has_more_to_run(self.event))

    def test_a_missed_session_does_not(self):
        # Never started and its time long gone: missed, not pending.
        make_session(
            self.event, self.began - timezone.timedelta(hours=2), 30, 'Nobody ran it'
        )

        self.assertFalse(has_more_to_run(self.event))

    def test_and_a_spent_running_order_leaves_nothing(self):
        self.assertFalse(has_more_to_run(self.event))

    def test_but_the_meeting_stays_open_regardless(self):
        # Which is the point: there is nothing left to run, its window went
        # an hour ago, and the room is still the host's to close.
        self.assertFalse(has_more_to_run(self.event))

        self.assertEqual(self.reloaded().status, Event.Status.ACTIVE)

    def test_reading_the_meeting_does_not_end_it_early(self):
        from rest_framework.test import APIClient
        from src.apps.accounts.tokens import issue_tokens

        make_session(
            self.event, timezone.now() + timezone.timedelta(minutes=20), 30, 'Yet to run'
        )
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_tokens(self.host)['access']}"
        )

        # Its own window ran out an hour ago; the session has not.
        response = client.get(f'{API}/events/{self.event.code}/')

        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(self.reloaded().status, Event.Status.ENDED)
