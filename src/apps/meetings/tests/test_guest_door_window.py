"""When a guest may come in, and what they are told when they may not.

A guest has no dashboard: they arrive from a link or a QR code, and either
the meeting they are arriving for is open or it is not. The room belongs to
the meeting - one room holding the whole running order - so the quarter of
an hour is counted from the meeting, and the gaps between one talk and the
next are inside the room rather than outside it.
"""
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.tests.factories import make_event, make_host, make_meeting

API = '/api/v1'


class GuestDoorWindowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)

    def day(self, *slots, status=Meeting.Status.SCHEDULED):
        """A meeting whose sessions run at the given offsets from now."""
        first = slots[0][0]
        meeting = make_meeting(
            self.host, self.event,
            start=timezone.now() + timezone.timedelta(minutes=first),
            minutes=600,
        )
        meeting.status = status
        if status == Meeting.Status.ACTIVE:
            meeting.started_at = timezone.now()
        meeting.save()

        for offset, length in slots:
            Session.objects.create(
                meeting=meeting, title=f'Session at {offset}',
                starts_at=timezone.now() + timezone.timedelta(minutes=offset),
                duration_minutes=length,
            )
        return meeting

    def knock(self, meeting, phone='9812345678'):
        return self.client.post(
            f'{API}/meetings/guest/knock/',
            {
                'meeting_code': meeting.meeting_code,
                'full_name': 'Bishnu Prasad',
                'phone': phone,
            },
            content_type='application/json',
        )

    def test_a_quarter_of_an_hour_before_the_talk_the_door_is_open(self):
        # Session at 9; it is 8:50. The host still has to admit them.
        meeting = self.day((10, 60))

        response = self.knock(meeting)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['guest']['status'], 'pending')

    def test_earlier_than_that_the_room_is_not_ready(self):
        # Meeting at 9; it is 8:30.
        meeting = self.day((30, 60))

        response = self.knock(meeting)

        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body['code'], 'too_early')
        self.assertIn('This room opens at', body['error'])
        self.assertIsNotNone(body['opens_at'])

    def test_it_says_when_to_come_back(self):
        meeting = self.day((45, 60))

        body = self.knock(meeting).json()

        opens = timezone.datetime.fromisoformat(body['opens_at'])
        self.assertEqual(
            (meeting.scheduled_start - opens).total_seconds() / 60, 15
        )

    def test_arriving_late_to_a_live_session_is_fine(self):
        meeting = self.day((-20, 60), status=Meeting.Status.ACTIVE)
        session = meeting.sessions.first()
        session.status = Session.Status.LIVE
        session.started_at = session.starts_at
        session.save()

        self.assertEqual(self.knock(meeting).status_code, 201)

    def test_in_the_gap_between_two_sessions_the_room_is_still_open(self):
        # The meeting is under way, but nothing is on stage: the first
        # session finished twenty minutes ago and the next is an hour off.
        # The room is the meeting's, and it goes on between talks - the
        # host is setting up for the next speaker, not closing up.
        meeting = self.day((-80, 60), (60, 60), status=Meeting.Status.ACTIVE)
        done = meeting.sessions.order_by('starts_at').first()
        done.status = Session.Status.DONE
        done.started_at = done.starts_at
        done.ended_at = done.starts_at + timezone.timedelta(minutes=60)
        done.save()

        self.assertEqual(self.knock(meeting).status_code, 201)

    def test_a_quarter_of_an_hour_before_the_second_session_the_door_is_open(self):
        meeting = self.day((-80, 60), (10, 60), status=Meeting.Status.ACTIVE)
        done = meeting.sessions.order_by('starts_at').first()
        done.status = Session.Status.DONE
        done.save()

        self.assertEqual(self.knock(meeting).status_code, 201)

    def test_a_session_running_long_is_still_something_to_come_in_for(self):
        # Live and past the slot it was given, which now means the speaker
        # is still speaking - not that the talk is over.
        meeting = self.day((-120, 30), status=Meeting.Status.ACTIVE)
        session = meeting.sessions.first()
        session.status = Session.Status.LIVE
        session.started_at = session.starts_at
        session.save()

        self.assertEqual(self.knock(meeting).status_code, 201)

    def test_a_meeting_that_has_finished_says_so_without_a_time(self):
        meeting = self.day((-200, 60), status=Meeting.Status.ENDED)

        body = self.knock(meeting).json()

        self.assertEqual(body['code'], 'no_session_live')
        self.assertIsNone(body['opens_at'])

    def test_a_meeting_with_nothing_scheduled_falls_back_to_its_own_window(self):
        # The running order has not been filled in. It is still a meeting
        # that is happening, so the old rule answers.
        meeting = make_meeting(
            self.host, self.event, start=timezone.now() + timezone.timedelta(minutes=5)
        )

        self.assertEqual(self.knock(meeting).status_code, 201)

    def test_and_says_when_it_opens_rather_than_talking_about_sessions(self):
        meeting = make_meeting(
            self.host, self.event, start=timezone.now() + timezone.timedelta(hours=3)
        )

        body = self.knock(meeting).json()

        self.assertEqual(body['code'], 'too_early')
        self.assertIn('This room opens at', body['error'])
