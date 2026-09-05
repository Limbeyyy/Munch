"""Staying signed in, and stopping being signed in when you should."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from src.apps.accounts.models import User
from src.apps.accounts.tokens import (
    SESSION_START_CLAIM, issue_tokens, session_expired,
)

API = '/api/v1'


class RefreshTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            email='someone@example.com', username='someone', is_verified=True
        )
        self.client = APIClient()
        self.tokens = issue_tokens(self.user)

    def refresh(self, token):
        return self.client.post(
            f'{API}/auth/token_refresh/', {'refresh': token}, format='json'
        )

    def test_the_endpoint_exists_and_renews(self):
        response = self.refresh(self.tokens['refresh'])

        self.assertEqual(response.status_code, 200)
        self.assertIn('access', response.json())

    def test_a_renewed_access_token_actually_works(self):
        renewed = self.refresh(self.tokens['refresh']).json()

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {renewed['access']}")
        self.assertEqual(client.get(f'{API}/users/profile/').status_code, 200)

    def test_rotation_hands_back_a_new_refresh_token(self):
        renewed = self.refresh(self.tokens['refresh']).json()

        self.assertIn('refresh', renewed)
        self.assertNotEqual(renewed['refresh'], self.tokens['refresh'])

    def test_the_replaced_refresh_token_stops_working(self):
        self.refresh(self.tokens['refresh'])

        # Presenting the retired one again must fail - which is exactly why
        # the client has to store the rotated one.
        self.assertEqual(self.refresh(self.tokens['refresh']).status_code, 401)

    def test_renewing_twice_in_a_row_works(self):
        first = self.refresh(self.tokens['refresh']).json()
        second = self.refresh(first['refresh'])

        self.assertEqual(second.status_code, 200)

    def test_the_sign_in_time_survives_rotation(self):
        started = RefreshToken(self.tokens['refresh'])[SESSION_START_CLAIM]

        renewed = self.refresh(self.tokens['refresh']).json()

        self.assertEqual(RefreshToken(renewed['refresh'])[SESSION_START_CLAIM], started)

    def test_a_session_past_eight_hours_is_refused(self):
        stale = RefreshToken.for_user(self.user)
        stale[SESSION_START_CLAIM] = int(
            (timezone.now() - timezone.timedelta(hours=9)).timestamp()
        )

        response = self.refresh(str(stale))

        self.assertEqual(response.status_code, 401)

    def test_a_session_inside_eight_hours_is_renewed(self):
        recent = RefreshToken.for_user(self.user)
        recent[SESSION_START_CLAIM] = int(
            (timezone.now() - timezone.timedelta(hours=7)).timestamp()
        )

        self.assertEqual(self.refresh(str(recent)).status_code, 200)

    def test_rotation_cannot_be_used_to_outlive_the_cap(self):
        # Seven hours in, renew: the new token must still expire on the
        # original schedule rather than starting the eight hours again.
        aged = RefreshToken.for_user(self.user)
        aged[SESSION_START_CLAIM] = int(
            (timezone.now() - timezone.timedelta(hours=7)).timestamp()
        )
        renewed = self.refresh(str(aged)).json()

        carried = RefreshToken(renewed['refresh'])
        self.assertTrue(
            session_expired(carried, timezone.now() + timezone.timedelta(hours=2))
        )

    def test_nonsense_is_refused(self):
        self.assertEqual(self.refresh('not-a-token').status_code, 401)

    def test_logging_out_revokes_the_refresh_token(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.tokens['access']}")

        out = client.post(
            f'{API}/auth/logout/', {'refresh': self.tokens['refresh']}, format='json'
        )

        self.assertTrue(out.json()['revoked'])
        self.assertEqual(self.refresh(self.tokens['refresh']).status_code, 401)


class AccessTokenTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            email='someone@example.com', username='someone', is_verified=True
        )

    def test_an_expired_access_token_is_rejected(self):
        token = AccessToken.for_user(self.user)
        token.set_exp(from_time=timezone.now() - timezone.timedelta(hours=2))

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        # A 401 here is correct: it is the signal the client renews on.
        self.assertEqual(client.get(f'{API}/users/profile/').status_code, 401)

    def test_a_current_access_token_is_accepted(self):
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_tokens(self.user)['access']}"
        )
        self.assertEqual(client.get(f'{API}/users/profile/').status_code, 200)

    def test_no_credentials_at_all_is_refused(self):
        self.assertEqual(APIClient().get(f'{API}/users/profile/').status_code, 401)
