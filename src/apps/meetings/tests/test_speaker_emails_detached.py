"""The speaker link is only as good as the address behind it.

Being named on the running order opens the event: a speaker should
find their session waiting without being sent an invitation, and
should be able to read everything the event holds even though they
spent the day at the front of the room rather than in the virtual
one. That rule is right and is not what changed.

What changed is that nothing asks for the address any more, so every
value the column held was typed into a form that no longer exists -
and several of them were not the speaker's at all. Emptying it
detaches the link until the question is asked again properly.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.meetings.access import events_attended_by
from src.apps.meetings.models import Event, Session
from src.apps.meetings.tests.factories import make_event, make_host, make_session

User = get_user_model()


class TheSpeakerLinkTests(APITestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host, title='Pacific Regional Convention')
        self.session = make_session(
            self.event, self.event.scheduled_start, 60, 'Android'
        )
        self.speaker = User.objects.create_user(
            username='speaker', email='speaker@example.com', password='pw',
        )

    def sees(self, user):
        return set(
            Event.objects.filter(events_attended_by(user))
            .values_list('title', flat=True)
        )

    # --- the rule, which stays ----------------------------------------

    def test_an_address_on_the_running_order_opens_the_event(self):
        self.session.speaker_email = 'speaker@example.com'
        self.session.save(update_fields=['speaker_email'])

        self.assertIn('Pacific Regional Convention', self.sees(self.speaker))

    def test_without_an_invitation(self):
        self.session.speaker_email = 'speaker@example.com'
        self.session.save(update_fields=['speaker_email'])

        self.assertFalse(
            self.event.invites.filter(email='speaker@example.com').exists()
        )
        self.assertIn('Pacific Regional Convention', self.sees(self.speaker))

    # --- and the empty column -----------------------------------------

    def test_an_empty_address_opens_nothing(self):
        self.session.speaker_email = ''
        self.session.save(update_fields=['speaker_email'])

        self.assertEqual(self.sees(self.speaker), set())

    def test_an_account_with_no_address_matches_no_blank_session(self):
        """The guard, which matters far more after 0010 than before it.

        Every session's address is empty once that migration has run,
        so a clause built from an empty address would match the whole
        table. The factory fills one in, so the blank has to be set
        here or the guard is never asked anything.
        """
        self.session.speaker_email = ''
        self.session.save(update_fields=['speaker_email'])
        nameless = User.objects.create_user(
            username='nobody', email='', password='pw',
        )

        self.assertEqual(self.sees(nameless), set())


class TheMigrationTests(APITestCase):
    """What 0010 does to what is already there."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.kept = make_session(
            self.event, self.event.scheduled_start, 60, 'Android'
        )

    def run_it(self):
        from src.apps.meetings.migrations import (
            __name__ as _pkg,  # noqa: F401  - anchors the import path
        )
        import importlib

        module = importlib.import_module(
            'src.apps.meetings.migrations'
            '.0010_clear_speaker_emails_nothing_asked_for'
        )
        from django.apps import apps

        module.detach(apps, None)

    def test_it_empties_an_address_that_was_entered(self):
        self.kept.speaker_email = 'someone.else@example.com'
        self.kept.save(update_fields=['speaker_email'])

        self.run_it()

        self.kept.refresh_from_db()
        self.assertEqual(self.kept.speaker_email, '')

    def test_it_leaves_the_speaker_s_name_alone(self):
        self.kept.speaker_name = 'Prabhat K'
        self.kept.speaker_email = 'tithighadi@gmail.com'
        self.kept.save(update_fields=['speaker_name', 'speaker_email'])

        self.run_it()

        self.kept.refresh_from_db()
        self.assertEqual(self.kept.speaker_name, 'Prabhat K')

    def test_and_the_session_itself(self):
        self.kept.speaker_email = 'someone.else@example.com'
        self.kept.save(update_fields=['speaker_email'])

        self.run_it()

        self.assertTrue(Session.objects.filter(id=self.kept.id).exists())

    def test_afterwards_that_address_opens_nothing(self):
        stranger = User.objects.create_user(
            username='stranger', email='someone.else@example.com', password='pw',
        )
        self.kept.speaker_email = 'someone.else@example.com'
        self.kept.save(update_fields=['speaker_email'])
        self.assertTrue(Event.objects.filter(events_attended_by(stranger)).exists())

        self.run_it()

        self.assertFalse(Event.objects.filter(events_attended_by(stranger)).exists())
