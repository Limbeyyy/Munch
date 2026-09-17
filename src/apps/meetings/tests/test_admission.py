"""Admitting a guest, and what it counts as.

Letting somebody in before there is anything to come in for does two
wrong things at once: it puts them past a door the schedule says is shut,
and it counts them as present at a session that has not opened. The
host's list is not the place that decides when the door opens.
"""
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.models import GuestAttendee, Event, Session
from src.apps.meetings.tests.factories import make_event, make_host

API = '/api/v1'


class AdmissionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)

    def as_host(self):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

    def day(self, minutes_off, *, status=Event.Status.SCHEDULED):
        """A event whose only session starts that many minutes from now."""
        start = timezone.now() + timezone.timedelta(minutes=minutes_off)
        event = make_event(self.host, start=start, minutes=180)
        event.status = status
        if status == Event.Status.ACTIVE:
            event.started_at = timezone.now()
        event.save()
        Session.objects.create(
            event=event, title='Opening', starts_at=start, duration_minutes=60,
        )
        return event

    def knocking(self, event):
        return GuestAttendee.objects.create(
            event=event, full_name='Bishnu Prasad', phone='9812345678',
            status=GuestAttendee.Status.PENDING,
        )

    def admit(self, event, guest, decision='admit'):
        return self.as_host().post(
            f'{API}/events/{event.id}/admit_guest/',
            {'guest_id': str(guest.id), 'decision': decision},
            content_type='application/json',
        )

    def attendance(self, event):
        return self.as_host().get(f'{API}/events/{event.id}/attendance/').json()

    def test_a_guest_cannot_be_admitted_hours_before_the_session(self):
        event = self.day(180)
        guest = self.knocking(event)

        response = self.admit(event, guest)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'too_early')

    def test_and_is_not_counted_as_having_come(self):
        # The count moving was the visible half of the bug: the host's list
        # said one guest was in a room nobody could enter.
        event = self.day(180)
        guest = self.knocking(event)

        self.admit(event, guest)

        guest.refresh_from_db()
        self.assertEqual(guest.status, GuestAttendee.Status.PENDING)
        report = self.attendance(event)
        self.assertEqual(report['guests_admitted'], 0)
        self.assertEqual(report['attended_count'], 0)

    def test_the_request_waits_rather_than_being_thrown_away(self):
        event = self.day(180)
        guest = self.knocking(event)

        self.admit(event, guest)

        waiting = self.as_host().get(f'{API}/events/{event.id}/guests/').json()
        self.assertEqual([g['full_name'] for g in waiting], ['Bishnu Prasad'])

    def test_a_quarter_of_an_hour_before_it_the_host_may_admit(self):
        event = self.day(10)
        guest = self.knocking(event)

        response = self.admit(event, guest)

        self.assertEqual(response.status_code, 200)
        guest.refresh_from_db()
        self.assertEqual(guest.status, GuestAttendee.Status.ADMITTED)
        self.assertEqual(self.attendance(event)['guests_admitted'], 1)

    def test_a_live_session_lets_a_latecomer_in(self):
        event = self.day(-20, status=Event.Status.ACTIVE)
        session = event.sessions.first()
        session.status = Session.Status.LIVE
        session.started_at = session.starts_at
        session.save()

        self.assertEqual(self.admit(event, self.knocking(event)).status_code, 200)

    def test_in_the_gap_between_sessions_the_room_is_still_open(self):
        # The room belongs to the event, so the gap between one talk and
        # the next is part of it: a guest arriving while the host sets up
        # for the second speaker is arriving for a event that is running.
        event = self.day(-120, status=Event.Status.ACTIVE)
        done = event.sessions.first()
        done.status = Session.Status.DONE
        done.save()
        Session.objects.create(
            event=event, title='Second',
            starts_at=timezone.now() + timezone.timedelta(hours=1),
            duration_minutes=60,
        )

        response = self.admit(event, self.knocking(event))

        self.assertEqual(response.status_code, 200)

    def test_turning_somebody_away_is_never_refused(self):
        # Declining a request is not letting anybody in, so the door's
        # state has nothing to say about it.
        event = self.day(180)
        guest = self.knocking(event)

        response = self.admit(event, guest, decision='deny')

        self.assertEqual(response.status_code, 200)
        guest.refresh_from_db()
        self.assertEqual(guest.status, GuestAttendee.Status.DENIED)
