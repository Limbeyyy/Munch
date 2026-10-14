"""What a guest leaves at the door, besides a name.

A telephone number and an address were dropped once, on the reasoning
that a name is all the host needs to decide and all the register keeps.
They are asked for again: an organizer running a real event has to be
able to reach the people who were in the hall afterwards.

What has not changed is what they are for. Neither decides anything.
Admission is the host saying yes, exactly as before, and a guest is
never turned away over a form field.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.meetings.models import Event, GuestAttendee, Session
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'


class GuestContactTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now()
        self.event = make_event(self.host, start=start)
        self.event.status = Event.Status.ACTIVE
        self.event.save(update_fields=['status'])
        self.session = make_session(self.event, start, 60, 'Haldi')
        self.session.status = Session.Status.LIVE
        self.session.started_at = start
        self.session.save(update_fields=['status', 'started_at'])
        self.client = APIClient()

    def knock(self, **over):
        body = {
            'code': self.event.code,
            'full_name': 'Sita Rai',
            'phone': '9801234567',
            'email': 'sita@example.com',
        }
        body.update(over)
        return self.client.post(f'{API}/events/guest/knock/', body, format='json')

    def test_both_are_written_down(self):
        response = self.knock()

        self.assertEqual(response.status_code, 201)
        guest = GuestAttendee.objects.get(event=self.event, full_name='Sita Rai')
        self.assertEqual(guest.phone, '9801234567')
        self.assertEqual(guest.email, 'sita@example.com')

    def test_the_host_is_told_them(self):
        """Collected and never shown is the mistake that got them removed."""
        response = self.knock()

        self.assertEqual(response.data['guest']['phone'], '9801234567')
        self.assertEqual(response.data['guest']['email'], 'sita@example.com')

    def test_a_guest_is_not_turned_away_for_leaving_them_out(self):
        """An older client, or a door that stopped insisting."""
        response = self.client.post(
            f'{API}/events/guest/knock/',
            {'code': self.event.code, 'full_name': 'Hari Thapa'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        guest = GuestAttendee.objects.get(event=self.event, full_name='Hari Thapa')
        self.assertEqual(guest.phone, '')
        self.assertEqual(guest.email, '')

    def test_an_address_that_is_not_one_is_refused(self):
        response = self.knock(email='not-an-address')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            GuestAttendee.objects.filter(full_name='Sita Rai').exists()
        )

    def test_coming_back_replaces_what_was_known(self):
        """A number that has changed is one the organizer cannot reach."""
        self.knock()
        guest = GuestAttendee.objects.get(full_name='Sita Rai')
        guest.status = GuestAttendee.Status.PENDING
        guest.save(update_fields=['status'])

        self.knock(phone='9812223344', email='sita.rai@example.com')

        guest.refresh_from_db()
        self.assertEqual(guest.phone, '9812223344')
        self.assertEqual(guest.email, 'sita.rai@example.com')
        # And one row for one person, not a second for the same afternoon.
        self.assertEqual(
            GuestAttendee.objects.filter(event=self.event, full_name='Sita Rai').count(),
            1,
        )

    def test_an_empty_box_does_not_erase_what_is_known(self):
        self.knock()
        guest = GuestAttendee.objects.get(full_name='Sita Rai')
        guest.status = GuestAttendee.Status.PENDING
        guest.save(update_fields=['status'])

        self.knock(phone='', email='')

        guest.refresh_from_db()
        self.assertEqual(guest.phone, '9801234567')
        self.assertEqual(guest.email, 'sita@example.com')

    def test_neither_one_admits_anybody(self):
        """They are a way to be reached, not a way in."""
        response = self.knock()

        self.assertEqual(response.data['guest']['status'],
                         GuestAttendee.Status.PENDING)
