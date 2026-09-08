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
