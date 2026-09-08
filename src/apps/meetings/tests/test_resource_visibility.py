"""Who may read a shared file, and from when.

Four answers rather than a guess from the running order: a deck meant to
be read along with the talk and one meant to be handed out afterwards are
different things, and only the person sharing it knows which.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.artifacts.visibility import is_public, is_released, resources_for
from src.apps.meetings.models import MeetingParticipant, Session
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class VisibilityChoiceTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.event = make_event(self.host)
        start = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=start)
        self.session = make_session(self.meeting, start, 30, 'Haldi')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee, role='attendee'
        )

    def file(self, visibility, session=None):
        return Artifact.objects.create(
            meeting=self.meeting,
            session=session,
            artifact_type=ArtifactType.RESOURCE,
            display_name='slides.pdf',
            visibility=visibility,
        )

    def test_visible_now_is_readable_straight_away(self):
        shared = self.file(Artifact.Visibility.NOW, session=self.session)

        self.assertTrue(is_released(shared))

    def test_after_the_session_waits_for_it_to_finish(self):
        held = self.file(Artifact.Visibility.AFTER_SESSION, session=self.session)

        self.assertFalse(is_released(held))

        self.session.status = Session.Status.DONE
        self.session.save(update_fields=['status'])
        self.assertTrue(is_released(held))

    def test_after_the_session_with_no_session_waits_for_nothing(self):
        loose = self.file(Artifact.Visibility.AFTER_SESSION)

        self.assertTrue(is_released(loose))

    def test_organizers_only_never_reaches_the_room(self):
        private = self.file(Artifact.Visibility.ORGANIZERS, session=self.session)
        self.session.status = Session.Status.DONE
        self.session.save(update_fields=['status'])

        # Even once the session is over.
        self.assertFalse(is_released(private))

    def test_public_is_readable_whatever_the_running_order_is_doing(self):
        open_to_all = self.file(Artifact.Visibility.PUBLIC, session=self.session)

        self.assertTrue(is_released(open_to_all))
        self.assertTrue(is_public(open_to_all))

    def test_only_public_counts_as_public(self):
        self.assertFalse(is_public(self.file(Artifact.Visibility.NOW)))

    def test_the_room_is_only_handed_what_was_released(self):
        self.file(Artifact.Visibility.NOW)
        self.file(Artifact.Visibility.ORGANIZERS)
        self.file(Artifact.Visibility.AFTER_SESSION, session=self.session)

        for_room = resources_for(self.meeting, include_unreleased=False)
        for_host = resources_for(self.meeting, include_unreleased=True)

        self.assertEqual(len(for_room), 1)
        self.assertEqual(len(for_host), 3)


class ChangingVisibilityTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.event = make_event(self.host)
        start = timezone.now()
        self.meeting = make_meeting(self.host, self.event, start=start)
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee, role='attendee'
        )
        self.shared = Artifact.objects.create(
            meeting=self.meeting, artifact_type=ArtifactType.RESOURCE,
            display_name='slides.pdf',
            visibility=Artifact.Visibility.ORGANIZERS,
        )

    def change(self, client=None, **body):
        return (client or signed_in(self.host)).post(
            f'{API}/meetings/{self.meeting.id}/resource_settings/',
            {'resource_id': str(self.shared.id), **body},
            format='json',
        )

    def test_the_host_opens_it_to_the_room(self):
        response = self.change(visibility='now')

        self.assertEqual(response.status_code, 200)
        self.shared.refresh_from_db()
        self.assertEqual(self.shared.visibility, Artifact.Visibility.NOW)

    def test_the_host_sets_where_it_sits(self):
        self.change(position=3)

        self.shared.refresh_from_db()
        self.assertEqual(self.shared.position, 3)

    def test_an_unknown_choice_is_refused(self):
        self.assertEqual(self.change(visibility='maybe').status_code, 400)
        self.shared.refresh_from_db()
        self.assertEqual(self.shared.visibility, Artifact.Visibility.ORGANIZERS)

    def test_an_attendee_cannot_change_it(self):
        response = self.change(client=signed_in(self.attendee), visibility='public')

        self.assertIn(response.status_code, (403, 404))
        self.shared.refresh_from_db()
        self.assertEqual(self.shared.visibility, Artifact.Visibility.ORGANIZERS)

    def test_a_file_from_another_meeting_is_refused(self):
        elsewhere = make_meeting(self.host, make_event(self.host))
        theirs = Artifact.objects.create(
            meeting=elsewhere, artifact_type=ArtifactType.RESOURCE,
            display_name='not mine.pdf',
        )

        response = signed_in(self.host).post(
            f'{API}/meetings/{self.meeting.id}/resource_settings/',
            {'resource_id': str(theirs.id), 'visibility': 'public'},
            format='json',
        )

        self.assertEqual(response.status_code, 404)

    def test_the_order_is_what_the_organizer_set(self):
        second = Artifact.objects.create(
            meeting=self.meeting, artifact_type=ArtifactType.RESOURCE,
            display_name='second.pdf', position=0,
        )
        self.shared.position = 1
        self.shared.save(update_fields=['position'])

        listed = resources_for(self.meeting, include_unreleased=True)

        self.assertEqual([a.id for a in listed], [second.id, self.shared.id])
