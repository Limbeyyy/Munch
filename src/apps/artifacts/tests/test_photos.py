"""The photographs from a event: who may add them, and when.

The Drive call is stubbed. What is worth pinning is the permission and the
timing, both of which were stated as rules rather than derived from
anything the code would enforce on its own.
"""
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.artifacts.models import EventPhoto, PhotoFolder
from src.apps.artifacts import photos as photo_service
from src.apps.meetings.models import Event, EventParticipant, RoleGrant
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_session,
)

API = '/api/v1'


def a_photo(name='group.jpg'):
    return SimpleUploadedFile(name, b'\xff\xd8\xff\xd9', content_type='image/jpeg')


class FolderTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)

    def test_every_meeting_has_a_folder_without_anybody_making_one(self):
        folders = list(photo_service.folders_for(self.event))

        self.assertEqual(len(folders), 1)
        self.assertTrue(folders[0].is_default)

    def test_asking_twice_does_not_make_two(self):
        photo_service.folders_for(self.event)
        photo_service.folders_for(self.event)

        self.assertEqual(self.event.photo_folders.count(), 1)

    def test_the_default_sorts_before_the_custom_ones(self):
        photo_service.create_folder(self.event, self.host, 'Prize distribution')
        photo_service.create_folder(self.event, self.host, 'Halls')

        names = [f.name for f in photo_service.folders_for(self.event)]

        self.assertEqual(names[0], photo_service.DEFAULT_FOLDER_NAME)
        self.assertEqual(names[1:], ['Prize distribution', 'Halls'])

    def test_an_attendee_cannot_make_folders(self):
        attendee = make_host('attendee@example.com')

        with self.assertRaises(photo_service.PhotoRefused) as refusal:
            photo_service.create_folder(self.event, attendee, 'Mine')

        self.assertEqual(refusal.exception.code, 'not_an_organizer')

    def test_two_folders_cannot_share_a_name(self):
        photo_service.create_folder(self.event, self.host, 'Seminars')

        with self.assertRaises(photo_service.PhotoRefused) as refusal:
            photo_service.create_folder(self.event, self.host, 'seminars')

        self.assertEqual(refusal.exception.code, 'name_taken')

    def test_removing_a_folder_keeps_the_photographs(self):
        # The folder is only where they were filed; the photographs are the
        # record of the day.
        folder = photo_service.create_folder(self.event, self.host, 'Halls')
        photo = EventPhoto.objects.create(
            folder=folder, event=self.event, caption='hall.jpg'
        )

        kept = photo_service.delete_folder(self.event, self.host, folder)

        photo.refresh_from_db()
        self.assertEqual(photo.folder_id, kept.id)
        self.assertTrue(kept.is_default)

    def test_the_default_folder_cannot_be_removed_or_renamed(self):
        default = photo_service.default_folder(self.event)

        for act in (
            lambda: photo_service.delete_folder(self.event, self.host, default),
            lambda: photo_service.rename_folder(
                self.event, self.host, default, 'Something else'
            ),
        ):
            with self.assertRaises(photo_service.PhotoRefused) as refusal:
                act()
            self.assertEqual(refusal.exception.code, 'folder_is_default')


class WhoMayAddPhotosTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.session = make_session(
            self.event, self.event.scheduled_start, 60, 'Haldi'
        )
        self.folder = photo_service.default_folder(self.event)

    def finish(self):
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()

    def test_nothing_can_be_added_before_the_meeting_has_finished(self):
        with self.assertRaises(photo_service.PhotoRefused) as refusal:
            photo_service.check_can_upload(self.event, self.host)

        self.assertEqual(refusal.exception.code, 'event_not_finished')

    def test_the_host_may_add_them_afterwards(self):
        self.finish()

        photo_service.check_can_upload(self.event, self.host)  # no refusal

    def test_a_co_host_may_add_them(self):
        self.finish()
        co_host = make_host('cohost@example.com')
        RoleGrant.objects.create(
            event=self.event, email=co_host.email, role=RoleGrant.Role.CO_HOST
        )

        self.assertTrue(photo_service.may_upload(self.event, co_host))

    def test_somebody_who_presented_may_add_them(self):
        # Being on the programme is what counts, not having walked into the
        # room: a speaker who presented helped make the day.
        self.finish()
        speaker = make_host('speaker@example.com')

        self.assertTrue(photo_service.may_upload(self.event, speaker))

    def test_an_attendee_may_not(self):
        self.finish()
        attendee = make_host('attendee@example.com')
        EventParticipant.objects.create(
            event=self.event, user=attendee,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

        self.assertFalse(photo_service.may_upload(self.event, attendee))
        with self.assertRaises(photo_service.PhotoRefused) as refusal:
            photo_service.check_can_upload(self.event, attendee)
        self.assertEqual(refusal.exception.code, 'not_an_organizer')

    def test_an_attendee_cannot_be_made_an_arranger_by_presenting(self):
        # may_arrange is narrower than may_upload on purpose.
        self.finish()
        speaker = make_host('speaker@example.com')

        self.assertTrue(photo_service.may_upload(self.event, speaker))
        self.assertFalse(photo_service.may_arrange(self.event, speaker))


class PhotoEndpointTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        make_session(self.event, self.event.scheduled_start, 60, 'Haldi')
        self.attendee = make_host('attendee@example.com')
        EventParticipant.objects.create(
            event=self.event, user=self.attendee,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

    def as_(self, user):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def finish(self):
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()

    def url(self, tail=''):
        return f'{API}/events/{self.event.code}/photos/{tail}'

    def test_the_page_says_whether_anything_can_be_added_yet(self):
        body = self.as_(self.host).get(self.url()).json()

        self.assertFalse(body['event_is_finished'])
        # The host is a photographer, but there is nothing to record yet.
        self.assertTrue(body['is_a_photographer'])
        self.assertFalse(body['can_upload'])
        self.assertTrue(body['can_arrange'])
        self.assertEqual(len(body['folders']), 1)

    def test_the_host_can_add_once_it_has_finished(self):
        self.finish()

        body = self.as_(self.host).get(self.url()).json()

        self.assertTrue(body['can_upload'])

    def test_an_attendee_may_look_but_not_add(self):
        self.finish()

        body = self.as_(self.attendee).get(self.url()).json()

        self.assertFalse(body['can_upload'])
        self.assertFalse(body['can_arrange'])

    def test_a_stranger_is_not_shown_the_meeting_at_all(self):
        stranger = make_host('stranger@example.com')

        response = self.as_(stranger).get(self.url())

        self.assertEqual(response.status_code, 404)

    def test_creating_a_folder(self):
        response = self.as_(self.host).post(
            self.url('folders/'), {'name': 'Prize distribution'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], 'Prize distribution')
        self.assertFalse(response.json()['is_default'])

    def test_an_attendee_creating_a_folder_is_refused(self):
        response = self.as_(self.attendee).post(
            self.url('folders/'), {'name': 'Mine'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'not_an_organizer')

    def test_uploading_before_the_meeting_ends_is_refused_and_says_why(self):
        folder = photo_service.default_folder(self.event)

        response = self.as_(self.host).post(
            self.url(f'folders/{folder.id}/upload/'), {'file': a_photo()}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'event_not_finished')

    def test_a_photograph_lands_in_the_folder_it_was_sent_to(self):
        self.finish()
        folder = photo_service.create_folder(self.event, self.host, 'Halls')

        with patch(
            'src.apps.artifacts.photos._drive_folder_id', return_value='drive-1'
        ), patch(
            'src.apps.drive.services.google_drive_adapter.GoogleDriveAdapter'
            '.upload_file',
            return_value={'id': 'file-1', 'mimeType': 'image/jpeg', 'size': '4'},
        ):
            response = self.as_(self.host).post(
                self.url(f'folders/{folder.id}/upload/'),
                {'file': a_photo('hall.jpg')},
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(EventPhoto.objects.get().folder_id, folder.id)
        self.assertEqual(response.json()['caption'], 'hall.jpg')

    def test_the_link_is_ours_rather_than_drives(self):
        # A Drive link opens Drive's viewer and asks the reader to sign in,
        # which is no use as the source of a preview.
        self.finish()
        photo = EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, caption='group.jpg',
            web_view_link='https://drive.google.com/file/d/x/view',
        )

        body = self.as_(self.attendee).get(self.url()).json()

        self.assertEqual(
            body['photos'][0]['url'], f'/api/v1/events/photos/{photo.id}/file/'
        )

    def test_a_stranger_cannot_fetch_a_photograph_by_its_link(self):
        photo = EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, drive_file_id='file-1',
        )
        stranger = make_host('stranger@example.com')

        response = self.as_(stranger).get(f'{API}/events/photos/{photo.id}/file/')

        self.assertEqual(response.status_code, 404)

    def test_it_is_sent_inline_so_a_page_can_show_it(self):
        photo = EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, drive_file_id='file-1', mime_type='image/jpeg',
        )

        with patch(
            'src.apps.artifacts.photos.photo_bytes', return_value=b'\xff\xd8'
        ):
            response = self.as_(self.attendee).get(
                f'{API}/events/photos/{photo.id}/file/'
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/jpeg')
        self.assertTrue(response['Content-Disposition'].startswith('inline'))

    def test_an_attendee_cannot_delete_somebody_elses_photograph(self):
        photo = EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, uploaded_by=self.host,
        )

        response = self.as_(self.attendee).delete(
            f'{API}/events/photos/{photo.id}/file/'
        )

        self.assertEqual(response.status_code, 403)
        self.assertTrue(EventPhoto.objects.filter(id=photo.id).exists())

    def test_the_host_can_remove_one(self):
        photo = EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, uploaded_by=self.host,
        )

        response = self.as_(self.host).delete(
            f'{API}/events/photos/{photo.id}/file/'
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(EventPhoto.objects.filter(id=photo.id).exists())


class PhotosAreNotFilesTests(TestCase):
    """The two sections were asked to stay apart, so this says they do."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)

    def test_a_photograph_does_not_appear_among_the_shared_files(self):
        from src.apps.artifacts.visibility import resources_for

        EventPhoto.objects.create(
            folder=photo_service.default_folder(self.event),
            event=self.event, caption='group.jpg',
        )

        self.assertEqual(list(resources_for(self.event, include_unreleased=True)), [])

    def test_a_photo_folder_is_not_an_artifact_row(self):
        from src.apps.artifacts.models import Artifact

        photo_service.create_folder(self.event, self.host, 'Halls')

        self.assertEqual(Artifact.objects.count(), 0)
        self.assertEqual(PhotoFolder.objects.count(), 2)
