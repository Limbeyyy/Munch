"""A speaker as a profile, rather than four strings on a talk.

A name, a role, an email and a telephone number written onto each
session is enough to print a running order and not enough for anything
else: somebody speaking twice was two unrelated sets of strings, their
photograph had nowhere to live, and correcting a misspelt name meant
finding every talk it was on.

What the strings still do is matter, so they are kept in step rather
than replaced - a running order must read the same whether or not a
profile was ever filled in.
"""
import io
import shutil
import tempfile

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import Session, Speaker
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'
MEDIA = tempfile.mkdtemp()


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


def an_image(name='face.png'):
    """A real one-pixel PNG, so ImageField's own check is satisfied."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    buffer = io.BytesIO()
    Image.new('RGB', (1, 1), (10, 20, 30)).save(buffer, format='PNG')
    return SimpleUploadedFile(name, buffer.getvalue(), 'image/png')


@override_settings(MEDIA_ROOT=MEDIA)
class SpeakerProfileTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.host = make_host('host@example.com')
        self.other = make_host('other@example.com')
        start = timezone.now() + timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, minutes=120)
        self.opening = make_session(self.event, start, 30, 'Opening')
        self.closing = make_session(
            self.event, start + timezone.timedelta(hours=1), 30, 'Closing'
        )
        self.client = signed_in(self.host)
        self.url = f'{API}/events/{self.event.id}/speakers/'

    def add(self, **over):
        body = {'full_name': 'Anjelika Sah', 'position': 'VP of Engineering',
                'organization': 'Prixa Technologies'}
        body.update(over)
        return self.client.post(self.url, body, format='multipart')

    # -- the profile ------------------------------------------------------

    def test_a_speaker_is_written_against_the_event(self):
        got = self.add()

        self.assertEqual(got.status_code, 201)
        speaker = Speaker.objects.get()
        self.assertEqual(speaker.event_id, self.event.id)
        self.assertEqual(speaker.full_name, 'Anjelika Sah')
        self.assertEqual(speaker.position, 'VP of Engineering')

    def test_the_links_are_optional(self):
        got = self.add(linkedin_url='https://linkedin.com/in/anjelika')

        self.assertEqual(got.status_code, 201)
        self.assertEqual(
            Speaker.objects.get().linkedin_url,
            'https://linkedin.com/in/anjelika',
        )

    def listed(self):
        """The speakers, out of whichever shape the list comes back in."""
        body = self.client.get(self.url).data
        return body['results'] if isinstance(body, dict) else body

    def test_they_come_back_in_the_list(self):
        self.add()

        rows = self.listed()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['full_name'], 'Anjelika Sah')

    def test_nobody_but_the_host_writes_one(self):
        got = signed_in(self.other).post(
            self.url, {'full_name': 'Nobody'}, format='multipart'
        )

        self.assertEqual(got.status_code, 403)
        self.assertFalse(Speaker.objects.exists())

    # -- the photograph ---------------------------------------------------

    def test_a_photograph_is_kept_and_comes_back_as_a_link(self):
        got = self.add(photo=an_image())

        self.assertEqual(got.status_code, 201)
        self.assertTrue(got.data['photo_url'])
        self.assertTrue(Speaker.objects.get().photo)

    def test_one_can_be_replaced_without_resending_the_profile(self):
        speaker = Speaker.objects.create(
            event=self.event, full_name='Anjelika Sah'
        )

        got = self.client.post(
            f'{self.url}{speaker.id}/photo/',
            {'photo': an_image('newer.png')},
            format='multipart',
        )

        self.assertEqual(got.status_code, 200)
        speaker.refresh_from_db()
        self.assertTrue(speaker.photo)

    def test_a_profile_without_one_says_so_plainly(self):
        self.add()

        self.assertIsNone(self.listed()[0]['photo_url'])

    # -- which talks they give --------------------------------------------

    def test_they_can_be_put_on_a_talk(self):
        self.add(session_ids=[str(self.opening.id)])

        self.opening.refresh_from_db()
        self.assertEqual(self.opening.speaker, Speaker.objects.get())

    def test_and_on_several(self):
        self.add(session_ids=[str(self.opening.id), str(self.closing.id)])

        self.assertEqual(Speaker.objects.get().sessions.count(), 2)

    def test_the_talk_keeps_its_own_copy_of_the_name(self):
        """A running order must read the same without the profile.

        Every event that already exists names its speakers as text, and a
        programme imported from a spreadsheet arrives that way, so the
        room reads the string rather than following the link.
        """
        self.add(session_ids=[str(self.opening.id)])

        self.opening.refresh_from_db()
        self.assertEqual(self.opening.speaker_name, 'Anjelika Sah')
        self.assertEqual(self.opening.speaker_role, 'VP of Engineering')

    def test_taking_them_off_one_leaves_the_others(self):
        self.add(session_ids=[str(self.opening.id), str(self.closing.id)])
        speaker = Speaker.objects.get()

        self.client.patch(
            f'{self.url}{speaker.id}/',
            {'session_ids': [str(self.closing.id)]},
            format='json',
        )

        self.assertEqual(
            [one.id for one in speaker.sessions.all()], [self.closing.id]
        )

    def test_a_patch_that_names_no_talks_leaves_them_alone(self):
        """Editing a name should not quietly clear every assignment."""
        self.add(session_ids=[str(self.opening.id)])
        speaker = Speaker.objects.get()

        self.client.patch(
            f'{self.url}{speaker.id}/', {'full_name': 'A. Sah'}, format='json'
        )

        self.assertEqual(speaker.sessions.count(), 1)

    def test_a_talk_from_another_event_is_not_taken(self):
        elsewhere = make_event(self.host, start=timezone.now())
        theirs = make_session(elsewhere, timezone.now(), 30, 'Theirs')

        self.add(session_ids=[str(theirs.id)])

        theirs.refresh_from_db()
        self.assertIsNone(theirs.speaker)

    # -- removing one -----------------------------------------------------

    def test_removing_a_profile_leaves_the_talk_standing(self):
        """The name stays. Emptying a running order because somebody
        tidied a list of people would be a strange way to lose it."""
        self.add(session_ids=[str(self.opening.id)])
        speaker = Speaker.objects.get()

        self.client.delete(f'{self.url}{speaker.id}/')

        self.opening.refresh_from_db()
        self.assertIsNone(self.opening.speaker)
        self.assertEqual(self.opening.speaker_name, 'Anjelika Sah')
        self.assertTrue(Session.objects.filter(id=self.opening.id).exists())


@override_settings(MEDIA_ROOT=MEDIA)
class TheSpeakerOnASessionTests(TestCase):
    """What every screen that names a speaker can now show."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() + timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, minutes=120)
        self.session = make_session(self.event, start, 30, 'Opening')
        self.client = signed_in(self.host)

    def first_session(self):
        body = self.client.get(f'{API}/sessions/?event={self.event.id}').data
        rows = body['results'] if isinstance(body, dict) else body
        return rows[0]

    def test_the_session_carries_the_speakers_photograph(self):
        speaker = Speaker.objects.create(
            event=self.event, full_name='Anjelika Sah', photo=an_image()
        )
        self.session.speaker = speaker
        self.session.save(update_fields=['speaker'])

        row = self.first_session()

        self.assertTrue(row['speaker_photo_url'])

    def test_and_says_nothing_where_there_is_no_profile(self):
        row = self.first_session()

        self.assertIsNone(row['speaker_photo_url'])

    def test_the_details_are_still_never_read_back_with_it(self):
        """The profile must not become a second way past the privacy rule."""
        Speaker.objects.create(
            event=self.event, full_name='Anjelika Sah',
            email='her@example.com', phone='9800000000',
        )

        row = self.first_session()

        self.assertNotIn('speaker_email', row)
        self.assertNotIn('speaker_phone', row)
