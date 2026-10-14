"""One telephone number, wherever it is read.

A host sets it on the organizer's profile and an attendee sets it on
theirs. Both are the same person and the same column, so neither is
"the host's number" or "the user's number" - there is one, and both
screens have to be looking at it.

What broke that was the sign-in payload. It is the one response that
seeds the client's idea of who it is signed in as, and it left the
number out: a number set on the host's profile read as blank on the
attendee's until something happened to fetch the profile again.
"""
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from src.apps.accounts.models import User
from src.apps.accounts.serializers import UserProfileSerializer, UserSerializer
from src.apps.accounts.tokens import issue_tokens

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class OneNumberTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='sita', email='sita@example.com', password='x',
            first_name='Sita', last_name='Rai',
        )

    def test_the_profile_endpoint_carries_it_both_ways(self):
        """Which is what makes the two screens one number rather than two."""
        written = signed_in(self.user).patch(
            f'{API}/users/profile/', {'phone': '9801234567'}, format='json'
        )
        self.assertEqual(written.status_code, 200)
        self.assertEqual(written.data['phone'], '9801234567')

        read = signed_in(self.user).get(f'{API}/users/profile/')
        self.assertEqual(read.data['phone'], '9801234567')

    def test_the_sign_in_payload_carries_it(self):
        """Or the attendee screen starts blank over a number that is set.

        Asked of the endpoint rather than of the serializer: which
        serializer that view reaches for is the thing that was wrong,
        and a test that builds one itself would have passed throughout.
        """
        self.user.phone = '9801234567'
        self.user.save(update_fields=['phone'])

        with patch(
            'src.apps.accounts.services.AccountService.handle_google_callback',
            return_value={'user': self.user},
        ):
            answered = APIClient().post(
                f'{API}/auth/google_callback/',
                {'code': 'whatever', 'redirect_uri': 'https://example.test/cb'},
                format='json',
            )

        self.assertEqual(answered.status_code, 200)
        self.assertIn('phone', answered.data['user'])
        self.assertEqual(answered.data['user']['phone'], '9801234567')

    def test_the_nested_one_still_does_not(self):
        """
        UserSerializer is an event's `host` and a participant's `user`.

        A field added there is a field handed to everybody who can read
        an event, which is why the sign-in payload was changed instead
        of widening this one.
        """
        self.user.phone = '9801234567'
        self.user.save(update_fields=['phone'])

        self.assertNotIn('phone', UserSerializer(self.user).data)

    def test_setting_it_once_is_setting_it_everywhere(self):
        """The organizer's screen and the attendee's read the same column."""
        signed_in(self.user).patch(
            f'{API}/users/profile/', {'phone': '9801234567'}, format='json'
        )

        # What the organizer's profile screen reads.
        summary = signed_in(self.user).get(f'{API}/users/profile_summary/')
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.data['user']['phone'], '9801234567')

        # And what the attendee's reads.
        mine = signed_in(self.user).get(f'{API}/users/profile/')
        self.assertEqual(mine.data['phone'], '9801234567')

    def test_changing_it_changes_it_for_both(self):
        signed_in(self.user).patch(
            f'{API}/users/profile/', {'phone': '9801234567'}, format='json'
        )
        signed_in(self.user).patch(
            f'{API}/users/profile/', {'phone': '9812223344'}, format='json'
        )

        summary = signed_in(self.user).get(f'{API}/users/profile_summary/')
        mine = signed_in(self.user).get(f'{API}/users/profile/')

        self.assertEqual(summary.data['user']['phone'], '9812223344')
        self.assertEqual(mine.data['phone'], '9812223344')
