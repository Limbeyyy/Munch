"""The room is a meeting, not a session.

A meeting may hold ten talks. The room holds all of them: it opens before
the first, stays through the gaps while the host sets up for the next
speaker, and shuts when the meeting does. What the room's clock counts is
whatever the host has put on stage, and between two talks it counts
nothing - which is not the same as the room being over.
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
        self.second.status = Session.Status.LIVE
        self.second.save(update_fields=['status'])
        during = self.second.starts_at + timezone.timedelta(minutes=5)

        self.assertEqual(current_session(self.meeting, during), self.second)

    def test_a_session_that_has_overrun_is_still_the_room(self):
        """A talk is over when the host ends it, not when its hour strikes.

        This is the other half of the elastic timetable: the slot is a
        plan, and a speaker still speaking past it is still the session the
        room is holding. Taking the stage out from under them at half past
        was the old behaviour and it is exactly what the timetable now
        corrects for afterwards instead.
        """
        self.first.status = Session.Status.LIVE
        self.first.save(update_fields=['status'])
        long_after = self.first.starts_at + timezone.timedelta(minutes=90)

        self.assertEqual(current_session(self.meeting, long_after), self.first)

    def test_a_slot_the_host_never_started_is_not_the_room(self):
        # The timetable says the second talk is happening now. Nobody put
        # it on stage, so the room is not holding it: the host advances the
        # running order, not the clock.
        at = self.second.starts_at + timezone.timedelta(minutes=5)

        self.assertIsNone(current_session(self.meeting, at))

    def test_between_talks_the_room_holds_nothing_but_is_not_over(self):
        self.first.status = Session.Status.DONE
        self.first.ended_at = self.first.starts_at + timezone.timedelta(minutes=30)
        self.first.save()
        between = self.first.starts_at + timezone.timedelta(minutes=35)

        room = session_room_state(self.meeting, between)

        self.assertIsNone(room['id'])
        self.assertFalse(room['is_over'])
        self.assertTrue(room['between_sessions'])
        self.assertTrue(room['awaiting_next'])
        self.assertEqual(room['next_title'], 'Second talk')

    def test_the_room_stays_after_the_last_talk_has_finished(self):
        # Nothing left in the running order. The host may still start
        # another, so the room is waiting, not shut.
        for session in (self.first, self.second):
            session.status = Session.Status.DONE
            session.ended_at = timezone.now()
            session.save()

        room = session_room_state(self.meeting)

        self.assertFalse(room['is_over'])
        self.assertFalse(room['awaiting_next'])
        self.assertTrue(room['between_sessions'])

    def test_what_a_live_session_says_it_was_given(self):
        self.second.status = Session.Status.LIVE
        self.second.save(update_fields=['status'])
        at = self.second.starts_at + timezone.timedelta(minutes=5)

        room = session_room_state(self.meeting, at)

        self.assertEqual(
            room['ends_at'],
            (self.second.starts_at + timezone.timedelta(minutes=30)).isoformat(),
        )
        self.assertFalse(room['is_over'])

    def test_a_room_whose_talks_are_all_ahead_is_waiting_not_finished(self):
        before = self.first.starts_at - timezone.timedelta(minutes=10)

        room = session_room_state(self.meeting, before)

        self.assertFalse(room['is_over'])
        self.assertIsNone(room['id'])
        self.assertFalse(room['between_sessions'])
        self.assertTrue(room['awaiting_next'])

    def test_a_meeting_with_no_sessions_holds_nothing(self):
        bare = make_meeting(self.host, self.event, start=timezone.now())

        room = session_room_state(bare)

        self.assertIsNone(room['id'])
        self.assertFalse(room['is_over'])
        self.assertFalse(room['awaiting_next'])
