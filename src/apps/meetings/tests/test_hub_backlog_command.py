"""Clearing the posts no host ever had a screen for."""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.meetings.models import Event, HubPost
from src.apps.meetings.tests.factories import make_event, make_host

User = get_user_model()


class HubBacklogCommandTests(APITestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(days=2)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ENDED
        self.event.save()
        self.asker = User.objects.create_user(
            username='asker', email='asker@example.com', password='pw'
        )
        self.question = HubPost.objects.create(
            event=self.event, user=self.asker, kind=HubPost.Kind.QUESTION,
            body='What is Kataho?', status=HubPost.Status.PENDING,
        )
        self.suggestion = HubPost.objects.create(
            event=self.event, user=self.asker, kind=HubPost.Kind.SUGGESTION,
            body='Do this proper', status=HubPost.Status.LOOKING,
        )

    def run_it(self, *args):
        out = StringIO()
        call_command('hub_backlog', *args, stdout=out)
        return out.getvalue()

    def test_it_lists_what_is_waiting(self):
        said = self.run_it()

        self.assertIn('What is Kataho?', said)
        self.assertIn('Do this proper', said)

    # Nothing is decided by looking at it.
    def test_listing_changes_nothing(self):
        self.run_it()

        self.question.refresh_from_db()
        self.assertEqual(self.question.status, HubPost.Status.PENDING)

    def test_approving_lets_the_question_onto_the_board(self):
        self.run_it('--approve')

        self.question.refresh_from_db()
        self.assertEqual(self.question.status, HubPost.Status.PUBLISHED)

    def test_and_marks_the_suggestion_addressed(self):
        self.run_it('--approve')

        self.suggestion.refresh_from_db()
        self.assertEqual(self.suggestion.status, HubPost.Status.ADDRESSED)

    def test_one_event_can_be_cleared_on_its_own(self):
        other = make_event(self.host, title='Another day')
        spare = HubPost.objects.create(
            event=other, user=self.asker, kind=HubPost.Kind.QUESTION,
            body='Left alone?', status=HubPost.Status.PENDING,
        )

        self.run_it('--event', self.event.code, '--approve')

        spare.refresh_from_db()
        self.assertEqual(spare.status, HubPost.Status.PENDING)

    def test_it_says_so_when_there_is_nothing(self):
        HubPost.objects.all().delete()

        self.assertIn('Nothing is waiting', self.run_it())
