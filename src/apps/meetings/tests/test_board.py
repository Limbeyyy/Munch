"""Sorting messages into questions and suggestions, and who may read them.

The board is the one place a message the host received can become
something the whole room reads, so what may reach it - and what may not -
is the thing worth pinning down.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.guest_tokens import make_guest_token
from src.apps.meetings.models import (
    ChatMessage, GuestAttendee, MeetingParticipant,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class BoardTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.asker = make_host('asker@example.com')
        self.onlooker = make_host('onlooker@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        make_session(self.meeting, timezone.now(), 60)
        for person in (self.asker, self.onlooker):
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=person, role='attendee'
            )
        self.host_client = signed_in(self.host)
        self.asker_client = signed_in(self.asker)
        self.onlooker_client = signed_in(self.onlooker)

    def public(self, body='When does it start?'):
        return ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, body=body,
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

    def held_direct(self, body='A word in private'):
        return ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, recipient=self.host, body=body,
            moderation_status=ChatMessage.Moderation.PENDING,
        )

    def sort(self, message, topic, client=None):
        return (client or self.host_client).post(
            f'{API}/meetings/{self.meeting.id}/sort_message/',
            {'message_id': str(message.id), 'topic': topic},
            format='json',
        )

    def board(self, client=None):
        return (client or self.host_client).get(
            f'{API}/meetings/{self.meeting.id}/board/'
        ).json()

    # --- sorting -----------------------------------------------------------

    def test_the_board_starts_empty(self):
        self.public()

        board = self.board()
        self.assertEqual(board['faq'], [])
        self.assertEqual(board['suggestions'], [])

    def approved_direct(self, body='A word in private'):
        """A private message the host has already let through."""
        held = self.held_direct(body)
        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'approve'},
            format='json',
        )
        held.refresh_from_db()
        return held

    def test_the_host_puts_a_question_up(self):
        message = self.approved_direct('When does it start?')

        self.assertEqual(self.sort(message, 'faq').status_code, 200)

        board = self.board()
        self.assertEqual(len(board['faq']), 1)
        self.assertEqual(board['faq'][0]['body'], 'When does it start?')
        self.assertEqual(board['faq'][0]['asked_by'], self.asker.email)

    def test_a_room_message_cannot_go_on_the_board(self):
        # Everybody present has already read it; the board is for what was
        # said privately.
        response = self.sort(self.public(), 'faq')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'not_direct')
        self.assertEqual(self.board()['faq'], [])

    def test_a_room_message_cannot_be_sorted_while_approving_either(self):
        room = ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, body='Hello all',
            moderation_status=ChatMessage.Moderation.PENDING,
        )

        response = self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(room.id), 'decision': 'approve', 'topic': 'faq'},
            format='json',
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.board()['faq'], [])

    def test_questions_and_suggestions_are_kept_apart(self):
        self.sort(self.approved_direct('Why this hall?'), 'faq')
        self.sort(self.approved_direct('Try a bigger screen'), 'suggestion')

        board = self.board()
        self.assertEqual([e['body'] for e in board['faq']], ['Why this hall?'])
        self.assertEqual([e['body'] for e in board['suggestions']], ['Try a bigger screen'])

    def test_a_message_can_be_taken_back_off(self):
        message = self.approved_direct()
        self.sort(message, 'faq')

        self.sort(message, 'none')

        self.assertEqual(self.board()['faq'], [])

    def test_a_message_can_be_moved_between_the_two(self):
        message = self.approved_direct()
        self.sort(message, 'faq')

        self.sort(message, 'suggestion')

        board = self.board()
        self.assertEqual(board['faq'], [])
        self.assertEqual(len(board['suggestions']), 1)

    def test_an_unknown_topic_is_refused(self):
        response = self.sort(self.approved_direct(), 'complaint')
        self.assertEqual(response.status_code, 400)

    # --- what may not reach the board --------------------------------------

    def test_a_message_still_awaiting_review_cannot_be_put_up(self):
        held = self.held_direct()

        response = self.sort(held, 'faq')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.board()['faq'], [])

    def test_a_declined_message_cannot_be_put_up(self):
        declined = self.held_direct()
        declined.moderation_status = ChatMessage.Moderation.DECLINED
        declined.save(update_fields=['moderation_status'])

        self.assertEqual(self.sort(declined, 'faq').status_code, 409)

    def test_an_approved_direct_message_may_be_put_up(self):
        # This is the disclosure the feature exists to allow, and it takes
        # two deliberate host decisions to happen.
        held = self.held_direct()
        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'approve'},
            format='json',
        )

        self.assertEqual(self.sort(held, 'faq').status_code, 200)
        entry = self.board()['faq'][0]
        self.assertTrue(entry['was_direct'])

    def test_a_published_direct_message_says_who_it_was_put_to(self):
        # On a board of questions this usually says which speaker is meant
        # to answer, so the host asked for it to be shown. It appears only
        # for a message the host deliberately published.
        held = self.held_direct()
        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'approve', 'topic': 'faq'},
            format='json',
        )

        entry = self.board()['faq'][0]
        self.assertTrue(entry['was_direct'])
        self.assertEqual(entry['sent_to'], self.host.email)

    def test_approving_and_sorting_happen_in_one_step(self):
        held = self.held_direct()

        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'approve', 'topic': 'suggestion'},
            format='json',
        )

        self.assertEqual(len(self.board()['suggestions']), 1)

    def test_declining_with_a_topic_does_not_publish_it(self):
        held = self.held_direct()

        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'decline', 'topic': 'faq'},
            format='json',
        )

        self.assertEqual(self.board()['faq'], [])

    # --- who may sort, and who may read ------------------------------------

    def test_only_the_host_sorts(self):
        message = self.approved_direct()

        response = self.sort(message, 'faq', client=self.asker_client)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.board()['faq'], [])

    def test_everyone_in_the_meeting_reads_the_board(self):
        self.sort(self.approved_direct(), 'faq')

        for client in (self.asker_client, self.onlooker_client):
            self.assertEqual(len(self.board(client=client)['faq']), 1)

    def test_somebody_outside_the_meeting_reads_nothing(self):
        self.sort(self.approved_direct(), 'faq')
        outsider = signed_in(make_host('outsider@example.com'))

        response = outsider.get(f'{API}/meetings/{self.meeting.id}/board/')

        self.assertEqual(response.status_code, 404)

    def test_a_guest_reads_the_same_board(self):
        guest = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='A Guest', phone='9800000000',
            status=GuestAttendee.Status.ADMITTED,
        )
        self.sort(self.approved_direct(), 'faq')

        body = APIClient().get(
            f'{API}/meetings/guest/board/?token={make_guest_token(guest)}'
        ).json()

        self.assertEqual(len(body['faq']), 1)

    def test_a_guest_who_was_not_admitted_reads_nothing(self):
        waiting = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Waiting', phone='9800000001',
            status=GuestAttendee.Status.PENDING,
        )
        self.sort(self.approved_direct(), 'faq')

        response = APIClient().get(
            f'{API}/meetings/guest/board/?token={make_guest_token(waiting)}'
        )

        self.assertEqual(response.status_code, 403)

    def test_a_guest_question_can_go_on_the_board(self):
        guest = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Curious Guest', phone='9800000002',
            status=GuestAttendee.Status.ADMITTED,
        )
        asked = ChatMessage.objects.create(
            meeting=self.meeting, guest_sender=guest, recipient=self.host,
            body='Is there parking?',
            moderation_status=ChatMessage.Moderation.APPROVED,
        )

        self.sort(asked, 'faq')

        entry = self.board()['faq'][0]
        self.assertEqual(entry['asked_by'], 'Curious Guest')
        self.assertTrue(entry['asker_is_guest'])
        self.assertEqual(entry['sent_to'], self.host.email)


class ReviewedMessagesTests(TestCase):
    """Where a message goes once the host has let it through.

    Out of the queue and into the record - split by who sent it, because an
    account holder and a guest are answered in different places. Going on
    the board is a further step, not the same one.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        self.asker = make_host('asker@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        make_session(self.meeting, timezone.now(), 60)
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.asker, role='attendee'
        )
        self.guest = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='A Guest', phone='9800000000',
            status=GuestAttendee.Status.ADMITTED,
        )
        self.host_client = signed_in(self.host)

    def held(self, sender=None, guest=None, body='A word in private'):
        return ChatMessage.objects.create(
            meeting=self.meeting, sender=sender, guest_sender=guest,
            recipient=self.host, body=body,
            moderation_status=ChatMessage.Moderation.PENDING,
        )

    def approve(self, message, topic=None):
        return self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(message.id), 'decision': 'approve',
             **({'topic': topic} if topic else {})},
            format='json',
        )

    def reviewed(self):
        return self.host_client.get(
            f'{API}/meetings/{self.meeting.id}/reviewed_messages/'
        ).json()

    def test_nothing_is_recorded_before_a_decision(self):
        self.held(sender=self.asker)

        body = self.reviewed()
        self.assertEqual(body['from_users'], [])
        self.assertEqual(body['from_guests'], [])

    def test_an_approved_message_from_an_account_holder_lands_under_users(self):
        self.approve(self.held(sender=self.asker))

        body = self.reviewed()
        self.assertEqual(len(body['from_users']), 1)
        self.assertEqual(body['from_guests'], [])

    def test_an_approved_message_from_a_guest_lands_under_guests(self):
        self.approve(self.held(guest=self.guest))

        body = self.reviewed()
        self.assertEqual(body['from_users'], [])
        self.assertEqual(len(body['from_guests']), 1)

    def test_a_plain_approval_puts_nothing_on_the_board(self):
        # Approving from the meeting room does exactly this and no more.
        self.approve(self.held(sender=self.asker))

        self.assertEqual(len(self.reviewed()['from_users']), 1)
        board = self.host_client.get(f'{API}/meetings/{self.meeting.id}/board/').json()
        self.assertEqual(board['faq'], [])
        self.assertEqual(board['suggestions'], [])

    def test_sorting_puts_it_in_both_places(self):
        self.approve(self.held(sender=self.asker), topic='faq')

        recorded = self.reviewed()['from_users']
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0]['topic'], 'faq')
        board = self.host_client.get(f'{API}/meetings/{self.meeting.id}/board/').json()
        self.assertEqual(len(board['faq']), 1)

    def test_a_declined_message_is_not_recorded(self):
        held = self.held(sender=self.asker)
        self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/moderate_message/',
            {'message_id': str(held.id), 'decision': 'decline'},
            format='json',
        )

        self.assertEqual(self.reviewed()['from_users'], [])

    def test_a_message_sent_straight_to_the_host_is_in_the_record(self):
        """The reported gap: it needed no approval, so it appeared nowhere.

        A question put to the host from the room skips the queue, quite
        rightly - the host should not have to approve their own mail. But
        it is still a direct message the host has read, and still the kind
        of thing worth filing as a question afterwards.
        """
        ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, recipient=self.host,
            body='what is kataho?',
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

        recorded = self.reviewed()['from_users']

        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0]['body'], 'what is kataho?')

    def test_the_same_from_a_guest_lands_under_guests(self):
        ChatMessage.objects.create(
            meeting=self.meeting, guest_sender=self.guest, recipient=self.host,
            body='Is there parking?',
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

        body = self.reviewed()
        self.assertEqual(body['from_users'], [])
        self.assertEqual(len(body['from_guests']), 1)

    def test_it_can_then_be_filed_as_a_question(self):
        asked = ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, recipient=self.host,
            body='what is kataho?',
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

        response = self.host_client.post(
            f'{API}/meetings/{self.meeting.id}/sort_message/',
            {'message_id': str(asked.id), 'topic': 'faq'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        board = self.host_client.get(f'{API}/meetings/{self.meeting.id}/board/').json()
        self.assertEqual(len(board['faq']), 1)

    def test_the_hosts_own_messages_are_not_a_queue(self):
        ChatMessage.objects.create(
            meeting=self.meeting, sender=self.host, recipient=self.asker,
            body='Sent by me',
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

        self.assertEqual(self.reviewed()['from_users'], [])

    def test_a_room_message_is_never_in_the_record(self):
        # The record is of what the host passed on privately.
        ChatMessage.objects.create(
            meeting=self.meeting, sender=self.asker, body='Hello all',
            moderation_status=ChatMessage.Moderation.NOT_REQUIRED,
        )

        self.assertEqual(self.reviewed()['from_users'], [])

    def test_only_the_host_reads_the_record(self):
        self.approve(self.held(sender=self.asker))

        response = signed_in(self.asker).get(
            f'{API}/meetings/{self.meeting.id}/reviewed_messages/'
        )
        self.assertEqual(response.status_code, 403)
