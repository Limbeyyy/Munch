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


class ClearingTheBacklogTests(APITestCase):
    """Questions asked before the host had a screen for them.

    They were never decided, so they are still waiting - on events that
    have since finished. The host has to be able to go and clear them
    now, or they are lost, and nothing about an ended event should
    stop that.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(days=2)
        self.event = make_event(self.host, start=start, minutes=120)
        self.asker = User.objects.create_user(
            username='asker', email='asker@example.com', password='pw'
        )
        self.event.invites.create(email='asker@example.com')
        self.stuck = HubPost.objects.create(
            event=self.event, user=self.asker,
            kind=HubPost.Kind.QUESTION, body='What is Kataho?',
            status=HubPost.Status.PENDING,
        )
        self.event.status = Event.Status.ENDED
        self.event.ended_at = timezone.now()
        self.event.save()

    def test_it_is_waiting_on_the_host_s_screen(self):
        self.client.force_authenticate(self.host)

        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        self.assertIn('What is Kataho?', [r['body'] for r in body['pending']])

    def test_the_host_can_still_let_it_through(self):
        self.client.force_authenticate(self.host)

        answer = self.client.post(
            f'{API}/events/{self.event.id}/moderate_message/',
            {'message_id': str(self.stuck.id), 'decision': 'approve'},
            format='json',
        )

        self.assertEqual(answer.status_code, 200, answer.content)
        self.stuck.refresh_from_db()
        self.assertEqual(self.stuck.status, HubPost.Status.PUBLISHED)

    def test_and_it_then_shows_on_the_finished_event(self):
        self.client.force_authenticate(self.host)
        self.client.post(
            f'{API}/events/{self.event.id}/moderate_message/',
            {'message_id': str(self.stuck.id), 'decision': 'approve'},
            format='json',
        )

        self.client.force_authenticate(self.asker)
        board = self.client.get(f'{API}/events/{self.event.code}/hub/').json()

        self.assertIn('What is Kataho?', [q['body'] for q in board['questions']])


class WhichTalkAQuestionBelongsToTests(APITestCase):
    """A question asked during a talk belongs to that talk.

    The client may name one, and the attendee app does not always. It
    used to be filed against nothing at all then, so it sat for ever
    under "Not on any agenda" and the host's agenda filter could never
    find it - the same rule a transcript line and a shared file have
    always followed was simply missing here.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.onstage = make_session(self.event, start, 60, 'Kataho Services')
        self.later = make_session(
            self.event, start + timezone.timedelta(hours=1), 60, 'Closing'
        )
        self.asker = User.objects.create_user(
            username='asker', email='asker@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.event, user=self.asker,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )
        self.client.force_authenticate(self.asker)

    def ask(self, **extra):
        answer = self.client.post(
            f'{API}/events/{self.event.code}/hub/',
            {'kind': 'question', 'body': 'Who owns it?', **extra},
            format='json',
        )
        self.assertEqual(answer.status_code, 201, answer.content)
        return HubPost.objects.get(id=answer.json()['id'])

    def live(self):
        self.onstage.status = 'live'
        self.onstage.save(update_fields=['status'])

    def test_one_asked_with_a_talk_on_stage_belongs_to_it(self):
        self.live()

        self.assertEqual(self.ask().session_id, self.onstage.id)

    def test_the_client_is_still_believed_where_it_names_one(self):
        self.live()

        asked = self.ask(session=str(self.later.id))

        self.assertEqual(asked.session_id, self.later.id)

    def test_one_asked_with_nothing_on_stage_belongs_to_nothing(self):
        self.assertIsNone(self.ask().session_id)

    def test_the_host_can_filter_to_the_talk_it_was_asked_during(self):
        self.live()
        asked = self.ask()

        self.client.force_authenticate(self.host)
        body = self.client.get(
            f'{API}/events/{self.event.id}/moderation_queue/'
        ).json()

        row = next(r for r in body['pending'] if r['body'] == 'Who owns it?')
        self.assertEqual(row['session'], str(asked.session_id))
        self.assertEqual(row['session_title'], 'Kataho Services')


class ApprovedQuestionsReachTheRoomTests(APITestCase):
    """The room's own board reads two tables, not one.

    A question put to the host privately is a ChatMessage; one written
    into the hub from the app is a HubPost. The room's Questions panel
    read only the first, so however many hub questions the host
    approved it still said none were up.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.asker = User.objects.create_user(
            username='asker', email='asker@example.com', password='pw'
        )
        EventParticipant.objects.create(
            event=self.event, user=self.asker,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

    def board(self):
        self.client.force_authenticate(self.host)
        answer = self.client.get(f'{API}/events/{self.event.id}/board/')
        self.assertEqual(answer.status_code, 200, answer.content)
        return answer.json()

    def asked(self, status, kind=HubPost.Kind.QUESTION, body='Why the delay?'):
        return HubPost.objects.create(
            event=self.event, user=self.asker, kind=kind,
            body=body, status=status,
        )

    def test_one_the_host_let_through_is_on_the_board(self):
        self.asked(HubPost.Status.PUBLISHED)

        self.assertIn(
            'Why the delay?', [r['body'] for r in self.board()['faq']]
        )

    def test_one_still_waiting_is_not(self):
        self.asked(HubPost.Status.PENDING)

        self.assertEqual(self.board()['faq'], [])

    def test_nor_one_turned_down(self):
        self.asked(HubPost.Status.DECLINED)

        self.assertEqual(self.board()['faq'], [])

    def test_a_suggestion_reaches_the_host(self):
        """It was addressed to them; the room's board is where they read it."""
        self.asked(
            HubPost.Status.ADDRESSED, kind=HubPost.Kind.SUGGESTION,
            body='More signage, please.',
        )

        body = self.board()
        self.assertIn(
            'More signage, please.', [r['body'] for r in body['suggestions']]
        )
        self.assertEqual(body['faq'], [], 'and not onto the questions')

    def test_and_nobody_else(self):
        """The same board is read by everybody in the event."""
        self.asked(
            HubPost.Status.ADDRESSED, kind=HubPost.Kind.SUGGESTION,
            body='More signage, please.',
        )
        self.client.force_authenticate(self.asker)

        body = self.client.get(f'{API}/events/{self.event.id}/board/').json()

        self.assertEqual(body['suggestions'], [])

    def test_nor_a_guest_reading_it(self):
        self.asked(
            HubPost.Status.ADDRESSED, kind=HubPost.Kind.SUGGESTION,
            body='More signage, please.',
        )
        from src.apps.meetings.board import board_for

        body = board_for(self.event, user=None, guest=None)

        self.assertEqual(body['suggestions'], [])

    def test_an_attendee_reads_the_same_board(self):
        self.asked(HubPost.Status.PUBLISHED)
        self.client.force_authenticate(self.asker)

        body = self.client.get(f'{API}/events/{self.event.id}/board/').json()

        self.assertIn('Why the delay?', [r['body'] for r in body['faq']])


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
