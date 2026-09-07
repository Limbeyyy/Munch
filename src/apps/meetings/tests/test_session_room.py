"""The room is a session, not a meeting.

A meeting may be a whole morning. What people sit through is one talk with
its own start and its own end, and that is what the room's clock counts and
what closes its door.
"""
from django.test import TestCase
from django.utils import timezone

from src.apps.meetings.lifecycle import current_session, session_room_state
from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)


class SessionRoomTests(TestCase):
    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        # A two-hour meeting holding two half-hour talks.
        self.opened = timezone.now() - timezone.timedelta(minutes=40)
        self.meeting = make_meeting(self.host, self.event, start=self.opened, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = self.opened
        self.meeting.save()
        self.first = make_session(self.meeting, self.opened, 30, 'First talk')
        self.second = make_session(
            self.meeting, self.opened + timezone.timedelta(minutes=45), 30, 'Second talk'
        )

    def test_the_clock_is_the_sessions_not_the_meetings(self):
        # The meeting has been open forty minutes; the talk has not.
        self.second.status = Session.Status.LIVE
        self.second.started_at = timezone.now() - timezone.timedelta(minutes=3)
        self.second.save()

        room = session_room_state(self.meeting)

        self.assertEqual(room['title'], 'Second talk')
        self.assertEqual(room['started_at'], self.second.started_at.isoformat())
        self.assertNotEqual(room['started_at'], self.meeting.started_at.isoformat())

    def test_whatever_is_on_stage_is_the_room(self):
        self.first.status = Session.Status.LIVE
        self.first.save(update_fields=['status'])

        self.assertEqual(current_session(self.meeting), self.first)

    def test_otherwise_the_slot_the_clock_is_in(self):
        # Nothing on stage, but the timetable says the second talk is now.
        at = self.second.starts_at + timezone.timedelta(minutes=5)

        self.assertEqual(current_session(self.meeting, at), self.second)

    def test_between_talks_the_room_holds_nothing(self):
        between = self.first.starts_at + timezone.timedelta(minutes=35)

        self.assertIsNone(current_session(self.meeting, between))

    def test_the_door_shuts_at_the_end_of_the_session(self):
        at = self.second.starts_at + timezone.timedelta(minutes=5)

        room = session_room_state(self.meeting, at)

        self.assertEqual(
            room['ends_at'],
            (self.second.starts_at + timezone.timedelta(minutes=30)).isoformat(),
        )
        self.assertFalse(room['is_over'])

    def test_arriving_after_the_talk_is_told_it_is_over(self):
        # The gap this closes: somebody opening the page a minute late used
        # to find an open room whose clock never started.
        after = self.second.starts_at + timezone.timedelta(minutes=45)

        room = session_room_state(self.meeting, after)

        self.assertTrue(room['is_over'])
        self.assertEqual(room['title'], 'Second talk')

    def test_a_room_whose_talks_are_all_ahead_is_waiting_not_finished(self):
        before = self.first.starts_at - timezone.timedelta(minutes=10)

        room = session_room_state(self.meeting, before)

        self.assertFalse(room['is_over'])
        self.assertIsNone(room['id'])

    def test_a_finished_session_reports_over_even_while_its_slot_runs(self):
        self.second.status = Session.Status.DONE
        self.second.ended_at = timezone.now()
        self.second.save()
        during = self.second.starts_at + timezone.timedelta(minutes=5)

        # It is not live and its slot is current, so it is the room's
        # session - and it is done.
        room = session_room_state(self.meeting, during)
        self.assertEqual(room['title'], 'Second talk')
        self.assertTrue(room['is_over'])

    def test_a_meeting_with_no_sessions_holds_nothing(self):
        bare = make_meeting(self.host, self.event, start=timezone.now())

        room = session_room_state(bare)

        self.assertIsNone(room['id'])
        self.assertFalse(room['is_over'])
