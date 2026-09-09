"""What the day came to, as the people who attended it read it.

A summary is prose the host writes; a conclusion is what somebody leaves
with. What matters here is that nothing unpublished escapes, that the
lines read as the points they were written as, and that an action list
says whose it is.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.conclusions import (
    MAX_ACTIONS, findings_from, mine_from, tidy_actions,
)
from src.apps.meetings.models import (
    MeetingParticipant, SessionSummary,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


class FindingsTests(TestCase):
    def test_each_line_is_a_point(self):
        self.assertEqual(
            findings_from('Grant released\nCommittee formed'),
            ['Grant released', 'Committee formed'],
        )

    def test_a_bullet_somebody_typed_is_not_repeated(self):
        # The page draws its own marks, so a line arriving with one would
        # otherwise read "- - Grant released".
        self.assertEqual(findings_from('- Grant released'), ['Grant released'])
        self.assertEqual(findings_from('• Grant released'), ['Grant released'])
        self.assertEqual(findings_from('* Grant released'), ['Grant released'])

    def test_numbering_goes_the_same_way(self):
        self.assertEqual(
            findings_from('1. Grant released\n2) Committee formed'),
            ['Grant released', 'Committee formed'],
        )

    def test_a_number_that_is_part_of_the_point_is_kept(self):
        self.assertEqual(
            findings_from('9.3 forms go to the district team'),
            ['9.3 forms go to the district team'],
        )

    def test_blank_lines_are_not_points(self):
        self.assertEqual(findings_from('One\n\n\nTwo'), ['One', 'Two'])

    def test_nothing_written_is_no_points(self):
        self.assertEqual(findings_from(''), [])
        self.assertEqual(findings_from(None), [])


class ActionTests(TestCase):
    def test_a_row_keeps_its_three_parts(self):
        self.assertEqual(
            tidy_actions([{'task': 'Orient the district team', 'owner': 'Sunita', 'due': 'Asoj 9'}]),
            [{'task': 'Orient the district team', 'owner': 'Sunita', 'due': 'Asoj 9'}],
        )

    def test_a_row_with_no_task_is_not_an_action(self):
        self.assertEqual(tidy_actions([{'owner': 'Sunita', 'due': 'Asoj 9'}]), [])

    def test_the_owner_and_the_date_may_be_words(self):
        # "before the next meeting" is a real answer, and a date picker
        # insisting on a calendar day would turn it into a lie.
        rows = tidy_actions([{'task': 'Send the letter', 'due': 'before the next meeting'}])

        self.assertEqual(rows[0]['due'], 'before the next meeting')
        self.assertEqual(rows[0]['owner'], '')

    def test_something_that_is_not_a_list_is_refused(self):
        with self.assertRaises(ValueError):
            tidy_actions('Sunita does the forms')

    def test_a_list_longer_than_a_session_is_refused(self):
        with self.assertRaises(ValueError):
            tidy_actions([{'task': f'Thing {i}'} for i in range(MAX_ACTIONS + 1)])


class MyActionsTests(TestCase):
    def conclusion(self, *actions):
        return [{'session_title': 'Opening', 'actions': list(actions)}]

    def test_it_finds_a_line_by_name(self):
        mine = mine_from(
            self.conclusion({'task': 'Forms', 'owner': 'Sunita Budha', 'due': 'Asoj 9'}),
            name='Sunita Budha',
        )

        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['session_title'], 'Opening')

    def test_it_finds_one_by_address_too(self):
        mine = mine_from(
            self.conclusion({'task': 'Forms', 'owner': 'sunita@example.org'}),
            name='Somebody Else', email='sunita@example.org',
        )

        self.assertEqual(len(mine), 1)

    def test_somebody_elses_line_is_not_mine(self):
        mine = mine_from(
            self.conclusion({'task': 'Forms', 'owner': 'Ram Rimal'}),
            name='Sunita Budha',
        )

        self.assertEqual(mine, [])

    def test_a_line_with_nobody_against_it_is_nobodys(self):
        mine = mine_from(
            self.conclusion({'task': 'Forms', 'owner': ''}), name='Sunita Budha'
        )

        self.assertEqual(mine, [])


class ConclusionPageTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() - timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=240)
        self.session = make_session(self.meeting, self.start, 60, 'Service delivery')
        self.attendee = make_host('attendee@example.com')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )

    def as_(self, user):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def summarise(self, *, published, body='Grant released\nCommittee formed', actions=None):
        return SessionSummary.objects.create(
            session=self.session,
            body=body,
            actions=actions or [],
            status=(
                SessionSummary.Status.PUBLISHED if published
                else SessionSummary.Status.NEEDS_APPROVAL
            ),
            published_at=timezone.now() if published else None,
        )

    def page(self, user):
        return self.as_(user).get(f'{API}/conclusions/').json()

    def test_a_published_summary_reads_as_findings(self):
        self.summarise(published=True)

        body = self.page(self.attendee)

        self.assertEqual(len(body['conclusions']), 1)
        entry = body['conclusions'][0]
        self.assertEqual(entry['session_title'], 'Service delivery')
        self.assertEqual(entry['findings'], ['Grant released', 'Committee formed'])

    def test_a_draft_reaches_nobody(self):
        # Not even a hint that one exists: an unreviewed conclusion going
        # out is worse than none at all.
        self.summarise(published=False)

        self.assertEqual(self.page(self.attendee)['conclusions'], [])

    def test_it_says_which_meeting_and_programme_it_came_from(self):
        self.summarise(published=True)

        entry = self.page(self.attendee)['conclusions'][0]

        self.assertEqual(entry['meeting_title'], self.meeting.title)
        self.assertEqual(entry['event_title'], self.event.title)

    def test_the_actions_come_with_it(self):
        self.summarise(published=True, actions=[
            {'task': 'Orient the district team', 'owner': 'Sunita Budha', 'due': 'Asoj 9'},
        ])

        entry = self.page(self.attendee)['conclusions'][0]

        self.assertEqual(entry['actions'][0]['owner'], 'Sunita Budha')

    def test_a_reader_is_handed_their_own_lines(self):
        self.summarise(published=True, actions=[
            {'task': 'Orient the district team', 'owner': 'attendee@example.com'},
            {'task': 'Send the letter', 'owner': 'Somebody Else'},
        ])

        body = self.page(self.attendee)

        self.assertEqual(len(body['conclusions'][0]['actions']), 2)
        self.assertEqual(len(body['mine']), 1)
        self.assertEqual(body['mine'][0]['task'], 'Orient the district team')

    def test_a_stranger_reads_nothing(self):
        self.summarise(published=True)
        stranger = make_host('stranger@example.com')

        self.assertEqual(self.page(stranger)['conclusions'], [])

    def test_it_needs_signing_in(self):
        from django.test import Client

        self.assertEqual(Client().get(f'{API}/conclusions/').status_code, 401)


class HostWritesActionsTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        start = timezone.now() - timezone.timedelta(hours=2)
        self.meeting = make_meeting(self.host, self.event, start=start, minutes=120)
        self.session = make_session(self.meeting, start, 60, 'Opening')

    def as_host(self):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

    def test_the_host_can_write_an_action_list(self):
        response = self.as_host().put(
            f'{API}/sessions/{self.session.id}/summary/',
            {
                'body': 'Grant released',
                'actions': [{'task': 'Orient the team', 'owner': 'Sunita', 'due': 'Asoj 9'}],
            },
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            SessionSummary.objects.get(session=self.session).actions[0]['owner'],
            'Sunita',
        )

    def test_the_prose_survives_a_change_to_the_actions_alone(self):
        self.as_host().put(
            f'{API}/sessions/{self.session.id}/summary/',
            {'body': 'Grant released'}, content_type='application/json',
        )

        self.as_host().put(
            f'{API}/sessions/{self.session.id}/summary/',
            {'actions': [{'task': 'Orient the team'}]},
            content_type='application/json',
        )

        summary = SessionSummary.objects.get(session=self.session)
        self.assertEqual(summary.body, 'Grant released')
        self.assertEqual(len(summary.actions), 1)

    def test_an_attendee_cannot_write_them(self):
        attendee = make_host('attendee@example.com')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )
        from django.test import Client

        response = Client(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(attendee)}'
        ).put(
            f'{API}/sessions/{self.session.id}/summary/',
            {'body': 'Mine now', 'actions': []}, content_type='application/json',
        )

        self.assertEqual(response.status_code, 403)

    def test_nonsense_in_the_action_list_is_refused(self):
        response = self.as_host().put(
            f'{API}/sessions/{self.session.id}/summary/',
            {'body': 'Grant released', 'actions': 'Sunita does the forms'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'bad_actions')
