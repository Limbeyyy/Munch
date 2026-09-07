"""Writing a session's summary, and letting it out.

A summary is the thing people quote afterwards, so the rule worth pinning
down is that nothing reaches an attendee until the host has published it.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import MeetingParticipant, Session, SessionSummary
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)
from src.apps.transcription.models import TranscriptionSegment

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class SummaryTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.event = make_event(self.host)
        past = timezone.now() - timezone.timedelta(hours=2)
        self.meeting = make_meeting(self.host, self.event, start=past)
        self.session = make_session(self.meeting, past, 60, 'Opening')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee, role='attendee'
        )
        self.host_client = signed_in(self.host)
        self.attendee_client = signed_in(self.attendee)

    def url(self, tail='summary'):
        return f'{API}/sessions/{self.session.id}/{tail}/'

    def write(self, body, client=None):
        return (client or self.host_client).put(
            self.url(), {'body': body}, format='json'
        )

    def publish(self, client=None):
        return (client or self.host_client).post(self.url('publish_summary'))

    # --- writing ----------------------------------------------------------

    def test_an_unwritten_summary_offers_the_transcript_as_a_draft(self):
        for i, line in enumerate(['We opened at nine.', 'Sixty-nine districts passed.']):
            TranscriptionSegment.objects.create(
                meeting=self.meeting, session=self.session, speaker_id='device',
                text=line, start_time=i * 10, end_time=i * 10 + 5, is_final=True,
            )

        body = self.host_client.get(self.url()).json()

        self.assertIn('Sixty-nine districts passed.', body['body'])
        self.assertFalse(body['saved'])
        self.assertEqual(SessionSummary.objects.count(), 0)

    def test_opening_the_draft_does_not_create_one(self):
        self.host_client.get(self.url())
        self.assertEqual(SessionSummary.objects.count(), 0)

    def test_writing_one_saves_it_awaiting_approval(self):
        response = self.write('Sixty-nine of 77 districts passed.')

        self.assertEqual(response.status_code, 200)
        summary = SessionSummary.objects.get(session=self.session)
        self.assertEqual(summary.status, SessionSummary.Status.NEEDS_APPROVAL)
        self.assertFalse(summary.is_published)

    def test_writing_records_who_wrote_it(self):
        self.write('A short account.')
        self.assertEqual(
            SessionSummary.objects.get(session=self.session).updated_by_id, self.host.id
        )

    def test_only_the_host_writes(self):
        response = self.write('Mine now', client=self.attendee_client)

        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(SessionSummary.objects.count(), 0)

    # --- publishing --------------------------------------------------------

    def test_publishing_lets_it_out(self):
        self.write('Sixty-nine of 77 districts passed.')

        response = self.publish()

        self.assertEqual(response.status_code, 200)
        summary = SessionSummary.objects.get(session=self.session)
        self.assertTrue(summary.is_published)
        self.assertIsNotNone(summary.published_at)

    def test_an_empty_summary_cannot_be_published(self):
        self.write('   ')

        self.assertEqual(self.publish().status_code, 400)

    def test_a_summary_that_was_never_written_cannot_be_published(self):
        self.assertEqual(self.publish().status_code, 400)

    def test_only_the_host_publishes(self):
        self.write('A short account.')

        response = self.publish(client=self.attendee_client)

        self.assertIn(response.status_code, (403, 404))
        self.assertFalse(SessionSummary.objects.get(session=self.session).is_published)

    # --- who may read what -------------------------------------------------

    def test_an_attendee_cannot_read_a_draft(self):
        self.write('Still being worked on.')

        self.assertEqual(
            self.attendee_client.get(self.url()).status_code, 404
        )

    def test_an_attendee_reads_it_once_published(self):
        self.write('Sixty-nine of 77 districts passed.')
        self.publish()

        body = self.attendee_client.get(self.url()).json()

        self.assertEqual(body['body'], 'Sixty-nine of 77 districts passed.')
        self.assertTrue(body['is_published'])

    def test_an_attendee_sees_nothing_where_none_was_written(self):
        self.assertEqual(self.attendee_client.get(self.url()).status_code, 404)

    def test_editing_a_published_summary_sends_it_back_for_approval(self):
        # What is public should always be something somebody signed off on.
        self.write('First account.')
        self.publish()

        self.write('Corrected account.')

        summary = SessionSummary.objects.get(session=self.session)
        self.assertFalse(summary.is_published)
        self.assertIsNone(summary.published_at)
        self.assertEqual(self.attendee_client.get(self.url()).status_code, 404)

    def test_republishing_after_an_edit_works(self):
        self.write('First account.')
        self.publish()
        self.write('Corrected account.')

        self.publish()

        body = self.attendee_client.get(self.url()).json()
        self.assertEqual(body['body'], 'Corrected account.')

    def test_somebody_outside_the_meeting_reads_nothing(self):
        self.write('A short account.')
        self.publish()
        outsider = signed_in(make_host('outsider@example.com'))

        self.assertEqual(outsider.get(self.url()).status_code, 404)
