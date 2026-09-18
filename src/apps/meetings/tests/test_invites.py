"""Who has been asked to an event, and taking somebody back off the list."""
from django.test import TestCase
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import EventInvite
from src.apps.meetings.tests.factories import make_event, make_host

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class InviteListTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.client = signed_in(self.host)

    def url(self):
        return f'{API}/events/{self.event.id}/invites/'

    def invite(self, *emails):
        return self.client.post(self.url(), {'emails': list(emails)}, format='json')

    def test_it_says_how_many_of_those_addresses_were_new(self):
        body = self.invite('a@example.com', 'b@example.com').json()

        self.assertEqual(body['added'], 2)
        self.assertEqual(body['total_invited'], 2)

    def test_inviting_the_same_person_twice_adds_nobody(self):
        self.invite('a@example.com')

        body = self.invite('a@example.com', 'b@example.com').json()

        # Two addresses sent, one of them already on the list.
        self.assertEqual(body['added'], 1)
        self.assertEqual(body['total_invited'], 2)

    def test_a_read_adds_nobody(self):
        self.invite('a@example.com')

        body = self.client.get(self.url()).json()

        self.assertEqual(body['added'], 0)
        self.assertEqual(body['total_invited'], 1)

    def test_the_list_comes_back_with_the_addresses_on_it(self):
        self.invite('b@example.com', 'a@example.com')

        body = self.client.get(self.url()).json()

        self.assertEqual([r['email'] for r in body['invited']],
                         ['a@example.com', 'b@example.com'])


class WithdrawingAnInvitationTests(TestCase):
    """A list pasted in wrong is corrected rather than lived with."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.other = make_host('other@example.com')
        self.event = make_event(self.host)
        self.client = signed_in(self.host)
        self.url = f'{API}/events/{self.event.id}/invites/'
        self.client.post(self.url, {'emails': ['a@example.com', 'b@example.com']},
                         format='json')

    def test_it_takes_that_address_off_and_leaves_the_rest(self):
        body = self.client.delete(
            self.url, {'email': 'a@example.com'}, format='json'
        ).json()

        self.assertEqual(body['total_invited'], 1)
        self.assertEqual([r['email'] for r in body['invited']], ['b@example.com'])
        self.assertFalse(
            EventInvite.objects.filter(event=self.event, email='a@example.com').exists()
        )

    def test_the_address_is_matched_however_it_was_typed(self):
        response = self.client.delete(
            self.url, {'email': 'A@Example.com'}, format='json'
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['total_invited'], 1)

    def test_somebody_who_was_never_invited_is_said_so(self):
        response = self.client.delete(
            self.url, {'email': 'nobody@example.com'}, format='json'
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(EventInvite.objects.filter(event=self.event).count(), 2)

    def test_it_needs_an_address(self):
        response = self.client.delete(self.url, {}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(EventInvite.objects.filter(event=self.event).count(), 2)

    def test_only_the_host_may_take_somebody_off(self):
        # Invited, so they can see the event - otherwise they would be
        # turned away at the door and never reach the host rule at all.
        self.client.post(self.url, {'emails': [self.other.email]}, format='json')

        response = signed_in(self.other).delete(
            self.url, {'email': 'a@example.com'}, format='json'
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(EventInvite.objects.filter(event=self.event).count(), 3)

    def test_a_stranger_is_not_even_told_the_event_exists(self):
        stranger = make_host('stranger@example.com')

        response = signed_in(stranger).delete(
            self.url, {'email': 'a@example.com'}, format='json'
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(EventInvite.objects.filter(event=self.event).count(), 2)
