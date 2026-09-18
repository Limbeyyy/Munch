"""What somebody puts on their own profile.

An account is made from a Google sign-in, which carries a name and an
address and nothing else. The profile page asks for the rest - how to
reach them, what they do, and who they do it for - so there has to be
somewhere to keep it.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from src.apps.accounts.models import User
from src.apps.accounts.tokens import issue_tokens

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class ProfileDetailTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='sarah@example.com', username='sarah', password='x',
            first_name='Sarah', last_name='Sharma',
        )

    def test_the_details_can_be_written(self):
        response = signed_in(self.user).patch(f'{API}/users/profile/', {
            'first_name': 'Sarah',
            'last_name': 'Sharma',
            'phone': '+977 9801234567',
            'position': 'Director, Emergency Services',
            'organization_name': 'Emergency Service Department',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.phone, '+977 9801234567')
        self.assertEqual(self.user.position, 'Director, Emergency Services')
        self.assertEqual(self.user.organization_name, 'Emergency Service Department')

    def test_they_are_read_back_with_the_profile(self):
        self.user.phone = '+977 9801234567'
        self.user.position = 'Director, Emergency Services'
        self.user.organization_name = 'Emergency Service Department'
        self.user.save()

        body = signed_in(self.user).get(f'{API}/users/profile_summary/').json()

        self.assertEqual(body['user']['phone'], '+977 9801234567')
        self.assertEqual(body['user']['position'], 'Director, Emergency Services')
        self.assertEqual(
            body['user']['organization_name'], 'Emergency Service Department'
        )
        # The name is split, so a form can offer one field per part.
        self.assertEqual(body['user']['first_name'], 'Sarah')
        self.assertEqual(body['user']['last_name'], 'Sharma')

    def test_none_of_it_is_required(self):
        body = signed_in(self.user).get(f'{API}/users/profile_summary/').json()

        self.assertEqual(body['user']['phone'], '')
        self.assertEqual(body['user']['position'], '')

    def test_the_address_is_still_not_something_you_can_change(self):
        # It is what the account is, and what Google signed them in as.
        signed_in(self.user).patch(
            f'{API}/users/profile/', {'email': 'someone@else.com'}, format='json'
        )

        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'sarah@example.com')
