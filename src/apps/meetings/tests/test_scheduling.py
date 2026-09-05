"""The timetable rules, exercised the way an organizer would hit them."""
from django.test import TestCase
from django.utils import timezone

from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.scheduling import (
    GAP_MINUTES,
    ScheduleConflict,
    check_slot,
    earliest_start,
    normalise_running_order,
    reschedule,
)
from src.apps.meetings.tests.factories import (
    at, make_event, make_host, make_meeting, make_session,
)

GAP = timezone.timedelta(minutes=GAP_MINUTES)
HOUR = timezone.timedelta(hours=1)


class RunningOrderTests(TestCase):
    """Sessions typed in one go come out properly spaced."""

    def setUp(self):
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )

    def test_consecutive_sessions_get_the_mandatory_gap(self):
        # The example from the brief: 9:00 for an hour, then 10:15, then 11:30.
        ordered = normalise_running_order([
            {'title': 'one', 'starts_at': self.nine, 'duration_minutes': 60},
            {'title': 'two', 'starts_at': self.nine, 'duration_minutes': 60},
            {'title': 'three', 'starts_at': self.nine, 'duration_minutes': 60},
        ], first_start=self.nine)

        self.assertEqual(ordered[0]['starts_at'], self.nine)
        self.assertEqual(ordered[1]['starts_at'], at(self.nine, hours=1, minutes=15))
        self.assertEqual(ordered[2]['starts_at'], at(self.nine, hours=2, minutes=30))

    def test_a_gap_the_organizer_left_is_respected(self):
        ordered = normalise_running_order([
            {'title': 'one', 'starts_at': self.nine, 'duration_minutes': 60},
            {'title': 'two', 'starts_at': at(self.nine, hours=3), 'duration_minutes': 60},
        ], first_start=self.nine)

        self.assertEqual(ordered[1]['starts_at'], at(self.nine, hours=3))

    def test_order_survives_the_spacing(self):
        ordered = normalise_running_order([
            {'title': 'later', 'starts_at': at(self.nine, hours=2), 'duration_minutes': 30},
            {'title': 'earlier', 'starts_at': self.nine, 'duration_minutes': 30},
        ], first_start=self.nine)

        self.assertEqual([s['title'] for s in ordered], ['earlier', 'later'])


class SlotValidationTests(TestCase):
    """A session being added has to fit the day as it stands."""

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        self.meeting = make_meeting(self.host, self.event, start=self.nine)
        make_session(self.meeting, self.nine, 60, 'Opening')

    def test_a_clean_slot_after_the_gap_is_accepted(self):
        check_slot(self.meeting, at(self.nine, hours=1, minutes=15), 60)

    def test_an_overlapping_slot_is_refused(self):
        with self.assertRaises(ScheduleConflict):
            check_slot(self.meeting, at(self.nine, minutes=30), 60)

    def test_a_slot_inside_the_gap_is_refused(self):
        # Ends at 10:00, so 10:10 leaves only ten minutes.
        with self.assertRaises(ScheduleConflict):
            check_slot(self.meeting, at(self.nine, hours=1, minutes=10), 30)

    def test_the_refusal_names_the_earliest_legal_time(self):
        with self.assertRaises(ScheduleConflict) as caught:
            check_slot(self.meeting, at(self.nine, minutes=30), 60)

        detail = caught.exception.detail
        self.assertEqual(str(detail['code']), 'schedule_conflict')
        self.assertIn('earliest_start', detail)

    def test_earliest_start_is_the_last_end_plus_the_gap(self):
        self.assertEqual(
            earliest_start(self.meeting), at(self.nine, hours=1, minutes=15)
        )

    def test_the_gap_holds_across_meetings_in_one_event(self):
        other = make_meeting(self.host, self.event, start=at(self.nine, hours=2), title='Evening')
        with self.assertRaises(ScheduleConflict):
            # 10:05 clashes with the first meeting's session, even though
            # this session would belong to a different meeting.
            check_slot(other, at(self.nine, hours=1, minutes=5), 30)

    def test_a_standalone_meeting_answers_only_to_itself(self):
        alone = make_meeting(self.host, event=None, start=self.nine)
        # The event's 9:00 session is no concern of a meeting outside it.
        check_slot(alone, self.nine, 60)


class ReflowTests(TestCase):
    """Moving one thing carries the rest of the day along with it."""

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        self.meeting = make_meeting(self.host, self.event, start=self.nine)
        self.a = make_session(self.meeting, self.nine, 60, 'A')
        self.b = make_session(self.meeting, at(self.nine, hours=1, minutes=15), 60, 'B')
        self.c = make_session(self.meeting, at(self.nine, hours=2, minutes=30), 60, 'C')

    def refreshed(self):
        return [s.starts_at for s in [self.a, self.b, self.c] for s in [Session.objects.get(id=s.id)]]

    def test_moving_the_first_shifts_the_rest(self):
        # The brief's example: A 9:00-10:00 becomes 9:30-10:30, so B goes to
        # 10:45 and C to 12:00.
        reschedule(
            self.meeting,
            {self.a.id: {'starts_at': at(self.nine, minutes=30)}},
            anchored_id=self.a.id,
        )
        a, b, c = self.refreshed()
        self.assertEqual(a, at(self.nine, minutes=30))
        self.assertEqual(b, at(self.nine, hours=1, minutes=45))
        self.assertEqual(c, at(self.nine, hours=3))

    def test_a_longer_session_pushes_what_follows(self):
        reschedule(
            self.meeting,
            {self.a.id: {'duration_minutes': 120}},
            anchored_id=self.a.id,
        )
        a, b, c = self.refreshed()
        self.assertEqual(a, self.nine)
        self.assertEqual(b, at(self.nine, hours=2, minutes=15))
        self.assertEqual(c, at(self.nine, hours=3, minutes=30))

    def test_moving_something_later_leaves_the_earlier_ones_alone(self):
        reschedule(
            self.meeting,
            {self.c.id: {'starts_at': at(self.nine, hours=5)}},
            anchored_id=self.c.id,
        )
        a, b, c = self.refreshed()
        self.assertEqual(a, self.nine)
        self.assertEqual(b, at(self.nine, hours=1, minutes=15))
        self.assertEqual(c, at(self.nine, hours=5))

    def test_nothing_overlaps_after_a_reflow(self):
        reschedule(
            self.meeting,
            {self.a.id: {'duration_minutes': 200}},
            anchored_id=self.a.id,
        )
        times = sorted(
            (s.starts_at, s.duration_minutes)
            for s in Session.objects.filter(meeting=self.meeting)
        )
        for (start, minutes), (next_start, _) in zip(times, times[1:]):
            ends = start + timezone.timedelta(minutes=minutes)
            self.assertGreaterEqual(next_start, ends + GAP)

    def test_a_session_that_already_ran_holds_its_time(self):
        self.b.status = Session.Status.DONE
        self.b.save(update_fields=['status'])

        reschedule(
            self.meeting,
            {self.a.id: {'duration_minutes': 180}},
            anchored_id=self.a.id,
        )
        a, b, c = self.refreshed()
        self.assertEqual(b, at(self.nine, hours=1, minutes=15))
        # A cannot run over B, so it is pushed past it instead.
        self.assertGreaterEqual(a, b + HOUR + GAP)

    def test_the_meeting_window_follows_its_running_order(self):
        reschedule(
            self.meeting,
            {self.c.id: {'starts_at': at(self.nine, hours=6)}},
            anchored_id=self.c.id,
        )
        meeting = Meeting.objects.get(id=self.meeting.id)
        self.assertEqual(meeting.scheduled_start, self.nine)
        self.assertEqual(meeting.scheduled_end, at(self.nine, hours=7))

    def test_reflow_reports_only_what_actually_moved(self):
        moved = reschedule(
            self.meeting,
            {self.c.id: {'starts_at': at(self.nine, hours=6)}},
            anchored_id=self.c.id,
        )
        self.assertEqual([s.title for s in moved], ['C'])

    def test_a_settled_day_is_left_alone(self):
        self.assertEqual(reschedule(self.meeting, {}), [])
