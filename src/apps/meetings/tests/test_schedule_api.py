"""The scheduling rules as they are reached over HTTP."""
import threading

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from unittest import skipUnless
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.models import Meeting, Session
from src.apps.meetings.scheduling import GAP_MINUTES
from src.apps.meetings.tests.factories import (
    at, make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'
GAP = timezone.timedelta(minutes=GAP_MINUTES)


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')
    return client


def session_body(meeting, starts_at, minutes=60, title='New session'):
    return {
        'meeting': str(meeting.id),
        'title': title,
        'starts_at': starts_at.isoformat(),
        'duration_minutes': minutes,
        'speaker_name': 'A Speaker',
        'speaker_email': 'speaker@example.com',
        'speaker_phone': '9800000000',
    }


class CreateSessionTests(TestCase):
    def setUp(self):
        self.host = make_host()
        self.event = make_event(self.host)
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        self.meeting = make_meeting(self.host, self.event, start=self.nine)
        make_session(self.meeting, self.nine, 60, 'Opening')
        self.client = signed_in(self.host)
        # Hosting limits are a separate concern; give this host room to work.
        from src.apps.accounts.models import HostAccount

        HostAccount.objects.create(
            user=self.host, plan='enterprise', status=HostAccount.Status.ACTIVE
        )

    def test_a_session_after_the_gap_is_created(self):
        response = self.client.post(
            f'{API}/sessions/',
            session_body(self.meeting, at(self.nine, hours=1, minutes=15)),
            format='json',
        )
        self.assertEqual(response.status_code, 201)

    def test_an_overlapping_session_is_refused(self):
        response = self.client.post(
            f'{API}/sessions/',
            session_body(self.meeting, at(self.nine, minutes=30)),
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'schedule_conflict')
        self.assertEqual(Session.objects.filter(meeting=self.meeting).count(), 1)

    def test_a_session_inside_the_gap_is_refused(self):
        response = self.client.post(
            f'{API}/sessions/',
            session_body(self.meeting, at(self.nine, hours=1, minutes=5), 30),
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_the_refusal_offers_the_earliest_legal_time(self):
        response = self.client.post(
            f'{API}/sessions/',
            session_body(self.meeting, at(self.nine, minutes=30)),
            format='json',
        )
        offered = response.json()['earliest_start']
        self.assertEqual(offered, at(self.nine, hours=1, minutes=15).isoformat())

    def test_a_meeting_created_with_its_running_order_comes_out_spaced(self):
        body = {
            'title': 'Afternoon',
            'scheduled_start': at(self.nine, hours=5).isoformat(),
            'duration_minutes': 180,
            'sessions': [
                {**session_body(self.meeting, at(self.nine, hours=5), 60, 'One')},
                {**session_body(self.meeting, at(self.nine, hours=5), 60, 'Two')},
                {**session_body(self.meeting, at(self.nine, hours=5), 60, 'Three')},
            ],
        }
        response = self.client.post(
            f'{API}/events/{self.event.id}/meetings/', body, format='json'
        )
        self.assertEqual(response.status_code, 201)

        created = Meeting.objects.get(id=response.json()['id'])
        times = list(created.sessions.order_by('starts_at').values_list('starts_at', flat=True))
        self.assertEqual(times[0], at(self.nine, hours=5))
        self.assertEqual(times[1], at(self.nine, hours=6, minutes=15))
        self.assertEqual(times[2], at(self.nine, hours=7, minutes=30))


class EditSessionTests(TestCase):
    """Editing an existing session shifts the day rather than being refused."""

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
        self.client = signed_in(self.host)

    def times(self):
        return {s.title: s.starts_at for s in Session.objects.filter(meeting=self.meeting)}

    def test_moving_a_session_shifts_the_ones_after_it(self):
        response = self.client.patch(
            f'{API}/sessions/{self.a.id}/',
            {'starts_at': at(self.nine, minutes=30).isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 200)

        times = self.times()
        self.assertEqual(times['A'], at(self.nine, minutes=30))
        self.assertEqual(times['B'], at(self.nine, hours=1, minutes=45))
        self.assertEqual(times['C'], at(self.nine, hours=3))

    def test_a_longer_session_pushes_the_rest(self):
        self.client.patch(
            f'{API}/sessions/{self.a.id}/', {'duration_minutes': 120}, format='json'
        )
        times = self.times()
        self.assertEqual(times['B'], at(self.nine, hours=2, minutes=15))
        self.assertEqual(times['C'], at(self.nine, hours=3, minutes=30))

    def test_only_the_host_may_move_things(self):
        stranger = make_host()
        response = signed_in(stranger).patch(
            f'{API}/sessions/{self.a.id}/',
            {'starts_at': at(self.nine, hours=4).isoformat()},
            format='json',
        )
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(self.times()['A'], self.nine)

    def test_a_whole_day_saves_in_one_request(self):
        response = self.client.post(
            f'{API}/sessions/reschedule/',
            {'changes': [
                {'id': str(self.a.id), 'starts_at': at(self.nine, hours=1).isoformat()},
                {'id': str(self.c.id), 'duration_minutes': 90},
            ]},
            format='json',
        )
        self.assertEqual(response.status_code, 200)

        times = self.times()
        self.assertEqual(times['A'], at(self.nine, hours=1))
        self.assertEqual(times['B'], at(self.nine, hours=2, minutes=15))
        self.assertEqual(times['C'], at(self.nine, hours=3, minutes=30))

    def test_a_hand_made_overlap_is_settled_rather_than_stored(self):
        # Somebody bypassing the agenda and asking for two sessions at once.
        self.client.post(
            f'{API}/sessions/reschedule/',
            {'changes': [
                {'id': str(self.b.id), 'starts_at': self.nine.isoformat()},
                {'id': str(self.c.id), 'starts_at': self.nine.isoformat()},
            ]},
            format='json',
        )
        stored = sorted(
            (s.starts_at, s.duration_minutes)
            for s in Session.objects.filter(meeting=self.meeting)
        )
        for (start, minutes), (next_start, _) in zip(stored, stored[1:]):
            self.assertGreaterEqual(
                next_start, start + timezone.timedelta(minutes=minutes) + GAP
            )


@skipUnless(
    connection.features.has_select_for_update,
    'Row locking is what this tests; SQLite locks the whole table instead.',
)
class ConcurrentEditTests(TransactionTestCase):
    """Two organizers saving at once must not leave the day overlapping."""

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

    def test_simultaneous_reflows_still_leave_a_legal_day(self):
        from src.apps.meetings.scheduling import reschedule

        def move(session, minutes):
            try:
                reschedule(
                    self.meeting,
                    {session.id: {'duration_minutes': minutes}},
                    anchored_id=session.id,
                )
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=move, args=(self.a, 120)),
            threading.Thread(target=move, args=(self.b, 90)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        stored = sorted(
            (s.starts_at, s.duration_minutes)
            for s in Session.objects.filter(meeting=self.meeting)
        )
        for (start, minutes), (next_start, _) in zip(stored, stored[1:]):
            self.assertGreaterEqual(
                next_start, start + timezone.timedelta(minutes=minutes) + GAP
            )
