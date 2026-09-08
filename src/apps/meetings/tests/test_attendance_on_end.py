"""Attendance survives the host ending a meeting early.

Attendance is a snapshot of who is present when a session ends. Clearing
the room before taking it records nobody, which is how a session everybody
sat through came out empty.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import (
    GuestAttendee, Meeting, MeetingParticipant, Session, SessionAttendance,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class EndingEarlyTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.event = make_event(self.host)
        began = timezone.now() - timezone.timedelta(minutes=15)
        self.meeting = make_meeting(self.host, self.event, start=began, minutes=60)
        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.started_at = began
        self.meeting.save()

        self.session = make_session(self.meeting, began, 30, 'Mehendi')
        self.session.status = Session.Status.LIVE
        self.session.started_at = began
        self.session.save()

        for person in (self.host, self.attendee):
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=person, role='attendee', is_active=True
            )
        for name, phone in [('Prabhat Karmacharya', '9811111111'),
                            ('Devraj Bhatta', '9822222222')]:
            GuestAttendee.objects.create(
                meeting=self.meeting, full_name=name, phone=phone,
                status=GuestAttendee.Status.ADMITTED,
            )

    def end_it(self):
        return signed_in(self.host).post(f'{API}/meetings/{self.meeting.id}/end/')

    def test_everybody_present_is_recorded(self):
        # The reported case: four people in the room, host ends fifteen
        # minutes early, and the session shows nobody.
        self.end_it()

        self.assertEqual(SessionAttendance.objects.filter(session=self.session).count(), 4)

    def test_the_account_holders_are_recorded(self):
        self.end_it()

        recorded = set(
            SessionAttendance.objects.filter(session=self.session, user__isnull=False)
            .values_list('user__email', flat=True)
        )
        self.assertEqual(recorded, {'host@example.com', 'attendee@example.com'})

    def test_the_guests_are_recorded(self):
        self.end_it()

        recorded = set(
            SessionAttendance.objects.filter(session=self.session, guest__isnull=False)
            .values_list('guest__full_name', flat=True)
        )
        self.assertEqual(recorded, {'Prabhat Karmacharya', 'Devraj Bhatta'})

    def test_the_session_is_closed_too(self):
        self.end_it()

        self.session.refresh_from_db()
        self.assertEqual(self.session.status, Session.Status.DONE)
        self.assertIsNotNone(self.session.ended_at)

    def test_the_room_is_still_cleared(self):
        self.end_it()

        self.assertFalse(
            MeetingParticipant.objects.filter(meeting=self.meeting, is_active=True).exists()
        )
        self.assertFalse(
            self.meeting.guests.filter(status=GuestAttendee.Status.ADMITTED).exists()
        )

    def test_a_session_nobody_started_records_nobody(self):
        # It never ran, so there is nothing to have attended.
        never = make_session(
            self.meeting, timezone.now() + timezone.timedelta(minutes=40), 30, 'Never ran'
        )

        self.end_it()

        self.assertEqual(SessionAttendance.objects.filter(session=never).count(), 0)
        never.refresh_from_db()
        self.assertEqual(never.status, Session.Status.SCHEDULED)

    def test_ending_a_meeting_with_nothing_on_stage_is_harmless(self):
        self.session.status = Session.Status.DONE
        self.session.save(update_fields=['status'])

        self.assertEqual(self.end_it().status_code, 200)
