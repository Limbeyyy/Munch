"""What the room writes has to reach the one person who can act on it.

A question asked from the attendee app went into HubPost. Every screen
the host reviews from read ChatMessage, and nothing read HubPost - so
the question sat at `pending` for ever, seen by nobody but its author,
because an unpublished post comes back only to whoever wrote it.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.meetings.models import Event, EventParticipant, HubPost
from src.apps.meetings.tests.factories import make_event, make_host, make_session

User = get_user_model()
API = '/api/v1'


class TheHubReachesTheHostTests(APITestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(self.event, start, 60, 'Opening')

        self.asker = User.objects.create_user(
            username='asker', email='asker@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.event, user=self.asker,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

    def ask(self, kind='question', body='Why the delay?'):
        self.client.force_authenticate(self.asker)
        answer = self.client.post(
            f'{API}/events/{self.event.code}/hub/',
            {'kind': kind, 'body': body, 'session': str(self.session.id)},
            format='json',
        )
        self.assertEqual(answer.status_code, 201, answer.content)
        return answer.json()

    def pending(self):
        self.client.force_authenticate(self.host)
        answer = self.client.get(f'{API}/events/{self.event.id}/pending_messages/')
        self.assertEqual(answer.status_code, 200, answer.content)
        return answer.json()

    # --- it arrives ---------------------------------------------------

    def test_a_question_reaches_the_host_s_queue(self):
        self.ask()

        bodies = [row['body'] for row in self.pending()]
        self.assertIn('Why the delay?', bodies)

    def test_a_suggestion_reaches_it_too(self):
        self.ask(kind='suggestion', body='More signage, please.')

        bodies = [row['body'] for row in self.pending()]
        self.assertIn('More signage, please.', bodies)

    def test_it_carries_the_talk_it_was_asked_during(self):
        self.ask()

        row = next(r for r in self.pending() if r['body'] == 'Why the delay?')
        self.assertEqual(row['session'], str(self.session.id))
        self.assertEqual(row['session_title'], 'Opening')

    def test_it_says_which_endpoint_decides_it(self):
        self.ask()

        row = next(r for r in self.pending() if r['body'] == 'Why the delay?')
        self.assertTrue(row['is_hub'])

    def test_it_is_on_the_moderation_screen_as_well(self):
        self.ask()

        self.client.force_authenticate(self.host)
        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        self.assertIn('Why the delay?', [r['body'] for r in body['pending']])

    def test_a_stranger_cannot_read_the_queue(self):
        self.ask()
        self.client.force_authenticate(self.asker)

        answer = self.client.get(f'{API}/events/{self.event.id}/pending_messages/')

        self.assertEqual(answer.status_code, 403)

    # --- and can be decided -------------------------------------------

    def decide(self, post_id, decision):
        self.client.force_authenticate(self.host)
        return self.client.post(
            f'{API}/events/{self.event.id}/moderate_message/',
            {'message_id': post_id, 'decision': decision},
            format='json',
        )

    def test_approving_one_puts_it_on_the_board(self):
        asked = self.ask()

        answer = self.decide(asked['id'], 'approve')

        self.assertEqual(answer.status_code, 200, answer.content)
        self.assertEqual(
            HubPost.objects.get(id=asked['id']).status,
            HubPost.Status.PUBLISHED,
        )

    def test_and_the_room_can_then_read_it(self):
        asked = self.ask()
        self.decide(asked['id'], 'approve')

        reader = User.objects.create_user(
            username='reader', email='reader@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.event, user=reader,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )
        self.client.force_authenticate(reader)
        board = self.client.get(f'{API}/events/{self.event.code}/hub/').json()

        self.assertIn('Why the delay?', [q['body'] for q in board['questions']])

    def test_rejecting_one_keeps_it_off(self):
        asked = self.ask()

        self.decide(asked['id'], 'decline')

        self.assertEqual(
            HubPost.objects.get(id=asked['id']).status,
            HubPost.Status.DECLINED,
        )

    def test_a_decided_one_leaves_the_queue(self):
        asked = self.ask()
        self.decide(asked['id'], 'approve')

        self.assertNotIn('Why the delay?', [r['body'] for r in self.pending()])

    def test_deciding_the_same_one_twice_is_refused(self):
        asked = self.ask()
        self.decide(asked['id'], 'approve')

        self.assertEqual(self.decide(asked['id'], 'decline').status_code, 409)

    def test_an_accepted_suggestion_is_addressed_rather_than_published(self):
        """Publishing is for what the room reads. A suggestion is not.

        Nothing leaks either way - PUBLIC_KINDS keeps suggestions off
        the board whatever their status - but the status should say
        what actually happened to it.
        """
        asked = self.ask(kind='suggestion', body='More signage, please.')

        self.decide(asked['id'], 'approve')

        self.assertEqual(
            HubPost.objects.get(id=asked['id']).status,
            HubPost.Status.ADDRESSED,
        )

    def test_and_still_does_not_reach_the_room(self):
        asked = self.ask(kind='suggestion', body='More signage, please.')
        self.decide(asked['id'], 'approve')

        reader = User.objects.create_user(
            username='reader', email='reader@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.event, user=reader,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )
        self.client.force_authenticate(reader)
        board = self.client.get(f'{API}/events/{self.event.code}/hub/').json()

        self.assertEqual(board['suggestions'], [])
        self.assertEqual(board['questions'], [])


class TheHubOutlivesTheEventTests(APITestCase):
    """What was asked does not vanish the day the event ends."""

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, minutes=120)
        self.invitee = User.objects.create_user(
            username='invitee', email='invitee@example.com', password='pw'
        )
        self.event.invites.create(email='invitee@example.com')

    def end_it(self):
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()

    def test_an_invitee_can_still_read_it_after_the_event_is_over(self):
        # No participant row: they followed along without joining the
        # room, which is most people.
        self.end_it()
        self.client.force_authenticate(self.invitee)

        answer = self.client.get(f'{API}/events/{self.event.code}/hub/')

        self.assertEqual(answer.status_code, 200, answer.content)

    def test_their_own_question_is_still_there(self):
        self.client.force_authenticate(self.invitee)
        self.client.post(
            f'{API}/events/{self.event.code}/hub/',
            {'kind': 'question', 'body': 'What was decided?'}, format='json',
        )
        self.end_it()

        board = self.client.get(f'{API}/events/{self.event.code}/hub/').json()

        self.assertIn(
            'What was decided?', [q['body'] for q in board['questions']]
        )

    def test_somebody_with_no_part_in_it_still_cannot(self):
        self.end_it()
        stranger = User.objects.create_user(
            username='stranger', email='stranger@example.com', password='pw'
        )
        self.client.force_authenticate(stranger)

        answer = self.client.get(f'{API}/events/{self.event.code}/hub/')

        self.assertEqual(answer.status_code, 403)
