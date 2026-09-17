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
from src.apps.meetings.models import GuestAttendee, Event, EventParticipant
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_session,
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
        event = make_event(self.host, start=start, minutes=60)
        make_session(event, start, 60)
        return event

    def join(self, event, client=None):
        return (client or self.visitor_client).post(f'{API}/events/{event.id}/join/')

    def knock(self, event, phone='9812345678'):
        # Deliberately not the factory's speaker phone: somebody arriving
        # with a presenter's number is turned away, which is tested in
        # test_speaker_presenter and would mask what this file is about.
        return APIClient().post(f'{API}/events/guest/knock/', {
            'code': event.code,
            'full_name': 'A Guest',
            'phone': phone,
        }, format='json')

    # --- the window --------------------------------------------------------

    def test_the_room_opens_a_quarter_of_an_hour_early(self):
        event = self.meeting_in(60)
        self.assertEqual(
            opens_at(event),
            event.scheduled_start - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES),
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
        event = self.meeting_in(-10)
        event.status = Event.Status.ENDED
        event.save(update_fields=['status'])
        self.assertFalse(is_open(event))

    # --- who it applies to -------------------------------------------------

    def test_an_attendee_is_turned_away_before_the_window(self):
        response = self.join(self.meeting_in(20))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'too_early')

    def test_an_attendee_walks_in_once_it_opens(self):
        event = self.meeting_in(10)

        self.assertEqual(self.join(event).status_code, 200)

    def test_nobody_has_to_be_here_first(self):
        # The host has not arrived and the event has not started.
        event = self.meeting_in(10)

        self.assertEqual(self.join(event).status_code, 200)
        self.assertEqual(
            Event.objects.get(id=event.id).status, Event.Status.SCHEDULED
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
        event = self.meeting_in(40)

        body = self.join(event).json()

        self.assertIn('opens_at', body)
        self.assertIn('15 minutes', body['error'])

    # --- guests ------------------------------------------------------------

    def test_a_guest_cannot_knock_before_the_window(self):
        self.assertEqual(self.knock(self.meeting_in(20)).status_code, 403)

    def test_a_guest_knocks_once_it_opens_even_with_no_host_present(self):
        event = self.meeting_in(10)

        response = self.knock(event)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            GuestAttendee.objects.get(event=event).status,
            GuestAttendee.Status.PENDING,
        )

    def test_a_guest_request_waits_for_a_host_who_is_late(self):
        event = self.meeting_in(-5)
        self.knock(event)

        waiting = self.host_client.get(f'{API}/events/{event.id}/guests/').json()

        self.assertEqual(len(waiting), 1)
        self.assertEqual(waiting[0]['status'], 'pending')

    # --- starting ----------------------------------------------------------

    def test_starting_before_its_hour_brings_the_meeting_forward(self):
        # Ten minutes early, and the host is ready: the event is
        # happening now and lasts as long as it always did.
        event = self.meeting_in(10)
        was = event.scheduled_end - event.scheduled_start

        response = self.host_client.post(f'{API}/events/{event.id}/start/')

        self.assertEqual(response.status_code, 200)
        event.refresh_from_db()
        self.assertLess(
            abs((event.scheduled_start - timezone.now()).total_seconds()), 90
        )
        self.assertEqual(event.scheduled_end - event.scheduled_start, was)

    def test_but_not_one_set_for_another_day(self):
        # Half a day out is a misclick on next week's event, not an early
        # start, and dragging a programme forward is not done quietly.
        event = self.meeting_in(60 * 24)

        response = self.host_client.post(f'{API}/events/{event.id}/start/')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'not_yet')

    def test_it_starts_on_the_hour(self):
        event = self.meeting_in(0)

        self.assertEqual(
            self.host_client.post(f'{API}/events/{event.id}/start/').status_code, 200
        )

    def test_a_late_start_is_fine(self):
        event = self.meeting_in(-20)

        self.assertEqual(
            self.host_client.post(f'{API}/events/{event.id}/start/').status_code, 200
        )

    def test_leaving_does_not_end_it_for_everyone(self):
        event = self.meeting_in(0)
        self.host_client.post(f'{API}/events/{event.id}/join/')
        self.join(event)
        self.host_client.post(f'{API}/events/{event.id}/start/')

        self.host_client.post(f'{API}/events/{event.id}/leave/')

        self.assertEqual(
            Event.objects.get(id=event.id).status, Event.Status.ACTIVE
        )
        self.assertTrue(
            EventParticipant.objects.get(event=event, user=self.visitor).is_active
        )


class CodeIsACredentialTests(TestCase):
    """The reported failure: signed in, holding a code, never invited."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.visitor = make_host('visitor@example.com')
        start = timezone.now()
        self.event = make_event(self.host, start=start)
        make_session(self.event, start, 60)
        self.client = signed_in(self.visitor)

    def test_a_code_holder_can_look_the_meeting_up(self):
        response = self.client.get(f'{API}/events/{self.event.code}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['code'], self.event.code)

    def test_a_code_holder_can_read_the_transcript_of_an_open_room(self):
        response = self.client.get(f'{API}/events/{self.event.code}/segments/')

        self.assertEqual(response.status_code, 200)

    def test_the_meeting_says_when_it_opens_and_whether_it_may_start(self):
        entry = self.client.get(
            f'{API}/events/{self.event.code}/'
        ).json()['entry']

        self.assertTrue(entry['is_open'])
        self.assertTrue(entry['can_start'])
        self.assertEqual(entry['entry_window_minutes'], ENTRY_WINDOW_MINUTES)

    def test_a_wrong_code_still_finds_nothing(self):
        self.assertEqual(self.client.get(f'{API}/events/NOP-E00/').status_code, 404)

    def test_a_code_holder_reaches_the_room_only_after_joining(self):
        """The reported failure: the room page read but never joined.

        Looking the event up works on the strength of the code, but
        everything the room needs - who is here, the chat rules, the files
        - belongs to members. Entering a room is joining it, and until the
        page did that the room came up empty with a wall of 404s.
        """
        member_endpoints = [
            f'{API}/events/{self.event.id}/participants/',
            f'{API}/events/{self.event.id}/chat_settings/',
            f'{API}/events/{self.event.id}/resources/',
        ]
        for path in member_endpoints:
            self.assertEqual(self.client.get(path).status_code, 404, path)

        self.assertEqual(
            self.client.post(f'{API}/events/{self.event.code}/join/').status_code,
            200,
        )

        for path in member_endpoints:
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_joining_records_them_as_present(self):
        self.client.post(f'{API}/events/{self.event.code}/join/')

        present = EventParticipant.objects.get(
            event=self.event, user=self.visitor
        )
        self.assertEqual(present.role, EventParticipant.Role.ATTENDEE)
        self.assertTrue(present.is_active)

    def test_a_code_holder_cannot_change_the_meeting(self):
        # Reading is what a code earns. Editing still needs to be the host.
        response = self.client.patch(
            f'{API}/events/{self.event.code}/',
            {'title': 'Mine now'}, format='json',
        )

        self.assertIn(response.status_code, (403, 404))
        self.assertNotEqual(Event.objects.get(id=self.event.id).title, 'Mine now')
