"""A host is not an attendee of their own event, by any route.

Rahul runs SOS from rahul@gmail.com. Opening the app on his phone he is
looking at other people's programmes; his own belongs in the host
portal and is not shown to him there at all. He cannot put himself on
its invitation list either - he is already at it, and being on the list
would count him twice in the headcount.
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.accounts import roles
from src.apps.meetings.models import Event, EventParticipant, Session

User = get_user_model()

EVENTS = '/api/v1/events/'


def rows(answer):
    body = answer.json()
    return body['results'] if isinstance(body, dict) else body


def titles(answer):
    return [row['title'] for row in rows(answer)]


class HostsThisTests(APITestCase):
    """The one question both guards ask."""

    def setUp(self):
        self.rahul = User.objects.create_user(
            username='rahul', email='rahul@gmail.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=2)
        self.sos = Event.objects.create(
            host=self.rahul, title='SOS', event_date=starts.date(),
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=2),
        )

    def test_it_knows_the_host_s_own_address(self):
        from src.apps.meetings.models import hosts_this

        self.assertTrue(hosts_this(self.sos, 'rahul@gmail.com'))
        self.assertTrue(hosts_this(self.sos, '  RAHUL@gmail.com '))

    def test_and_nobody_else_s(self):
        from src.apps.meetings.models import hosts_this

        self.assertFalse(hosts_this(self.sos, 'sita@example.com'))

    def test_a_host_with_no_address_matches_nobody(self):
        """Otherwise the guard would refuse every invitation there is."""
        from src.apps.meetings.models import hosts_this

        self.rahul.email = ''
        self.rahul.save(update_fields=['email'])
        self.sos.refresh_from_db()

        self.assertFalse(hosts_this(self.sos, 'sita@example.com'))
        self.assertFalse(hosts_this(self.sos, ''))


class HostOnTheAttendeeSideTests(APITestCase):
    def setUp(self):
        self.rahul = User.objects.create_user(
            username='rahul', email='rahul@gmail.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=2)
        # Created through the service, so the host gets the participant
        # row a real event gives them.
        from src.apps.meetings.services.event_service import EventService

        self.sos = EventService.create_event(
            host_id=str(self.rahul.id), title='SOS',
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=2),
            event_date=starts.date(),
        )
        self.client.force_authenticate(self.rahul)

    # --- the bug ------------------------------------------------------

    def test_the_host_does_not_meet_their_own_event_on_the_attendee_side(self):
        answer = self.client.get(EVENTS, {'as': 'attendee'})

        self.assertEqual(titles(answer), [])

    def test_the_host_still_sees_it_in_the_host_portal(self):
        answer = self.client.get(EVENTS)

        self.assertEqual(titles(answer), ['SOS'])

    def test_the_participant_row_creating_it_gave_them_is_not_attendance(self):
        # The trap: creating an event writes a participant row at once.
        self.assertTrue(
            EventParticipant.objects.filter(
                event=self.sos, user=self.rahul,
                role=EventParticipant.Role.HOST,
            ).exists()
        )
        self.assertEqual(titles(self.client.get(EVENTS, {'as': 'attendee'})), [])

    def test_somebody_else_attending_does_not_let_the_host_in(self):
        """The trap the two clauses have to share a row for.

        Asking for a participant row that is theirs, and separately for
        a participant row that is not a host's, is satisfied by two
        different rows: their own host row, and the attendee's. The
        event then appears on the host's phone because somebody else
        turned up to it.
        """
        sita = User.objects.create_user(
            username='sita', email='sita@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.sos, user=sita,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

        self.assertEqual(titles(self.client.get(EVENTS, {'as': 'attendee'})), [])
        self.assertFalse(roles.is_attendee(self.rahul))

    def test_nor_are_they_counted_an_attendee_anywhere_else(self):
        self.assertFalse(roles.is_attendee(self.rahul))
        self.assertNotIn('attendee', roles.portals_for(self.rahul))

    def test_the_details_are_refused_too_not_only_the_listing(self):
        answer = self.client.get(
            f'{EVENTS}{self.sos.id}/', {'as': 'attendee'}
        )

        self.assertEqual(answer.status_code, 404)

    # --- and cannot let himself in ------------------------------------

    def test_he_cannot_invite_his_own_address(self):
        answer = self.client.post(
            f'{EVENTS}{self.sos.id}/invites/',
            {'emails': ['rahul@gmail.com']}, format='json',
        )

        self.assertEqual(answer.status_code, 400)
        self.assertEqual(answer.json()['code'], 'host_cannot_be_invited')
        self.assertEqual(self.sos.invites.count(), 0)

    def test_however_he_types_it(self):
        answer = self.client.post(
            f'{EVENTS}{self.sos.id}/invites/',
            {'emails': ['Rahul@Gmail.com']}, format='json',
        )

        self.assertEqual(answer.status_code, 400)
        self.assertEqual(self.sos.invites.count(), 0)

    def test_one_bad_address_does_not_smuggle_a_list_through(self):
        answer = self.client.post(
            f'{EVENTS}{self.sos.id}/invites/',
            {'emails': ['sita@example.com', 'rahul@gmail.com']},
            format='json',
        )

        self.assertEqual(answer.status_code, 400)
        self.assertEqual(self.sos.invites.count(), 0)

    def test_he_can_still_invite_anybody_else(self):
        answer = self.client.post(
            f'{EVENTS}{self.sos.id}/invites/',
            {'emails': ['sita@example.com']}, format='json',
        )

        self.assertEqual(answer.status_code, 200)
        self.assertEqual(
            list(self.sos.invites.values_list('email', flat=True)),
            ['sita@example.com'],
        )

    def test_it_is_his_address_that_is_matched_not_its_spelling(self):
        """The endpoints lower-case what is sent; the account may not.

        A host signed up as Rahul@Gmail.com is the same person as the
        rahul@gmail.com the invitation form hands over, and the guard
        is the only thing that knows it.
        """
        self.rahul.email = 'Rahul@Gmail.com'
        self.rahul.save(update_fields=['email'])

        answer = self.client.post(
            f'{EVENTS}{self.sos.id}/invites/',
            {'emails': ['rahul@gmail.com']}, format='json',
        )

        self.assertEqual(answer.status_code, 400)
        self.assertEqual(self.sos.invites.count(), 0)

    def test_nothing_can_write_the_row_even_going_round_the_endpoint(self):
        from src.apps.meetings.models import EventInvite

        with self.assertRaises(ValueError):
            EventInvite.objects.create(event=self.sos, email='rahul@gmail.com')

    def test_a_row_written_before_the_rule_still_shows_him_nothing(self):
        # Whatever is already in the table, the app does not hand him
        # back an event he runs.
        from src.apps.meetings.models import EventInvite

        EventInvite.objects.bulk_create(
            [EventInvite(event=self.sos, email='rahul@gmail.com')]
        )

        self.assertEqual(titles(self.client.get(EVENTS, {'as': 'attendee'})), [])
        self.assertFalse(roles.is_attendee(self.rahul))

    def test_speaking_at_his_own_event_does_not_let_him_in_either(self):
        Session.objects.create(
            event=self.sos, title='Opening',
            starts_at=self.sos.scheduled_start, duration_minutes=30,
            speaker_email='rahul@gmail.com',
        )

        self.assertEqual(titles(self.client.get(EVENTS, {'as': 'attendee'})), [])

    # --- somebody else's event ----------------------------------------

    def test_an_event_they_were_asked_to_still_shows(self):
        other = User.objects.create_user(
            username='sita', email='sita@example.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=3)
        theirs = Event.objects.create(
            host=other, title='Ward Meeting', event_date=starts.date(),
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=1),
        )
        theirs.invites.create(email='rahul@gmail.com')

        self.assertEqual(
            titles(self.client.get(EVENTS, {'as': 'attendee'})), ['Ward Meeting']
        )

    def test_a_stranger_s_event_shows_on_neither_side(self):
        other = User.objects.create_user(
            username='hari', email='hari@example.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=3)
        Event.objects.create(
            host=other, title='Private Briefing', event_date=starts.date(),
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=1),
        )

        self.assertNotIn('Private Briefing', titles(self.client.get(EVENTS)))
        self.assertNotIn(
            'Private Briefing',
            titles(self.client.get(EVENTS, {'as': 'attendee'})),
        )

    def test_joining_somebody_else_s_room_counts(self):
        other = User.objects.create_user(
            username='gita', email='gita@example.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=3)
        theirs = Event.objects.create(
            host=other, title='Open Hall', event_date=starts.date(),
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=1),
        )
        EventParticipant.objects.create(
            event=theirs, user=self.rahul,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

        self.assertEqual(
            titles(self.client.get(EVENTS, {'as': 'attendee'})), ['Open Hall']
        )
