"""The attendee hub: what people may post, read, and vote on.

Questions and ideas are for the room and wait to be let through. A
suggestion is a private word with the organizer. Everyone gets one vote per
post, guests included.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.guest_tokens import make_guest_token
from src.apps.meetings.models import (
    GuestAttendee, HubPost, HubVote, MeetingParticipant,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class HubTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.asker = make_host('asker@example.com')
        self.other = make_host('other@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        self.session = make_session(self.meeting, timezone.now(), 60)
        for person in (self.asker, self.other):
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=person, role='attendee'
            )
        self.guest = GuestAttendee.objects.create(
            meeting=self.meeting, full_name='A Guest', phone='9800000000',
            status=GuestAttendee.Status.ADMITTED,
        )
        self.guest_token = make_guest_token(self.guest)
        self.host_client = signed_in(self.host)
        self.asker_client = signed_in(self.asker)
        self.other_client = signed_in(self.other)
        self.url = f'{API}/meetings/{self.meeting.meeting_code}/hub/'

    def post(self, client=None, **body):
        return (client or self.asker_client).post(self.url, body, format='json')

    def guest_post(self, **body):
        return APIClient().post(
            self.url, {**body, 'guest_token': self.guest_token}, format='json'
        )

    def board(self, client=None):
        return (client or self.asker_client).get(self.url).json()

    def guest_board(self):
        return APIClient().get(f'{self.url}?guest_token={self.guest_token}').json()

    def publish(self, post):
        post.status = HubPost.Status.PUBLISHED
        post.save(update_fields=['status'])
        return post

    def vote(self, post, value, client=None):
        return (client or self.other_client).post(
            f'{self.url}{post.id}/vote/', {'value': value}, format='json'
        )

    # --- posting -----------------------------------------------------------

    def test_a_question_arrives_awaiting_moderation(self):
        response = self.post(kind='question', body='How is the grant released?')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['status'], 'pending')

    def test_an_idea_arrives_awaiting_moderation(self):
        self.assertEqual(self.post(kind='idea', body='Two desks').json()['status'],
                         'pending')

    def test_a_suggestion_goes_straight_to_the_organizer(self):
        # There is nobody else for it to be shown to, so it does not queue.
        response = self.post(
            kind='suggestion', body='The second hall needs a microphone',
            category='halls',
        )

        self.assertEqual(response.json()['status'], 'looking')
        self.assertEqual(response.json()['category'], 'halls')

    def test_an_empty_post_is_refused(self):
        self.assertEqual(self.post(kind='question', body='   ').status_code, 400)

    def test_an_unknown_kind_is_refused(self):
        self.assertEqual(self.post(kind='rant', body='...').status_code, 400)

    def test_a_question_can_name_the_session_it_is_about(self):
        response = self.post(
            kind='question', body='About the opening?', session=str(self.session.id)
        )
        self.assertEqual(response.json()['session_title'], self.session.title)

    def test_asking_anonymously_hides_the_name(self):
        response = self.post(kind='question', body='Awkward question', anonymous=True)
        self.assertEqual(response.json()['author'], 'Anonymous')

    def test_a_guest_can_post_too(self):
        self.assertEqual(
            self.guest_post(kind='question', body='Is there parking?').status_code, 201
        )

    def test_somebody_outside_the_meeting_cannot_post(self):
        outsider = signed_in(make_host('outsider@example.com'))
        # They are not in the meeting, but the room being open is what the
        # door checks - so close it and try again.
        self.meeting.status = self.meeting.Status.ENDED
        self.meeting.save(update_fields=['status'])

        self.assertEqual(
            self.post(client=outsider, kind='question', body='Let me in').status_code, 403
        )

    # --- what people may read ----------------------------------------------

    def test_a_question_in_moderation_is_not_shown_to_the_room(self):
        self.post(kind='question', body='Not yet approved')

        self.assertEqual(self.board(self.other_client)['questions'], [])

    def test_but_the_asker_sees_their_own_waiting(self):
        self.post(kind='question', body='Not yet approved')

        mine = self.board()['questions']
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['status'], 'pending')
        self.assertTrue(mine[0]['mine'])

    def test_a_published_question_is_shown_to_everyone(self):
        asked = self.post(kind='question', body='How is the grant released?').json()
        self.publish(HubPost.objects.get(id=asked['id']))

        self.assertEqual(len(self.board(self.other_client)['questions']), 1)
        self.assertEqual(len(self.guest_board()['questions']), 1)

    def test_a_suggestion_is_never_shown_to_another_attendee(self):
        self.post(kind='suggestion', body='A private word')

        self.assertEqual(self.board(self.other_client)['suggestions'], [])
        self.assertEqual(self.guest_board()['suggestions'], [])

    def test_the_author_keeps_seeing_their_own_suggestions(self):
        self.post(kind='suggestion', body='A private word')

        mine = self.board()['suggestions']
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['body'], 'A private word')

    def test_publishing_a_suggestion_would_still_not_show_it(self):
        # Suggestions are excluded by kind, not only by status, so a stray
        # status change cannot leak one to the room.
        made = self.post(kind='suggestion', body='A private word').json()
        self.publish(HubPost.objects.get(id=made['id']))

        self.assertEqual(self.board(self.other_client)['suggestions'], [])

    # --- voting -------------------------------------------------------------

    def test_an_upvote_raises_the_score(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Worth answering').json()['id']
        ))

        response = self.vote(asked, 1)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['score'], 1)

    def test_a_downvote_lowers_it(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Off topic').json()['id']
        ))

        self.assertEqual(self.vote(asked, -1).json()['score'], -1)

    def test_one_person_gets_one_vote(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Worth answering').json()['id']
        ))

        self.vote(asked, 1)
        self.vote(asked, 1)

        # The second press of the same button takes the vote back.
        self.assertEqual(HubVote.objects.filter(post=asked).count(), 0)

    def test_changing_your_mind_replaces_the_vote(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Hmm').json()['id']
        ))

        self.vote(asked, 1)
        response = self.vote(asked, -1)

        self.assertEqual(response.json()['score'], -1)
        self.assertEqual(HubVote.objects.filter(post=asked).count(), 1)

    def test_votes_from_different_people_add_up(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Popular').json()['id']
        ))

        self.vote(asked, 1, client=self.other_client)
        self.vote(asked, 1, client=self.host_client)
        APIClient().post(
            f'{self.url}{asked.id}/vote/',
            {'value': 1, 'guest_token': self.guest_token}, format='json',
        )

        self.assertEqual(self.board()['questions'][0]['score'], 3)

    def test_a_guest_gets_one_vote_as_well(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Popular').json()['id']
        ))
        for _ in range(2):
            APIClient().post(
                f'{self.url}{asked.id}/vote/',
                {'value': 1, 'guest_token': self.guest_token}, format='json',
            )

        self.assertEqual(HubVote.objects.filter(post=asked).count(), 0)

    def test_suggestions_are_not_voted_on(self):
        made = HubPost.objects.get(
            id=self.post(kind='suggestion', body='A private word').json()['id']
        )

        self.assertEqual(self.vote(made, 1, client=self.asker_client).status_code, 409)

    def test_a_nonsense_vote_is_refused(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Hi').json()['id']
        ))

        self.assertEqual(self.vote(asked, 5).status_code, 400)

    def test_the_board_puts_the_most_wanted_question_first(self):
        low = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Quiet one').json()['id']))
        high = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Loud one').json()['id']))
        self.vote(high, 1, client=self.other_client)
        self.vote(high, 1, client=self.host_client)
        self.vote(low, 1, client=self.other_client)

        questions = self.board()['questions']
        self.assertEqual(questions[0]['body'], 'Loud one')
        self.assertEqual(questions[1]['body'], 'Quiet one')

    def test_the_board_says_how_this_person_voted(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='Mine to vote on').json()['id']))
        self.vote(asked, 1, client=self.other_client)

        self.assertEqual(self.board(self.other_client)['questions'][0]['my_vote'], 1)
        self.assertEqual(self.board(self.asker_client)['questions'][0]['my_vote'], 0)

    # --- answers -------------------------------------------------------------

    def test_an_answer_is_shown_under_the_question(self):
        asked = self.publish(HubPost.objects.get(
            id=self.post(kind='question', body='How is the grant released?').json()['id']))
        asked.answer = 'Straight to municipalities from 17 September.'
        asked.answered_by = 'Dr Sarita Paudel'
        asked.answered_at = timezone.now()
        asked.save()

        shown = self.board(self.other_client)['questions'][0]
        self.assertEqual(shown['answer'], 'Straight to municipalities from 17 September.')
        self.assertEqual(shown['answered_by'], 'Dr Sarita Paudel')
