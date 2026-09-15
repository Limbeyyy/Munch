"""Who is turned away at the guest door.

An address identifies exactly one account, so somebody typing one at a door
that asks for no proof is either signing in under their own name the long
way round or borrowing somebody else's. Both are refused.
"""
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from src.apps.accounts.models import User
from src.apps.meetings.models import GuestAttendee, Meeting
from src.apps.meetings.tests.factories import make_host, make_meeting, make_session

API = '/api/v1'


class GuestDoorTests(TestCase):
    def setUp(self):
        # Knocking is rate limited per address, and the counter lives in the
        # cache rather than the database - so it survives a test's rollback
        # and would otherwise leak into whatever runs next.
        cache.clear()
        self.addCleanup(cache.clear)

        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.save()
        self.session = make_session(self.meeting, start, 60, 'Haldi')

    def knock(self, name, phone='9812345678'):
        return self.client.post(
            f'{API}/meetings/guest/knock/',
            {
                'meeting_code': self.meeting.meeting_code,
                'full_name': name,
                'phone': phone,
            },
            content_type='application/json',
        )

    def test_a_plain_guest_is_let_in(self):
        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)

    def test_an_account_holders_address_is_refused(self):
        User.objects.create(
            email='sabina@example.org', username='sabina',
            google_subject='google-123', is_verified=True,
        )

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')
        self.assertTrue(response.json()['signs_in_with_google'])

    def test_the_case_of_the_address_makes_no_difference(self):
        User.objects.create(
            email='sabina@example.org', username='sabina', google_subject='g-1',
        )

        response = self.knock('  SABINA@Example.ORG ')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')

    def test_a_google_account_is_recognised_by_its_connection_too(self):
        # Real accounts here have the OAuth connection but no subject on
        # the user row, so reading only the column tells them to sign in
        # with a password they have never had.
        from django.utils import timezone

        from src.apps.accounts.models import GoogleConnection

        holder = User.objects.create(email='sabina@example.org', username='sabina')
        connection = GoogleConnection.objects.create(
            user=holder, provider_subject='google-456',
            token_expiry=timezone.now() + timezone.timedelta(hours=1),
        )
        connection.access_token = 'access'
        connection.save()

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json()['signs_in_with_google'])

    def test_an_account_without_google_is_told_to_sign_in_all_the_same(self):
        User.objects.create(email='ram@example.org', username='ram')

        response = self.knock('ram@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertFalse(response.json()['signs_in_with_google'])

    def test_nobody_is_seated_by_the_attempt(self):
        User.objects.create(email='sabina@example.org', username='sabina')

        self.knock('sabina@example.org')

        self.assertFalse(GuestAttendee.objects.filter(meeting=self.meeting).exists())

    def test_an_admitted_guest_row_is_no_way_around_it(self):
        # The refusal comes before the returning-guest lookup, so a row from
        # before the rule existed cannot be used to walk back in.
        User.objects.create(email='sabina@example.org', username='sabina')
        GuestAttendee.objects.create(
            meeting=self.meeting, full_name='sabina@example.org',
            phone='9812345678', status=GuestAttendee.Status.ADMITTED,
        )

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')

    def test_a_stranger_with_an_address_nobody_holds_is_let_in(self):
        # Only an address that belongs to an account is refused; a typo in
        # the name box is not grounds for turning somebody away.
        response = self.knock('nobody@example.org')

        self.assertEqual(response.status_code, 201)

    def test_a_presenter_is_still_told_about_presenting(self):
        # The more specific refusal wins: a presenter needs to know that
        # presenting is what requires the account, not merely that one
        # exists.
        User.objects.create(
            email='speaker@example.com', username='speaker', google_subject='g-2',
        )

        response = self.knock('speaker@example.com')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'presenter_must_sign_in')


class GuestRoomStatusTests(TestCase):
    """What a guest's room is told about the day it is part of.

    A guest sits in the same room as everybody else now, so they read the
    same running order - the talks, their speakers, their times, moving as
    the host moves them. To read only: nothing here lets a guest change
    anything, and nothing private is in it. The speaker's name and hall are
    on the wall of the venue; their address and telephone number are not,
    and are not here either.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.save()
        self.first = make_session(self.meeting, start, 60, 'Haldi')
        self.second = make_session(
            self.meeting, start + timezone.timedelta(minutes=75), 30, 'Mehendi'
        )
        self.guest = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad', phone='9812345678',
            status=GuestAttendee.Status.ADMITTED,
        )

    def status(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        token = make_guest_token(self.guest)
        return self.client.get(f'{API}/meetings/guest/status/?token={token}').json()

    def test_the_running_order_comes_with_it(self):
        meeting = self.status()['meeting']

        self.assertEqual(
            [s['title'] for s in meeting['sessions']], ['Haldi', 'Mehendi']
        )

    def test_with_the_times_the_room_is_working_to(self):
        meeting = self.status()['meeting']

        self.assertEqual(
            meeting['sessions'][0]['starts_at'], self.first.starts_at.isoformat()
        )
        self.assertEqual(meeting['sessions'][0]['duration_minutes'], 60)
        self.assertEqual(
            meeting['scheduled_start'], self.meeting.scheduled_start.isoformat()
        )

    def test_and_the_speakers_address_does_not(self):
        meeting = self.status()['meeting']

        for session in meeting['sessions']:
            self.assertNotIn('speaker_email', session)
            self.assertNotIn('speaker_phone', session)
            self.assertNotIn('speaker_contact', session)

    def test_somebody_who_is_not_in_the_room_is_told_nothing(self):
        response = self.client.get(f'{API}/meetings/guest/status/?token=made-up')

        self.assertEqual(response.status_code, 401)


class GuestsAreNotKeptTests(TestCase):
    """A guest is a name at a door for one afternoon, and nothing after it.

    They give a name - not a telephone number, which was collected because
    the form had a box for it and used for nothing - and their row lasts as
    long as the meeting. What outlives the meeting is the register: the
    name, against what they attended. Nothing that can be joined to
    anything, because there is no guest to look up.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.save()
        self.session = make_session(self.meeting, start, 60, 'Haldi')

    def knock(self, name, **extra):
        return self.client.post(
            f'{API}/meetings/guest/knock/',
            {'meeting_code': self.meeting.meeting_code, 'full_name': name, **extra},
            content_type='application/json',
        )

    def admit(self, guest):
        from src.apps.meetings.lifecycle import record_guest_attendance

        guest.status = GuestAttendee.Status.ADMITTED
        guest.decided_at = timezone.now()
        guest.save()
        record_guest_attendance(self.meeting, guest.full_name, guest.decided_at)
        return guest

    def end_it(self):
        from src.apps.meetings.services.meeting_service import MeetingService

        MeetingService.end_meeting(self.meeting.id)
        self.meeting.refresh_from_db()

    # -- what is asked for ------------------------------------------------

    def test_a_name_is_all_that_is_asked_for(self):
        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)
        guest = GuestAttendee.objects.get(meeting=self.meeting)
        self.assertEqual(guest.full_name, 'Bishnu Prasad')
        self.assertEqual(guest.phone, '')

    def test_a_number_sent_by_an_older_client_is_ignored_not_refused(self):
        response = self.knock('Bishnu Prasad', phone='9812345678')

        self.assertEqual(response.status_code, 201)

    def test_a_name_too_short_to_be_one_is_refused(self):
        self.assertEqual(self.knock('B').status_code, 400)

    # -- coming back ------------------------------------------------------

    def test_the_token_they_hold_gets_them_back_to_their_seat(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        guest = self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))

        response = self.knock('Bishnu Prasad', token=make_guest_token(guest))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['rejoined'])

    def test_a_name_alone_does_not_walk_in_on_somebody_elses_approval(self):
        # The old rule looked guests up by what they typed, so anybody who
        # knew an admitted guest's details was admitted as them. A name is
        # not a credential.
        self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))

        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['rejoined'])
        self.assertEqual(response.json()['guest']['status'], 'pending')

    # -- and afterwards ---------------------------------------------------

    def test_the_rows_are_gone_when_the_meeting_is_over(self):
        self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))

        self.end_it()

        self.assertEqual(GuestAttendee.objects.filter(meeting=self.meeting).count(), 0)

    def test_even_the_ones_who_were_never_let_in(self):
        GuestAttendee.objects.create(meeting=self.meeting, full_name='Never Admitted')

        self.end_it()

        self.assertEqual(GuestAttendee.objects.count(), 0)

    def test_but_the_register_remembers_who_attended(self):
        self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))

        self.end_it()

        self.assertEqual(
            [entry['name'] for entry in self.meeting.guest_attendance],
            ['Bishnu Prasad'],
        )

    def test_and_only_the_ones_who_did(self):
        GuestAttendee.objects.create(meeting=self.meeting, full_name='Never Admitted')

        self.end_it()

        self.assertEqual(self.meeting.guest_attendance, [])

    def test_the_session_register_keeps_the_name_too(self):
        from src.apps.meetings.models import Session, SessionAttendance

        self.session.status = Session.Status.LIVE
        self.session.started_at = timezone.now()
        self.session.save()
        self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))

        self.end_it()

        seat = SessionAttendance.objects.get(session=self.session, user__isnull=True)
        self.assertEqual(seat.guest_name, 'Bishnu Prasad')
        self.assertIsNone(seat.guest_id)

    def test_the_host_can_still_read_the_attendance_afterwards(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        self.admit(GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu Prasad',
        ))
        self.end_it()

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')
        report = client.get(f'{API}/meetings/{self.meeting.id}/attendance/').json()

        self.assertEqual(report['guests_admitted'], 1)
        guest_rows = [a for a in report['attended'] if a['type'] == 'guest']
        self.assertEqual([g['name'] for g in guest_rows], ['Bishnu Prasad'])
        # And nothing about them that was never asked for.
        self.assertIsNone(guest_rows[0]['phone'])

    def test_a_meeting_that_ended_untidily_is_swept_up(self):
        from src.apps.meetings.tasks import forget_guests_of_ended_meetings

        GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Left Behind',
            status=GuestAttendee.Status.ADMITTED,
        )
        Meeting.objects.filter(id=self.meeting.id).update(
            status=Meeting.Status.ENDED
        )

        forget_guests_of_ended_meetings()

        self.assertEqual(GuestAttendee.objects.count(), 0)
        self.meeting.refresh_from_db()
        self.assertEqual(
            [e['name'] for e in self.meeting.guest_attendance], ['Left Behind']
        )

    def test_a_meeting_still_running_keeps_its_guests(self):
        from src.apps.meetings.tasks import forget_guests_of_ended_meetings

        GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Still Here',
            status=GuestAttendee.Status.ADMITTED,
        )

        forget_guests_of_ended_meetings()

        self.assertEqual(GuestAttendee.objects.count(), 1)


class OneSeatPerGuestTests(TestCase):
    """A guest coming back does not sit in the room twice.

    Without the token they still hold, a knock is a fresh request - which
    is right, because a name is not a credential. But the host letting
    them in is the host saying this is the same person, so the seat they
    already had is given up rather than kept beside the new one, where it
    showed the same face in the room over and over.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.meeting = make_meeting(self.host, start=start, minutes=120)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = start
        self.meeting.save()
        make_session(self.meeting, start, 60, 'Haldi')

    def as_host(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

    def admit(self, guest):
        return self.as_host().post(
            f'{API}/meetings/{self.meeting.id}/admit_guest/',
            {'guest_id': str(guest.id), 'decision': 'admit'},
            content_type='application/json',
        )

    def knocking(self, name='Rahul Ingnam'):
        return GuestAttendee.objects.create(meeting=self.meeting, full_name=name)

    def test_the_seat_they_had_is_given_up(self):
        first = self.knocking()
        self.admit(first)

        self.admit(self.knocking())

        first.refresh_from_db()
        self.assertEqual(first.status, GuestAttendee.Status.LEFT)

    def test_so_the_room_holds_them_once(self):
        self.admit(self.knocking())
        self.admit(self.knocking())

        seated = self.meeting.guests.filter(status=GuestAttendee.Status.ADMITTED)
        self.assertEqual(seated.count(), 1)

    def test_and_the_register_names_them_once(self):
        self.admit(self.knocking())
        self.admit(self.knocking())

        self.meeting.refresh_from_db()
        self.assertEqual(
            [e['name'] for e in self.meeting.guest_attendance], ['Rahul Ingnam']
        )

    def test_somebody_else_keeps_their_own_seat(self):
        other = self.knocking('Sumin Maharjan')
        self.admit(other)

        self.admit(self.knocking('Rahul Ingnam'))

        other.refresh_from_db()
        self.assertEqual(other.status, GuestAttendee.Status.ADMITTED)
