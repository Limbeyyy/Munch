"""What a profile page says, and what asking for a bigger plan does."""
from django.test import TestCase
from rest_framework.test import APIClient

from src.apps.accounts.models import HostAccount, UpgradeRequest, User
from src.apps.accounts.tokens import issue_tokens

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class ProfileTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            email='someone@example.com', username='someone',
            first_name='Ram', last_name='Rimal', is_verified=True,
        )
        self.client = signed_in(self.user)

    def profile(self):
        return self.client.get(f'{API}/users/profile_summary/').json()

    def test_it_says_who_they_are(self):
        body = self.profile()

        self.assertEqual(body['user']['email'], 'someone@example.com')
        self.assertEqual(body['user']['name'], 'Ram Rimal')
        self.assertTrue(body['user']['is_verified'])

    def test_somebody_who_hosts_nothing_has_no_plan(self):
        body = self.profile()

        self.assertFalse(body['is_host'])
        self.assertIsNone(body['plan'])

    def test_a_host_sees_their_plan_and_what_is_left(self):
        HostAccount.objects.create(user=self.user, plan='free', status='trial')

        body = self.profile()

        self.assertEqual(body['plan']['id'], 'free')
        # The free trial is two events, and none are used yet.
        self.assertEqual(body['plan']['limits']['events'], 2)
        self.assertEqual(body['remaining']['events'], 2)

    def test_what_is_left_goes_down_as_it_is_used(self):
        from django.utils import timezone

        from src.apps.meetings.tests.factories import make_event

        HostAccount.objects.create(user=self.user, plan='free', status='trial')
        make_event(self.user)

        self.assertEqual(self.profile()['remaining']['events'], 1)

    def test_an_unlimited_plan_reports_no_ceiling(self):
        HostAccount.objects.create(user=self.user, plan='enterprise', status='active')

        body = self.profile()

        self.assertIsNone(body['plan']['limits']['events'])
        self.assertIsNone(body['remaining']['events'])

    def test_it_offers_the_plans_to_choose_from(self):
        body = self.profile()

        self.assertEqual(
            [p['id'] for p in body['plans']],
            ['free', 'starter', 'growth', 'business', 'enterprise'],
        )

    def test_it_needs_somebody_signed_in(self):
        self.assertEqual(
            APIClient().get(f'{API}/users/profile_summary/').status_code, 401
        )


class UpgradeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            email='someone@example.com', username='someone', is_verified=True
        )
        HostAccount.objects.create(user=self.user, plan='free', status='trial')
        self.client = signed_in(self.user)

    def ask(self, plan, note=''):
        return self.client.post(
            f'{API}/users/upgrade/', {'plan': plan, 'note': note}, format='json'
        )

    def test_asking_records_the_ask(self):
        response = self.ask('growth', note='We have three departments now.')

        self.assertEqual(response.status_code, 201)
        asked = UpgradeRequest.objects.get(user=self.user)
        self.assertEqual(asked.plan, 'growth')
        self.assertEqual(asked.from_plan, 'free')
        self.assertEqual(asked.status, UpgradeRequest.Status.ASKED)

    def test_asking_twice_is_one_ask(self):
        self.ask('growth')
        again = self.ask('growth')

        self.assertEqual(again.status_code, 200)
        self.assertEqual(UpgradeRequest.objects.filter(user=self.user).count(), 1)

    def test_the_plan_they_are_already_on_is_refused(self):
        response = self.ask('free')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'already_on_plan')

    def test_an_unknown_plan_is_refused(self):
        self.assertEqual(self.ask('platinum').status_code, 400)
        self.assertEqual(UpgradeRequest.objects.count(), 0)

    def test_they_can_see_what_they_asked_for(self):
        self.ask('business')

        body = self.client.get(f'{API}/users/upgrade/').json()

        self.assertEqual(len(body['requests']), 1)
        self.assertEqual(body['requests'][0]['plan_name'], 'Business')

    def test_nobody_sees_anybody_elses(self):
        self.ask('growth')
        other = User.objects.create(
            email='other@example.com', username='other', is_verified=True
        )

        body = signed_in(other).get(f'{API}/users/upgrade/').json()

        self.assertEqual(body['requests'], [])

    def test_the_operator_applying_it_shows_on_the_profile(self):
        # set_host_plan is how it is actually applied; the profile then
        # reports the new plan, which is what the person came to see.
        self.ask('growth')
        account = self.user.host_account
        account.plan = 'growth'
        account.status = 'active'
        account.save()

        body = self.client.get(f'{API}/users/profile_summary/').json()

        self.assertEqual(body['plan']['id'], 'growth')
        self.assertTrue(body['plan']['paid'])
