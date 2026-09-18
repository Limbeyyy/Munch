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
            'billing_address': 'Kathmandu, Nepal',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.phone, '+977 9801234567')
        self.assertEqual(self.user.position, 'Director, Emergency Services')
        self.assertEqual(self.user.organization_name, 'Emergency Service Department')
        self.assertEqual(self.user.billing_address, 'Kathmandu, Nepal')

    def test_they_are_read_back_with_the_profile(self):
        self.user.phone = '+977 9801234567'
        self.user.position = 'Director, Emergency Services'
        self.user.organization_name = 'Emergency Service Department'
        self.user.billing_address = 'Kathmandu, Nepal'
        self.user.save()

        body = signed_in(self.user).get(f'{API}/users/profile_summary/').json()

        self.assertEqual(body['user']['phone'], '+977 9801234567')
        self.assertEqual(body['user']['position'], 'Director, Emergency Services')
        self.assertEqual(
            body['user']['organization_name'], 'Emergency Service Department'
        )
        self.assertEqual(body['user']['billing_address'], 'Kathmandu, Nepal')
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


class ClosingAnAccountTests(TestCase):
    """Asking for an account to be closed.

    Shut at once and removed a week later. The week is the point: this is
    the sort of thing people do at midnight and regret at nine.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            email='sarah@example.com', username='sarah', password='x',
        )

    def test_it_shuts_the_account_at_once(self):
        response = signed_in(self.user).post(f'{API}/users/request_deletion/')

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.deletion_requested_at)
        self.assertFalse(self.user.is_active)

    def test_it_says_when_the_account_goes(self):
        body = signed_in(self.user).post(f'{API}/users/request_deletion/').json()

        self.assertIn('removed_on', body)
        self.assertIn('requested_at', body)

    def test_nothing_is_deleted_yet(self):
        # An event holds the attendance of everybody who came to it, which
        # is why its host is PROTECTed. The row goes when somebody deals
        # with the events, not when a button is pressed.
        signed_in(self.user).post(f'{API}/users/request_deletion/')

        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_there_is_no_second_time_to_ask(self):
        # The account is shut by the first ask, so the second is turned
        # away at the door like any other request from it.
        signed_in(self.user).post(f'{API}/users/request_deletion/')

        again = signed_in(self.user).post(f'{API}/users/request_deletion/')

        self.assertIn(again.status_code, (401, 403))

    def test_a_stranger_cannot_close_somebody_else(self):
        response = APIClient().post(f'{API}/users/request_deletion/')

        self.assertIn(response.status_code, (401, 403))
        self.user.refresh_from_db()
        self.assertIsNone(self.user.deletion_requested_at)
