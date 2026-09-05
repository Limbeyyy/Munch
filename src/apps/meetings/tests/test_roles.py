"""Who may host, who may only attend, and the line between the two.

Identity, ownership and participation are three separate things here. A
person signed in with Google owns the meetings they create and is also a
participant in them; a guest holding a meeting code is a participant and
nothing more, however the request is dressed up.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.guest_tokens import make_guest_token
from src.apps.meetings.models import (
    Event, GuestAttendee, Meeting, MeetingParticipant,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


def google_user(email):
    """Somebody who arrived through Google rather than a password.

    The only trace that leaves on the account is the subject id, which is
    the point of these tests: it must not change what they may do.
    """
    user = make_host(email)
    user.google_subject = f'google-{email}'
    user.is_verified = True
    user.save(update_fields=['google_subject', 'is_verified'])
    return user


class GoogleUserHostsTests(TestCase):
    def setUp(self):
        self.user = google_user('oauth-host@example.com')
        self.client = signed_in(self.user)
        self.tomorrow = timezone.now() + timezone.timedelta(days=1)

    def create_event(self):
        return self.client.post(f'{API}/events/', {
            'title': 'My programme',
            'event_date': self.tomorrow.date().isoformat(),
            'meetings': [{
                'title': 'Morning',
                'scheduled_start': self.tomorrow.isoformat(),
                'duration_minutes': 60,
                'sessions': [{
                    'title': 'Opening',
                    'starts_at': self.tomorrow.isoformat(),
                    'duration_minutes': 30,
                    'speaker_name': 'A Speaker',
                    'speaker_email': 'speaker@example.com',
                    'speaker_phone': '9800000000',
                }],
            }],
        }, format='json')

    def test_a_google_user_can_create_an_event(self):
        response = self.create_event()
        self.assertEqual(response.status_code, 201)

    def test_they_own_what_they_create(self):
        created = self.create_event().json()

        event = Event.objects.get(id=created['id'])
        self.assertEqual(event.organizer_id, self.user.id)
        self.assertEqual(event.meetings.first().host_id, self.user.id)

    def test_creating_makes_them_a_host_in_the_database(self):
        self.create_event()

        roles = self.client.get(f'{API}/users/roles/').json()
        self.assertTrue(roles['is_host'])
        self.assertIn('host', roles['portals'])

    def test_they_can_start_and_end_their_own_session(self):
        self.create_event()
        session = Meeting.objects.get(host=self.user).sessions.first()

        started = self.client.post(f'{API}/sessions/{session.id}/start/')
        self.assertEqual(started.status_code, 200)
        self.assertEqual(
            Meeting.objects.get(host=self.user).status, Meeting.Status.ACTIVE
        )

        ended = self.client.post(f'{API}/sessions/{session.id}/end/')
        self.assertEqual(ended.status_code, 200)

    def test_they_can_invite_people_to_their_own_event(self):
        created = self.create_event().json()

        response = self.client.post(
            f"{API}/events/{created['id']}/invites/",
            {'emails': ['guest1@example.com']},
            format='json',
        )
        self.assertEqual(response.status_code, 200)


class HostIsAlsoAParticipantTests(TestCase):
    """Owning a meeting and being in the room are different states."""

    def setUp(self):
        self.host = google_user('owner@example.com')
        self.other = google_user('other@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        make_session(self.meeting, timezone.now(), 60)

    def test_the_owner_can_join_their_own_meeting(self):
        response = signed_in(self.host).post(f'{API}/meetings/{self.meeting.id}/join/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            MeetingParticipant.objects.filter(
                meeting=self.meeting, user=self.host, is_active=True
            ).exists()
        )

    def test_joining_leaves_them_the_host(self):
        signed_in(self.host).post(f'{API}/meetings/{self.meeting.id}/join/')

        participant = MeetingParticipant.objects.get(
            meeting=self.meeting, user=self.host
        )
        self.assertEqual(participant.role, MeetingParticipant.Role.HOST)
        # Ownership is unchanged by taking part.
        self.assertEqual(Meeting.objects.get(id=self.meeting.id).host_id, self.host.id)

    def test_asking_for_a_lesser_role_does_not_give_away_the_meeting(self):
        signed_in(self.host).post(
            f'{API}/meetings/{self.meeting.id}/join/',
            {'role': 'attendee'},
            format='json',
        )

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.host).role,
            MeetingParticipant.Role.HOST,
        )

    def test_somebody_else_joining_is_an_attendee(self):
        signed_in(self.other).post(f'{API}/meetings/{self.meeting.id}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.other).role,
            MeetingParticipant.Role.ATTENDEE,
        )

    def test_a_joiner_cannot_claim_to_be_the_host(self):
        signed_in(self.other).post(
            f'{API}/meetings/{self.meeting.id}/join/', {'role': 'host'}, format='json'
        )

        self.assertEqual(Meeting.objects.get(id=self.meeting.id).host_id, self.host.id)

    def test_the_same_person_hosts_one_meeting_and_attends_another(self):
        theirs = make_meeting(self.other, make_event(self.other), start=timezone.now())
        signed_in(self.host).post(f'{API}/meetings/{theirs.id}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=theirs, user=self.host).role,
            MeetingParticipant.Role.ATTENDEE,
        )
        self.assertEqual(Meeting.objects.get(id=self.meeting.id).host_id, self.host.id)


class GuestsCannotHostTests(TestCase):
    """A meeting code is a way in, not a claim to own the place."""

    def setUp(self):
        self.host = google_user('realhost@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        self.guest = GuestAttendee.objects.create(
            meeting=self.meeting,
            full_name='Passing Visitor',
            phone='9800000000',
            status=GuestAttendee.Status.ADMITTED,
        )
        self.token = make_guest_token(self.guest)
        self.tomorrow = timezone.now() + timezone.timedelta(days=1)

    def test_a_guest_can_get_in_with_a_meeting_code(self):
        response = APIClient().post(f'{API}/meetings/guest/knock/', {
            'meeting_code': self.meeting.meeting_code,
            'full_name': 'Someone Else',
            'phone': '9811111111',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertIn('guest_token', response.json())

    def test_a_guest_token_buys_nothing_on_the_authenticated_api(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

        for path in (f'{API}/events/', f'{API}/meetings/', f'{API}/sessions/'):
            self.assertEqual(client.get(path).status_code, 401, path)

    def test_a_guest_cannot_create_an_event(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

        response = client.post(f'{API}/events/', {
            'title': 'Mine now',
            'event_date': self.tomorrow.date().isoformat(),
            'meetings': [],
        }, format='json')

        self.assertEqual(response.status_code, 401)
        self.assertEqual(Event.objects.filter(title='Mine now').count(), 0)

    def test_a_guest_cannot_create_a_meeting(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

        response = client.post(f'{API}/meetings/with_sessions/', {
            'title': 'Mine',
            'scheduled_start': self.tomorrow.isoformat(),
            'duration_minutes': 30,
            'sessions': [],
        }, format='json')

        self.assertEqual(response.status_code, 401)

    def test_a_guest_cannot_start_a_session(self):
        session = make_session(self.meeting, timezone.now(), 60)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

        self.assertEqual(
            client.post(f'{API}/sessions/{session.id}/start/').status_code, 401
        )

    def test_a_guest_is_never_a_participant_row(self):
        # Guests are tracked separately precisely so nothing that reads
        # participants can mistake one for an account holder.
        self.assertEqual(
            MeetingParticipant.objects.filter(meeting=self.meeting).count(), 0
        )

    def test_holding_a_code_does_not_make_somebody_the_host(self):
        self.assertEqual(Meeting.objects.get(id=self.meeting.id).host_id, self.host.id)
