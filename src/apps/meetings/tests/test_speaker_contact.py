"""Who may read a speaker's details, enforced where it counts.

The rules are checked here against the API rather than the UI, because
hiding a phone number in a React component protects nobody.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from src.apps.meetings.models import ContactRequest, MeetingParticipant, Session
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')
    return client


class SpeakerContactTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.asker = make_host('asker@example.com')
        self.stranger = make_host('stranger@example.com')

        self.event = make_event(self.host)
        # An hour ago, so the sessions are over and following up is the point.
        past = timezone.now() - timezone.timedelta(hours=2)
        self.meeting = make_meeting(self.host, self.event, start=past)
        self.private = make_session(self.meeting, past, 30, 'Private talk')
        self.public = make_session(
            self.meeting, past + timezone.timedelta(minutes=45), 30, 'Public talk'
        )
        self.public.speaker_visibility = Session.SpeakerVisibility.PUBLIC
        self.public.speaker_name = 'Open Speaker'
        self.public.speaker_email = 'open@example.com'
        self.public.speaker_phone = '9811111111'
        self.public.save()

        for person in (self.asker, self.stranger):
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=person, role='attendee'
            )

        self.host_client = signed_in(self.host)
        self.asker_client = signed_in(self.asker)
        self.stranger_client = signed_in(self.stranger)

    def contact(self, client, session):
        return client.get(f'{API}/sessions/{session.id}/contact/').json()

    # --- the permission matrix -------------------------------------------

    def test_a_public_speaker_is_readable_without_asking(self):
        body = self.contact(self.asker_client, self.public)

        self.assertTrue(body['released'])
        self.assertEqual(body['email'], 'open@example.com')
        self.assertEqual(body['phone'], '9811111111')

    def test_a_private_speaker_is_not_readable_unasked(self):
        body = self.contact(self.asker_client, self.private)

        self.assertFalse(body['released'])
        self.assertNotIn('email', body)
        self.assertNotIn('phone', body)

    def test_a_pending_request_releases_nothing(self):
        self.asker_client.post(f'{API}/sessions/{self.private.id}/request_contact/')

        body = self.contact(self.asker_client, self.private)
        self.assertEqual(body['request_status'], 'pending')
        self.assertFalse(body['released'])
        self.assertNotIn('email', body)

    def test_a_declined_request_releases_nothing(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.private.id}/request_contact/'
        ).json()
        self.host_client.post(
            f'{API}/sessions/{self.private.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'decline'},
            format='json',
        )

        body = self.contact(self.asker_client, self.private)
        self.assertEqual(body['request_status'], 'declined')
        self.assertFalse(body['released'])
        self.assertNotIn('email', body)

    def test_an_approved_request_releases_the_details(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.private.id}/request_contact/'
        ).json()
        self.host_client.post(
            f'{API}/sessions/{self.private.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'approve'},
            format='json',
        )

        body = self.contact(self.asker_client, self.private)
        self.assertTrue(body['released'])
        self.assertEqual(body['email'], 'speaker@example.com')

    def test_an_approval_is_for_the_asker_alone(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.private.id}/request_contact/'
        ).json()
        self.host_client.post(
            f'{API}/sessions/{self.private.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'approve'},
            format='json',
        )

        body = self.contact(self.stranger_client, self.private)
        self.assertFalse(body['released'])
        self.assertNotIn('email', body)

    def test_speakers_are_independent_of_one_another(self):
        # The public speaker being readable says nothing about the private one.
        self.assertTrue(self.contact(self.asker_client, self.public)['released'])
        self.assertFalse(self.contact(self.asker_client, self.private)['released'])

    # --- the ways somebody might try to get round it ----------------------

    def test_the_session_list_never_carries_a_speaker_email(self):
        rows = self.asker_client.get(f'{API}/sessions/?meeting={self.meeting.id}').json()
        body = rows['results'] if isinstance(rows, dict) else rows

        for session in body:
            self.assertIsNone(session.get('speaker_contact'))
            self.assertNotIn('speaker_email', session)
            self.assertNotIn('speaker_phone', session)

    def test_the_host_reads_their_own_speakers_from_the_session(self):
        rows = self.host_client.get(f'{API}/sessions/?meeting={self.meeting.id}').json()
        body = rows['results'] if isinstance(rows, dict) else rows

        contacts = {s['title']: s['speaker_contact'] for s in body}
        self.assertEqual(contacts['Private talk']['email'], 'speaker@example.com')

    def test_somebody_outside_the_meeting_cannot_reach_the_session_at_all(self):
        outsider = signed_in(make_host('outsider@example.com'))
        response = outsider.get(f'{API}/sessions/{self.private.id}/contact/')
        self.assertEqual(response.status_code, 404)

    def test_only_the_host_decides_a_request(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.private.id}/request_contact/'
        ).json()

        response = self.stranger_client.post(
            f'{API}/sessions/{self.private.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'approve'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            ContactRequest.objects.get(id=made['id']).status, 'pending'
        )

    def test_a_request_id_from_another_session_is_refused(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.private.id}/request_contact/'
        ).json()

        # Approving it "through" a different session must not work.
        response = self.host_client.post(
            f'{API}/sessions/{self.public.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'approve'},
            format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(ContactRequest.objects.get(id=made['id']).status, 'pending')

    def test_a_host_only_sees_requests_on_their_own_programme(self):
        self.asker_client.post(f'{API}/sessions/{self.private.id}/request_contact/')

        rows = self.stranger_client.get(f'{API}/sessions/contact_requests/').json()
        self.assertEqual(rows, [])

        mine = self.host_client.get(f'{API}/sessions/contact_requests/').json()
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['speaker_name'], 'A Speaker')


class VisibilityToggleTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.asker = make_host('asker@example.com')
        self.event = make_event(self.host)
        past = timezone.now() - timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=past)
        # One speaker, two sessions - the card covers both.
        self.first = make_session(self.meeting, past, 30, 'Morning talk')
        self.second = make_session(
            self.meeting, past + timezone.timedelta(minutes=45), 30, 'Second talk'
        )
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.asker, role='attendee'
        )
        self.host_client = signed_in(self.host)
        self.asker_client = signed_in(self.asker)

    def visibilities(self):
        return sorted(
            Session.objects.filter(meeting=self.meeting).values_list(
                'speaker_visibility', flat=True
            )
        )

    def test_a_speaker_goes_public_across_every_session_they_hold(self):
        response = self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id), str(self.second.id)],
             'visibility': 'public'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.visibilities(), ['public', 'public'])

    def test_going_public_makes_the_details_readable(self):
        self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'public'},
            format='json',
        )

        body = self.asker_client.get(f'{API}/sessions/{self.first.id}/contact/').json()
        self.assertTrue(body['released'])

    def test_going_private_again_closes_them_at_once(self):
        self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'public'},
            format='json',
        )
        self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'private'},
            format='json',
        )

        body = self.asker_client.get(f'{API}/sessions/{self.first.id}/contact/').json()
        self.assertFalse(body['released'])
        self.assertNotIn('email', body)

    def test_an_approval_survives_a_trip_through_public(self):
        made = self.asker_client.post(
            f'{API}/sessions/{self.first.id}/request_contact/'
        ).json()
        self.host_client.post(
            f'{API}/sessions/{self.first.id}/decide_contact/',
            {'request_id': made['id'], 'decision': 'approve'},
            format='json',
        )
        for state in ('public', 'private'):
            self.host_client.post(
                f'{API}/sessions/set_visibility/',
                {'session_ids': [str(self.first.id)], 'visibility': state},
                format='json',
            )

        # The host decided about this person; that decision still stands.
        body = self.asker_client.get(f'{API}/sessions/{self.first.id}/contact/').json()
        self.assertTrue(body['released'])

    def test_the_two_states_cannot_both_hold(self):
        # They are one field with two values, so this is what "mutually
        # exclusive" means here: anything else is refused outright.
        response = self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'both'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.visibilities(), ['private', 'private'])

    def test_only_the_host_may_change_visibility(self):
        response = self.asker_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'public'},
            format='json',
        )
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(self.visibilities(), ['private', 'private'])

    def test_a_session_outside_the_programme_is_refused(self):
        other_host = make_host('other@example.com')
        other = make_session(
            make_meeting(other_host, make_event(other_host)),
            timezone.now(), 30, 'Not mine',
        )

        response = self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id), str(other.id)], 'visibility': 'public'},
            format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.visibilities(), ['private', 'private'])
        self.assertEqual(
            Session.objects.get(id=other.id).speaker_visibility, 'private'
        )

    def test_a_public_speaker_needs_no_request(self):
        self.host_client.post(
            f'{API}/sessions/set_visibility/',
            {'session_ids': [str(self.first.id)], 'visibility': 'public'},
            format='json',
        )

        response = self.asker_client.post(
            f'{API}/sessions/{self.first.id}/request_contact/'
        )
        self.assertEqual(response.status_code, 400)
