"""An attendee taking a copy of a shared file away.

The listing carried Drive's own ``web_view_link`` and the browser was
sent there. That is the host's copy in the host's Drive: the host could
open it, and everybody else reached Google's "request access" page. The
bytes come back through here instead, where this event's own rules about
who may read what are the ones that decide.
"""
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.meetings.models import EventParticipant, Session
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'

ADAPTER = 'src.apps.drive.services.google_drive_adapter.GoogleDriveAdapter'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class ResourceDownloadTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.outsider = make_host('nobody@example.com')
        start = timezone.now()
        self.event = make_event(self.host, start=start)
        self.session = make_session(self.event, start, 30, 'Haldi')
        EventParticipant.objects.create(
            event=self.event, user=self.attendee, role='attendee'
        )
        self.file = Artifact.objects.create(
            event=self.event,
            session=self.session,
            artifact_type=ArtifactType.RESOURCE,
            display_name='slides.pdf',
            mime_type='application/pdf',
            drive_file_id='drive-1',
            visibility=Artifact.Visibility.NOW,
        )

    def url(self, artifact=None):
        return (
            f'{API}/events/{self.event.id}/resources/'
            f'{(artifact or self.file).id}/download/'
        )

    def test_an_attendee_gets_the_bytes_as_an_attachment(self):
        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'%PDF-1.4 hello'):
            response = signed_in(self.attendee).get(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'%PDF-1.4 hello')
        self.assertIn('attachment', response['Content-Disposition'])
        self.assertIn('slides.pdf', response['Content-Disposition'])
        self.assertEqual(response['Content-Type'], 'application/pdf')

    def test_a_held_file_stays_held_on_the_download_too(self):
        """Or the link is a way round the rule rather than a way to use it."""
        self.file.visibility = Artifact.Visibility.AFTER_SESSION
        self.file.save(update_fields=['visibility'])

        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'early') as got:
            response = signed_in(self.attendee).get(self.url())

        self.assertEqual(response.status_code, 403)
        got.assert_not_called()

        self.session.status = Session.Status.DONE
        self.session.save(update_fields=['status'])
        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'now'):
            response = signed_in(self.attendee).get(self.url())
        self.assertEqual(response.status_code, 200)

    def test_the_host_may_take_what_is_still_staged(self):
        """They put it there; they have to be able to check what they staged."""
        self.file.visibility = Artifact.Visibility.ORGANIZERS
        self.file.save(update_fields=['visibility'])

        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'draft'):
            response = signed_in(self.host).get(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'draft')

    def test_somebody_with_no_part_in_the_event_is_refused(self):
        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'x') as got:
            response = signed_in(self.outsider).get(self.url())

        self.assertIn(response.status_code, (403, 404))
        got.assert_not_called()

    def test_a_file_belonging_to_another_event_is_not_found(self):
        """The id in the path is not permission to read it."""
        elsewhere = make_event(self.outsider, start=timezone.now())
        theirs = Artifact.objects.create(
            event=elsewhere,
            artifact_type=ArtifactType.RESOURCE,
            display_name='theirs.pdf',
            drive_file_id='drive-2',
            visibility=Artifact.Visibility.NOW,
        )

        with patch(f'{ADAPTER}.__init__', return_value=None), \
                patch(f'{ADAPTER}.download_file', return_value=b'x') as got:
            response = signed_in(self.attendee).get(self.url(theirs))

        self.assertEqual(response.status_code, 404)
        got.assert_not_called()
