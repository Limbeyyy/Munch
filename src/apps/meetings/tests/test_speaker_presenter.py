"""A speaker walks in as a presenter - and only if they signed in.

Giving an address when a session is written down is what makes somebody
its presenter. Nothing has to be granted separately. But a name and a phone
number typed at a door are not proof of anything, so knowing a speaker's
details gets a guest no further than the seats.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import GuestAttendee, MeetingParticipant, Session
from src.apps.meetings.roles import participant_role_for, speaks_at
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class SpeakerArrivesAsPresenterTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.speaker = make_host('surya@example.com')
        self.stranger = make_host('stranger@example.com')
        self.event = make_event(self.host)
        start = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=start)
        self.session = make_session(self.meeting, start, 30, 'Haldi')
        self.session.speaker_name = 'Surya Chandra Adh'
        self.session.speaker_email = 'surya@example.com'
        self.session.speaker_phone = '9800000000'
        self.session.save()

    def test_the_named_speaker_is_recognised(self):
        self.assertTrue(speaks_at(self.meeting, user=self.speaker))
        self.assertFalse(speaks_at(self.meeting, user=self.stranger))

    def test_the_address_is_matched_whatever_its_case(self):
        self.session.speaker_email = 'SURYA@example.com'
        self.session.save(update_fields=['speaker_email'])

        self.assertTrue(speaks_at(self.meeting, user=self.speaker))

    def test_they_join_as_a_presenter(self):
        signed_in(self.speaker).post(f'{API}/meetings/{self.meeting.meeting_code}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.speaker).role,
            MeetingParticipant.Role.PRESENTER,
        )

    def test_everybody_else_still_joins_as_an_attendee(self):
        signed_in(self.stranger).post(f'{API}/meetings/{self.meeting.meeting_code}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.stranger).role,
            MeetingParticipant.Role.ATTENDEE,
        )

    def test_speaking_at_one_meeting_is_not_speaking_at_another(self):
        elsewhere = make_meeting(self.host, make_event(self.host))
        make_session(elsewhere, timezone.now(), 30, 'Someone else')

        self.assertFalse(speaks_at(elsewhere, user=self.speaker))
        self.assertEqual(
            participant_role_for(elsewhere, self.speaker),
            MeetingParticipant.Role.ATTENDEE,
        )

    def test_the_host_speaking_is_still_the_host(self):
        self.session.speaker_email = self.host.email
        self.session.save(update_fields=['speaker_email'])

        self.assertEqual(
            participant_role_for(self.meeting, self.host),
            MeetingParticipant.Role.HOST,
        )

    def test_a_session_with_no_speaker_address_names_nobody(self):
        self.session.speaker_email = ''
        self.session.save(update_fields=['speaker_email'])

        self.assertFalse(speaks_at(self.meeting, user=self.speaker))
        # And an empty address must not match everybody with no address.
        self.assertFalse(speaks_at(self.meeting, email=''))


class GuestsAreOnlyEverAttendeesTests(TestCase):
    """Knowing a speaker's details is not being the speaker."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        start = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=start)
        self.session = make_session(self.meeting, start, 30, 'Haldi')
        self.session.speaker_name = 'Surya Chandra Adh'
        self.session.speaker_email = 'surya@example.com'
        self.session.speaker_phone = '9800000000'
        self.session.save()

    def knock(self, name, phone):
        return APIClient().post(f'{API}/meetings/guest/knock/', {
            'meeting_code': self.meeting.meeting_code,
            'full_name': name,
            'phone': phone,
        }, format='json')

    def test_the_speakers_phone_is_turned_away_at_the_guest_door(self):
        """Presenting is tied to an account, so the seats are not the way in.

        A name and a phone number prove neither of the things a presenter
        has to be. Somebody arriving with a presenter's details is sent to
        sign in rather than waved through.
        """
        response = self.knock('Surya Chandra Adh', '9800000000')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'presenter_must_sign_in')
        self.assertEqual(GuestAttendee.objects.filter(meeting=self.meeting).count(), 0)

    def test_the_speakers_address_typed_as_a_name_is_turned_away_too(self):
        # What the screenshot showed: the address typed into the name box.
        response = self.knock('surya@example.com', '9811111111')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'presenter_must_sign_in')

    def test_the_refusal_says_what_to_do_instead(self):
        body = self.knock('Surya Chandra Adh', '9800000000').json()

        self.assertIn('sign in with Google', body['error'])

    def test_the_number_matches_however_it_is_written(self):
        response = self.knock('Someone Else', '980-000 0000')

        self.assertEqual(response.status_code, 403)

    def test_a_co_host_named_by_email_is_turned_away_as_well(self):
        from src.apps.meetings.models import RoleGrant

        RoleGrant.objects.create(
            email='helper@example.com', role='co_host', meeting=self.meeting
        )

        response = self.knock('helper@example.com', '9899999999')

        self.assertEqual(response.status_code, 403)

    def test_an_ordinary_guest_still_gets_in(self):
        # The rule has to keep the impostor out without keeping the room out.
        response = self.knock('Suman Dhungana', '9812345678')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            GuestAttendee.objects.get(meeting=self.meeting).status,
            GuestAttendee.Status.PENDING,
        )

    def test_a_blank_speaker_phone_turns_nobody_away(self):
        # Most sessions have no speaker phone; matching on empty would shut
        # the door on everybody.
        self.session.speaker_phone = ''
        self.session.save(update_fields=['speaker_phone'])

        self.assertEqual(self.knock('Anybody', '').status_code, 400)
        self.assertEqual(self.knock('Anybody', '9812345678').status_code, 201)

    def test_a_presenter_at_another_meeting_is_only_a_guest_here(self):
        elsewhere_host = make_host('elsewhere@example.com')
        elsewhere = make_meeting(elsewhere_host, make_event(elsewhere_host),
                                 start=timezone.now())
        theirs = make_session(elsewhere, timezone.now(), 30, 'Their talk')
        theirs.speaker_email = 'guestly@example.com'
        theirs.speaker_phone = '9877777777'
        theirs.save()

        # Speaking there says nothing about this meeting.
        self.assertEqual(self.knock('Guestly', '9877777777').status_code, 201)

    def test_the_real_speaker_signing_in_still_presents(self):
        # The point of the rule: it keeps the impostor out without keeping
        # the actual speaker out.
        speaker = make_host('surya@example.com')

        signed_in(speaker).post(f'{API}/meetings/{self.meeting.meeting_code}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=speaker).role,
            MeetingParticipant.Role.PRESENTER,
        )
