"""A file a host shares is shared.

`visibility` defaulted to `after_session` and nothing on any screen
ever set it otherwise, so every file was held until the talk it was
filed against had finished - and on an event that had not started, or
had no running order yet, that meant nobody but the organizers ever
saw it.

Summaries are the thing that genuinely waits for a talk to end. Files
are not, and this is about files.
"""
from django.test import TestCase
from django.utils import timezone

from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.artifacts.visibility import is_released, resources_for
from src.apps.meetings.models import Event
from src.apps.meetings.tests.factories import make_event, make_host, make_session


class WhenAFileCanBeRead(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.session = make_session(
            self.event, self.event.scheduled_start, 60, 'Opening'
        )

    def shared(self, **over):
        return Artifact.objects.create(
            event=self.event, artifact_type=ArtifactType.RESOURCE,
            display_name='Deck.pdf', **over,
        )

    def readable(self):
        return [
            one.display_name
            for one in resources_for(self.event, include_unreleased=False)
        ]

    # --- the fix ------------------------------------------------------

    def test_one_shared_against_a_talk_that_has_not_run_is_readable(self):
        self.shared(session=self.session)

        self.assertEqual(self.readable(), ['Deck.pdf'])

    def test_one_on_an_event_that_has_not_started_is_readable(self):
        self.assertEqual(self.event.status, Event.Status.SCHEDULED)
        self.shared(session=self.session)

        self.assertEqual(self.readable(), ['Deck.pdf'])

    def test_one_shared_against_no_talk_at_all_is_readable(self):
        self.shared()

        self.assertEqual(self.readable(), ['Deck.pdf'])

    def test_that_is_what_an_upload_gets_without_being_asked(self):
        """There is no control for this anywhere, so the default is all."""
        self.assertEqual(
            Artifact._meta.get_field('visibility').default,
            Artifact.Visibility.NOW,
        )

    # --- what is still held -------------------------------------------

    def test_organizers_only_is_still_organizers_only(self):
        self.shared(visibility=Artifact.Visibility.ORGANIZERS)

        self.assertEqual(self.readable(), [])

    def test_and_the_organizers_can_still_see_it(self):
        self.shared(visibility=Artifact.Visibility.ORGANIZERS)

        self.assertEqual(
            [one.display_name
             for one in resources_for(self.event, include_unreleased=True)],
            ['Deck.pdf'],
        )

    def test_holding_one_until_the_talk_ends_still_works_where_it_is_asked_for(self):
        held = self.shared(
            session=self.session,
            visibility=Artifact.Visibility.AFTER_SESSION,
        )

        self.assertFalse(is_released(held))

        self.session.status = 'done'
        self.session.save(update_fields=['status'])
        held.refresh_from_db()
        self.assertTrue(is_released(held))
