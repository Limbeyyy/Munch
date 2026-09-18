"""A speaker's handouts, filed against the talk they were written for.

A shared file used to belong to whatever was on stage when it was sent,
which is right for somebody sharing slides mid-talk and no use at all for
an organizer staging a speaker's documents a week beforehand: nothing is
on stage yet, so everything landed loose on the event.

The upload takes the session it belongs to now, and there is a way to
take one back off.
"""
from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.meetings.models import EventParticipant
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'

DRIVE = (
    'src.apps.drive.services.google_drive_adapter.GoogleDriveAdapter.upload_file'
)
FOLDER = (
    'src.apps.artifacts.services.artifact_service.MeetingArtifactService'
    '._get_or_create_resources_folder'
)
SHARE = (
    'src.apps.artifacts.services.artifact_service.MeetingArtifactService'
    '._share_with_participants'
)


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


def a_file(name='slides.pdf'):
    return SimpleUploadedFile(name, BytesIO(b'%PDF-1.4').read(), 'application/pdf')


class AgendaDocumentTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now()
        self.event = make_event(self.host, start=start)
        self.talk = make_session(self.event, start, 30, 'Opening')
        EventParticipant.objects.create(
            event=self.event, user=self.attendee, role='attendee'
        )
        self.url = f'{API}/events/{self.event.id}/resources/'

    def upload(self, who, body):
        with patch(FOLDER, return_value='folder-1'), patch(SHARE), patch(
            DRIVE,
            return_value={
                'id': 'drive-1', 'mimeType': 'application/pdf', 'size': '8',
                'webViewLink': 'https://drive.example/drive-1',
            },
        ):
            return signed_in(who).post(self.url, body, format='multipart')

    def test_a_document_is_filed_against_the_session_it_names(self):
        response = self.upload(
            self.host, {'file': a_file(), 'session': str(self.talk.id)}
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Artifact.objects.get().session_id, self.talk.id)

    def test_one_that_names_nothing_still_belongs_to_the_event(self):
        # The old behaviour: whatever is on stage owns it, and where
        # nothing is, the file is loose on the event.
        response = self.upload(self.host, {'file': a_file()})

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(Artifact.objects.get().session_id)

    def test_a_session_from_another_event_is_refused(self):
        elsewhere = make_event(self.host, start=timezone.now())
        theirs = make_session(elsewhere, timezone.now(), 30, 'Theirs')

        response = self.upload(
            self.host, {'file': a_file(), 'session': str(theirs.id)}
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Artifact.objects.exists())

    def test_an_attendee_cannot_file_against_a_session(self):
        # Which talk owns a file decides when the room gets to read it, so
        # choosing is the organizer's: otherwise anyone could hold their
        # own upload back, or let somebody else's out early.
        response = self.upload(
            self.attendee, {'file': a_file(), 'session': str(self.talk.id)}
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Artifact.objects.exists())


class RemovingADocumentTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now()
        self.event = make_event(self.host, start=start)
        self.talk = make_session(self.event, start, 30, 'Opening')
        EventParticipant.objects.create(
            event=self.event, user=self.attendee, role='attendee'
        )
        self.doc = Artifact.objects.create(
            event=self.event,
            session=self.talk,
            artifact_type=ArtifactType.RESOURCE,
            display_name='slides.pdf',
            drive_file_id='drive-1',
        )
        self.url = f'{API}/events/{self.event.id}/resources/'

    def remove(self, who, resource_id):
        with patch(
            'src.apps.drive.services.google_drive_adapter.GoogleDriveAdapter'
            '.delete_file',
            return_value=True,
        ) as gone:
            response = signed_in(who).delete(
                f'{self.url}?resource_id={resource_id}'
            )
        return response, gone

    def test_the_host_can_take_one_off(self):
        response, gone = self.remove(self.host, self.doc.id)

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Artifact.objects.filter(id=self.doc.id).exists())
        # The Drive copy goes with it: a file the host can no longer see
        # from here but is still sharing is worse than none.
        gone.assert_called_once_with('drive-1')

    def test_an_attendee_cannot(self):
        response, _ = self.remove(self.attendee, self.doc.id)

        self.assertEqual(response.status_code, 403)
        self.assertTrue(Artifact.objects.filter(id=self.doc.id).exists())

    def test_one_that_is_not_there_is_said_so(self):
        response, _ = self.remove(
            self.host, '00000000-0000-0000-0000-000000000000'
        )

        self.assertEqual(response.status_code, 404)

    def test_a_document_of_another_event_is_not_reachable_from_this_one(self):
        elsewhere = make_event(self.host, start=timezone.now())
        theirs = Artifact.objects.create(
            event=elsewhere,
            artifact_type=ArtifactType.RESOURCE,
            display_name='theirs.pdf',
        )

        response, _ = self.remove(self.host, theirs.id)

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Artifact.objects.filter(id=theirs.id).exists())
