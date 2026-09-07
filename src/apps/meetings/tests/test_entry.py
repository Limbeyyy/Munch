"""When the doors open, and who may walk in.

The room opens a quarter of an hour early for everybody on the same terms.
Nobody waits on the host, and the host waits on nobody. Only earliness is
refused.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.entry import ENTRY_WINDOW_MINUTES, is_open, opens_at
from src.apps.meetings.models import GuestAttendee, Meeting, MeetingParticipant
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class EntryWindowTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.visitor = make_host('visitor@example.com')
        self.event = make_event(self.host)
        self.host_client = signed_in(self.host)
        self.visitor_client = signed_in(self.visitor)

    def meeting_in(self, minutes):
        start = timezone.now() + timezone.timedelta(minutes=minutes)
        meeting = make_meeting(self.host, self.event, start=start, minutes=60)
        make_session(meeting, start, 60)
        return meeting

    def join(self, meeting, client=None):
        return (client or self.visitor_client).post(f'{API}/meetings/{meeting.id}/join/')

    def knock(self, meeting, phone='9800000000'):
        return APIClient().post(f'{API}/meetings/guest/knock/', {
            'meeting_code': meeting.meeting_code,
            'full_name': 'A Guest',
            'phone': phone,
        }, format='json')

    # --- the window --------------------------------------------------------

    def test_the_room_opens_a_quarter_of_an_hour_early(self):
        meeting = self.meeting_in(60)
        self.assertEqual(
            opens_at(meeting),
            meeting.scheduled_start - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES),
        )

    def test_shut_before_the_window(self):
        self.assertFalse(is_open(self.meeting_in(16)))

    def test_open_inside_the_window(self):
        self.assertTrue(is_open(self.meeting_in(14)))

    def test_open_once_the_hour_has_come(self):
        self.assertTrue(is_open(self.meeting_in(0)))

    def test_still_open_to_somebody_arriving_late(self):
        self.assertTrue(is_open(self.meeting_in(-30)))

    def test_shut_once_the_meeting_has_ended(self):
        meeting = self.meeting_in(-10)
        meeting.status = Meeting.Status.ENDED
        meeting.save(update_fields=['status'])
        self.assertFalse(is_open(meeting))

    # --- who it applies to -------------------------------------------------

    def test_an_attendee_is_turned_away_before_the_window(self):
        response = self.join(self.meeting_in(20))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'too_early')

    def test_an_attendee_walks_in_once_it_opens(self):
        meeting = self.meeting_in(10)

        self.assertEqual(self.join(meeting).status_code, 200)

    def test_nobody_has_to_be_here_first(self):
        # The host has not arrived and the meeting has not started.
        meeting = self.meeting_in(10)

        self.assertEqual(self.join(meeting).status_code, 200)
        self.assertEqual(
            Meeting.objects.get(id=meeting.id).status, Meeting.Status.SCHEDULED
        )

    def test_the_host_is_held_to_the_same_window(self):
        response = self.join(self.meeting_in(20), client=self.host_client)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'too_early')

    def test_the_host_walks_in_once_it_opens(self):
        self.assertEqual(
            self.join(self.meeting_in(10), client=self.host_client).status_code, 200
        )

    def test_the_refusal_says_when_to_come_back(self):
        meeting = self.meeting_in(40)

        body = self.join(meeting).json()

        self.assertIn('opens_at', body)
        self.assertIn('15 minutes', body['error'])

    # --- guests ------------------------------------------------------------

    def test_a_guest_cannot_knock_before_the_window(self):
        self.assertEqual(self.knock(self.meeting_in(20)).status_code, 403)

    def test_a_guest_knocks_once_it_opens_even_with_no_host_present(self):
        meeting = self.meeting_in(10)

        response = self.knock(meeting)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            GuestAttendee.objects.get(meeting=meeting).status,
            GuestAttendee.Status.PENDING,
        )

    def test_a_guest_request_waits_for_a_host_who_is_late(self):
        meeting = self.meeting_in(-5)
        self.knock(meeting)

        waiting = self.host_client.get(f'{API}/meetings/{meeting.id}/guests/').json()

        self.assertEqual(len(waiting), 1)
        self.assertEqual(waiting[0]['status'], 'pending')

    # --- starting ----------------------------------------------------------

    def test_the_meeting_cannot_be_started_before_its_hour(self):
        meeting = self.meeting_in(10)

        response = self.host_client.post(f'{API}/meetings/{meeting.id}/start/')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'not_yet')

    def test_it_starts_on_the_hour(self):
        meeting = self.meeting_in(0)

        self.assertEqual(
            self.host_client.post(f'{API}/meetings/{meeting.id}/start/').status_code, 200
        )

    def test_a_late_start_is_fine(self):
        meeting = self.meeting_in(-20)

        self.assertEqual(
            self.host_client.post(f'{API}/meetings/{meeting.id}/start/').status_code, 200
        )

    def test_leaving_does_not_end_it_for_everyone(self):
        meeting = self.meeting_in(0)
        self.host_client.post(f'{API}/meetings/{meeting.id}/join/')
        self.join(meeting)
        self.host_client.post(f'{API}/meetings/{meeting.id}/start/')

        self.host_client.post(f'{API}/meetings/{meeting.id}/leave/')

        self.assertEqual(
            Meeting.objects.get(id=meeting.id).status, Meeting.Status.ACTIVE
        )
        self.assertTrue(
            MeetingParticipant.objects.get(meeting=meeting, user=self.visitor).is_active
        )


class CodeIsACredentialTests(TestCase):
    """The reported failure: signed in, holding a code, never invited."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.visitor = make_host('visitor@example.com')
        self.event = make_event(self.host)
        start = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=start)
        make_session(self.meeting, start, 60)
        self.client = signed_in(self.visitor)

    def test_a_code_holder_can_look_the_meeting_up(self):
        response = self.client.get(f'{API}/meetings/{self.meeting.meeting_code}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['meeting_code'], self.meeting.meeting_code)

    def test_a_code_holder_can_read_the_transcript_of_an_open_room(self):
        response = self.client.get(f'{API}/meetings/{self.meeting.meeting_code}/segments/')

        self.assertEqual(response.status_code, 200)

    def test_the_meeting_says_when_it_opens_and_whether_it_may_start(self):
        entry = self.client.get(
            f'{API}/meetings/{self.meeting.meeting_code}/'
        ).json()['entry']

        self.assertTrue(entry['is_open'])
        self.assertTrue(entry['can_start'])
        self.assertEqual(entry['entry_window_minutes'], ENTRY_WINDOW_MINUTES)

    def test_a_wrong_code_still_finds_nothing(self):
        self.assertEqual(self.client.get(f'{API}/meetings/NOP-E00/').status_code, 404)

    def test_a_code_holder_cannot_change_the_meeting(self):
        # Reading is what a code earns. Editing still needs to be the host.
        response = self.client.patch(
            f'{API}/meetings/{self.meeting.meeting_code}/',
            {'title': 'Mine now'}, format='json',
        )

        self.assertIn(response.status_code, (403, 404))
        self.assertNotEqual(Meeting.objects.get(id=self.meeting.id).title, 'Mine now')
