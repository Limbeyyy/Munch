"""The timetable follows the room, not the other way round.

A session ends when the host ends it. The hour it was given is a plan, and
once the plan and the day disagree it is the plan that gets corrected: a
talk that runs half an hour long pushes everything after it half an hour
later, and one that finishes early pulls it earlier. Each remaining slot
keeps its own length and its place in the running order - nobody's talk is
shortened because somebody else's ran long.

The worked example these are written against:

    Meeting  10:00 - 13:00
      A      10:00 - 11:00
      B      11:00 - 12:00
      C      12:00 - 13:00

    A ends at 11:30, so:

    Meeting  10:00 - 13:30
      B      11:30 - 12:30
      C      12:30 - 13:30
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.scheduling import absorb_overrun, begin_now
from src.apps.meetings.tests.factories import (
    at, make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}'
    )
    return client


class ElasticScheduleTests(TestCase):
    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        # Ten o'clock this morning, so the arithmetic reads like the example.
        self.ten = timezone.now().replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        self.meeting = make_meeting(
            self.host, self.event, start=self.ten, minutes=180
        )
        self.a = make_session(self.meeting, self.ten, 60, 'A')
        self.b = make_session(self.meeting, at(self.ten, 1), 60, 'B')
        self.c = make_session(self.meeting, at(self.ten, 2), 60, 'C')

    def refreshed(self):
        for session in (self.a, self.b, self.c):
            session.refresh_from_db()
        self.meeting.refresh_from_db()

    # -- running long ----------------------------------------------------

    def test_half_an_hour_over_moves_the_whole_afternoon(self):
        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        self.assertEqual(self.a.duration_minutes, 90)
        self.assertEqual(self.b.starts_at, at(self.ten, 1, 30))
        self.assertEqual(self.c.starts_at, at(self.ten, 2, 30))

    def test_and_stretches_the_meeting_with_it(self):
        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 3, 30))

    def test_each_talk_keeps_the_length_it_was_given(self):
        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        self.assertEqual(self.b.duration_minutes, 60)
        self.assertEqual(self.c.duration_minutes, 60)

    def test_a_second_overrun_moves_what_is_left_again(self):
        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        # B now runs 11:30 to 12:30 and goes half an hour over as well.
        absorb_overrun(self.b, at(self.ten, 3))
        self.refreshed()

        self.assertEqual(self.c.starts_at, at(self.ten, 3))
        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 4))

    # -- finishing early -------------------------------------------------

    def test_finishing_early_pulls_the_rest_forward(self):
        absorb_overrun(self.a, at(self.ten, 0, 30))
        self.refreshed()

        self.assertEqual(self.a.duration_minutes, 30)
        self.assertEqual(self.b.starts_at, at(self.ten, 0, 30))
        self.assertEqual(self.c.starts_at, at(self.ten, 1, 30))

    def test_but_the_room_keeps_the_hours_it_was_advertised_for(self):
        # The meeting's own window is not shortened by an early finish: the
        # host may yet start something else, and the room is theirs until
        # one o'clock whatever the running order says.
        absorb_overrun(self.a, at(self.ten, 0, 30))
        self.refreshed()

        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 3))

    # -- what does not move ----------------------------------------------

    def test_ending_on_time_moves_nothing(self):
        moved = absorb_overrun(self.a, at(self.ten, 1))
        self.refreshed()

        self.assertEqual(moved, [])
        self.assertEqual(self.b.starts_at, at(self.ten, 1))
        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 3))

    def test_a_few_seconds_either_way_is_not_a_change_of_plan(self):
        moved = absorb_overrun(
            self.a, at(self.ten, 1) + timezone.timedelta(seconds=11)
        )

        self.assertEqual(moved, [])

    def test_a_talk_that_has_already_run_is_not_moved(self):
        # B is done. C, which is still to come, moves; B stays where the
        # record says it happened.
        self.b.status = Session.Status.DONE
        self.b.save(update_fields=['status'])

        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        self.assertEqual(self.b.starts_at, at(self.ten, 1))
        self.assertEqual(self.c.starts_at, at(self.ten, 2, 30))

    def test_a_talk_on_stage_is_not_moved(self):
        self.b.status = Session.Status.LIVE
        self.b.save(update_fields=['status'])

        absorb_overrun(self.a, at(self.ten, 1, 30))
        self.refreshed()

        self.assertEqual(self.b.starts_at, at(self.ten, 1))

    # -- starting late ---------------------------------------------------

    def test_starting_late_begins_the_talk_now_and_moves_the_rest(self):
        begin_now(self.b, at(self.ten, 1, 20))
        self.refreshed()

        self.assertEqual(self.b.starts_at, at(self.ten, 1, 20))
        self.assertEqual(self.b.duration_minutes, 60)
        self.assertEqual(self.c.starts_at, at(self.ten, 2, 20))
        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 3, 20))

    def test_starting_early_moves_nothing(self):
        # The host is ready before the hour. That is their business; it is
        # not a reason to pull everybody else's slot forward.
        moved = begin_now(self.b, at(self.ten, 0, 50))
        self.refreshed()

        self.assertEqual(moved, [])
        self.assertEqual(self.b.starts_at, at(self.ten, 1))
        self.assertEqual(self.c.starts_at, at(self.ten, 2))

    # -- the meeting after this one --------------------------------------

    def test_a_meeting_behind_this_one_is_pushed_clear(self):
        after = make_meeting(
            self.host, self.event, start=at(self.ten, 3, 15), minutes=60,
            title='Afternoon',
        )
        first = make_session(after, at(self.ten, 3, 15), 60, 'D')

        # A runs an hour over, so the morning now ends at two.
        absorb_overrun(self.a, at(self.ten, 2))
        after.refresh_from_db()
        first.refresh_from_db()

        self.assertGreaterEqual(after.scheduled_start, at(self.ten, 4))
        self.assertEqual(first.starts_at, after.scheduled_start)

    def test_a_meeting_with_room_in_front_of_it_stays_put(self):
        after = make_meeting(
            self.host, self.event, start=at(self.ten, 6), minutes=60,
            title='Evening',
        )

        absorb_overrun(self.a, at(self.ten, 1, 30))
        after.refresh_from_db()

        self.assertEqual(after.scheduled_start, at(self.ten, 6))

    # -- through the endpoint --------------------------------------------

    def test_the_host_ending_a_session_moves_the_day_and_keeps_the_room(self):
        # A meeting that opened ninety minutes ago holding two hour-long
        # talks: the first is on stage and half an hour over.
        opened = timezone.now() - timezone.timedelta(minutes=90)
        meeting = make_meeting(self.host, self.event, start=opened, minutes=120)
        meeting.status = Meeting.Status.ACTIVE
        meeting.started_at = opened
        meeting.save()
        first = make_session(meeting, opened, 60, 'Running long')
        first.status = Session.Status.LIVE
        first.started_at = opened
        first.save()
        second = make_session(
            meeting, opened + timezone.timedelta(minutes=60), 60, 'Next'
        )

        client = signed_in(self.host)
        body = client.post(f'{API}/sessions/{first.id}/end/').json()

        self.assertFalse(body['meeting_ended'])
        self.assertEqual(body['meeting_status'], Meeting.Status.ACTIVE)
        self.assertEqual(body['sessions_moved'], [str(second.id)])

        second.refresh_from_db()
        first.refresh_from_db()
        meeting.refresh_from_db()
        # It ran an hour and a half, and the next talk starts where it
        # actually finished rather than where it was meant to.
        self.assertEqual(first.duration_minutes, 90)
        self.assertEqual(
            second.starts_at, first.starts_at + timezone.timedelta(minutes=90)
        )
        self.assertEqual(
            meeting.scheduled_end,
            second.starts_at + timezone.timedelta(minutes=60),
        )

    def test_and_the_next_one_can_then_be_started(self):
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = self.ten
        self.meeting.save()
        client = signed_in(self.host)

        started = client.post(f'{API}/sessions/{self.b.id}/start/')

        self.assertEqual(started.status_code, 200)
        self.refreshed()
        self.assertEqual(self.b.status, Session.Status.LIVE)


class RearrangedFromInsideTheRoomTests(TestCase):
    """The host reorders what is left of a meeting they are standing in.

    A meeting under way used to hold every one of its times: the running
    order was something you settled beforehand. It is now something the
    host works with between one talk and the next - end this one, drag the
    speaker who is actually in the hall to the top, start them - so its
    scheduled sessions move. What has run, or is running, does not.
    """

    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.ten = timezone.now().replace(hour=10, minute=0, second=0, microsecond=0)
        # Spaced by the quarter of an hour the host keeps between talks, so
        # nothing here is fighting the gap: 10:00, 11:15, 12:30.
        self.meeting = make_meeting(self.host, self.event, start=self.ten, minutes=210)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = self.ten
        self.meeting.save()
        self.a = make_session(self.meeting, self.ten, 60, 'A')
        self.a.status = Session.Status.DONE
        self.a.save(update_fields=['status'])
        self.b = make_session(self.meeting, at(self.ten, 1, 15), 60, 'B')
        self.c = make_session(self.meeting, at(self.ten, 2, 30), 60, 'C')
        self.client = signed_in(self.host)

    def swap(self):
        return self.client.post(
            f'{API}/sessions/reschedule/',
            {'changes': [
                {'id': str(self.c.id), 'starts_at': self.b.starts_at.isoformat()},
                {'id': str(self.b.id), 'starts_at': self.c.starts_at.isoformat()},
            ]},
            format='json',
        )

    def test_two_still_to_run_change_places(self):
        response = self.swap()

        self.assertEqual(response.status_code, 200)
        self.b.refresh_from_db()
        self.c.refresh_from_db()
        self.assertEqual(self.c.starts_at, at(self.ten, 1, 15))
        self.assertEqual(self.b.starts_at, at(self.ten, 2, 30))

    def test_the_talk_that_has_run_keeps_its_place(self):
        self.swap()

        self.a.refresh_from_db()
        self.assertEqual(self.a.starts_at, self.ten)
        self.assertEqual(self.a.status, Session.Status.DONE)

    def test_the_meeting_keeps_the_hour_it_opened_at(self):
        # Moving the window out from under a room full of people would be
        # worse than a window that no longer matches.
        self.swap()

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.scheduled_start, self.ten)
        self.assertEqual(self.meeting.status, Meeting.Status.ACTIVE)

    def test_but_its_window_grows_to_hold_a_longer_running_order(self):
        response = self.client.post(
            f'{API}/sessions/reschedule/',
            {'changes': [{'id': str(self.c.id), 'duration_minutes': 120}]},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.scheduled_end, at(self.ten, 4, 30))

    def test_a_session_on_stage_is_not_dragged_out_from_under_the_speaker(self):
        self.b.status = Session.Status.LIVE
        self.b.started_at = timezone.now()
        self.b.save()

        self.swap()

        self.b.refresh_from_db()
        self.assertEqual(self.b.starts_at, at(self.ten, 1, 15))
