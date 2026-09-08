"""Whose dashboard a programme appears on.

Being named is enough. A speaker should open their dashboard and find the
session they are due to give, rather than having to be sent a link before
the day exists for them at all - and the same goes for somebody given a
role over part of it.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.access import can_see_meeting
from src.apps.meetings.models import MeetingInvite, RoleGrant, Session
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class WhoSeesTheProgrammeTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=self.start)
        self.session = make_session(self.meeting, self.start, 30, 'Haldi')

    def counts(self, user):
        client = signed_in(user)

        def rows(path):
            body = client.get(path).json()
            return len(body['results'] if isinstance(body, dict) else body)

        return (
            rows(f'{API}/events/'),
            rows(f'{API}/meetings/'),
            rows(f'{API}/sessions/'),
        )

    # --- the people who should see it ---------------------------------------

    def test_the_host_sees_their_own(self):
        self.assertEqual(self.counts(self.host), (1, 1, 1))

    def test_an_invited_attendee_sees_it(self):
        guest = make_host('invited@example.com')
        MeetingInvite.objects.create(
            meeting=self.meeting, email=guest.email, invited_by=self.host
        )

        self.assertEqual(self.counts(guest), (1, 1, 1))

    def test_the_named_speaker_sees_it(self):
        speaker = make_host('surya@example.com')
        self.session.speaker_email = speaker.email
        self.session.save(update_fields=['speaker_email'])

        self.assertEqual(self.counts(speaker), (1, 1, 1))

    def test_the_speaker_sees_the_whole_running_order(self):
        # Knowing what runs before and after yours is the point of one.
        speaker = make_host('surya@example.com')
        self.session.speaker_email = speaker.email
        self.session.save(update_fields=['speaker_email'])
        make_session(
            self.meeting, self.start + timezone.timedelta(minutes=45), 30, 'Mehendi'
        )

        self.assertEqual(self.counts(speaker)[2], 2)

    def test_the_address_matches_whatever_its_case(self):
        speaker = make_host('surya@example.com')
        self.session.speaker_email = 'SURYA@Example.com'
        self.session.save(update_fields=['speaker_email'])

        self.assertEqual(self.counts(speaker), (1, 1, 1))

    def test_a_co_host_named_by_email_sees_it(self):
        helper = make_host('helper@example.com')
        RoleGrant.objects.create(
            email=helper.email, role='co_host', meeting=self.meeting
        )

        self.assertEqual(self.counts(helper), (1, 1, 1))

    def test_a_role_over_the_whole_event_shows_the_event(self):
        helper = make_host('helper@example.com')
        RoleGrant.objects.create(email=helper.email, role='co_host', event=self.event)

        self.assertEqual(self.counts(helper), (1, 1, 1))

    def test_a_role_over_one_session_shows_it(self):
        helper = make_host('helper@example.com')
        RoleGrant.objects.create(
            email=helper.email, role='presenter', session=self.session
        )

        self.assertEqual(self.counts(helper), (1, 1, 1))

    # --- and the people who should not --------------------------------------

    def test_a_stranger_sees_nothing(self):
        self.assertEqual(self.counts(make_host('stranger@example.com')), (0, 0, 0))

    def test_a_blank_address_matches_no_unnamed_session(self):
        """The guard this needs: most sessions have no speaker address.

        Matching on an empty string would hand somebody every session
        nobody had been named for, which is most of them.
        """
        self.session.speaker_email = ''
        self.session.save(update_fields=['speaker_email'])
        nobody = make_host('nobody@example.com')
        nobody.email = ''
        nobody.save(update_fields=['email'])

        self.assertEqual(self.counts(nobody), (0, 0, 0))

    def test_speaking_at_one_programme_shows_only_that_one(self):
        speaker = make_host('surya@example.com')
        self.session.speaker_email = speaker.email
        self.session.save(update_fields=['speaker_email'])
        # Somebody else's day, which they have no part in.
        other_host = make_host('other@example.com')
        make_session(
            make_meeting(other_host, make_event(other_host)), timezone.now(), 30, 'Theirs'
        )

        self.assertEqual(self.counts(speaker), (1, 1, 1))

    def test_can_see_meeting_agrees_with_the_lists(self):
        speaker = make_host('surya@example.com')
        self.session.speaker_email = speaker.email
        self.session.save(update_fields=['speaker_email'])

        self.assertTrue(can_see_meeting(self.meeting, speaker))
        self.assertFalse(can_see_meeting(self.meeting, make_host('stranger@example.com')))
