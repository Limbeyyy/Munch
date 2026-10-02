"""The named parts of a programme.

A long day is not one list. "Emergency", "SOS", "Solutions" - a handful
of talks belong together under a heading, and reading the running order
as a flat sequence loses that.

A grouping and nothing else: the talks keep their own hours, a talk in
no group is still on the programme, and removing a heading leaves what
was under it standing.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import Session, SubEvent
from src.apps.meetings.tests.factories import make_event, make_host, make_session

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class GroupingTheRunningOrderTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.other = make_host('other@example.com')
        start = timezone.now() + timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, minutes=240)
        self.opening = make_session(self.event, start, 30, 'Opening')
        self.middle = make_session(
            self.event, start + timezone.timedelta(hours=1), 30, 'Middle'
        )
        self.closing = make_session(
            self.event, start + timezone.timedelta(hours=2), 30, 'Closing'
        )
        self.client = signed_in(self.host)
        self.url = f'{API}/events/{self.event.id}/sub_events/'

    def add(self, **over):
        body = {'title': 'Emergency'}
        body.update(over)
        return self.client.post(self.url, body, format='json')

    def listed(self):
        body = self.client.get(self.url).data
        return body['results'] if isinstance(body, dict) else body

    # -- the grouping -----------------------------------------------------

    def test_a_group_is_written_against_the_event(self):
        got = self.add()

        self.assertEqual(got.status_code, 201)
        group = SubEvent.objects.get()
        self.assertEqual(group.event_id, self.event.id)
        self.assertEqual(group.title, 'Emergency')

    def test_it_may_say_what_it_is_about(self):
        self.add(description='Everything about the first response.')

        self.assertEqual(
            SubEvent.objects.get().description,
            'Everything about the first response.',
        )

    def test_talks_are_put_in_it(self):
        self.add(session_ids=[str(self.opening.id), str(self.middle.id)])

        group = SubEvent.objects.get()
        self.assertEqual(
            sorted(one.title for one in group.sessions.all()),
            ['Middle', 'Opening'],
        )

    def test_a_talk_in_no_group_is_still_on_the_programme(self):
        self.add(session_ids=[str(self.opening.id)])

        self.closing.refresh_from_db()
        self.assertIsNone(self.closing.sub_event)
        self.assertTrue(Session.objects.filter(id=self.closing.id).exists())

    def test_a_talk_moves_from_one_group_to_another(self):
        self.add(session_ids=[str(self.opening.id)])
        first = SubEvent.objects.get()

        self.client.post(
            self.url,
            {'title': 'SOS', 'session_ids': [str(self.opening.id)]},
            format='json',
        )

        self.opening.refresh_from_db()
        self.assertEqual(self.opening.sub_event.title, 'SOS')
        self.assertEqual(first.sessions.count(), 0)

    def test_taking_one_out_leaves_the_others(self):
        self.add(session_ids=[str(self.opening.id), str(self.middle.id)])
        group = SubEvent.objects.get()

        self.client.patch(
            f'{self.url}{group.id}/',
            {'session_ids': [str(self.middle.id)]},
            format='json',
        )

        self.assertEqual(
            [one.id for one in group.sessions.all()], [self.middle.id]
        )

    def test_renaming_a_heading_does_not_empty_it(self):
        self.add(session_ids=[str(self.opening.id)])
        group = SubEvent.objects.get()

        self.client.patch(
            f'{self.url}{group.id}/', {'title': 'First response'}, format='json'
        )

        self.assertEqual(group.sessions.count(), 1)

    def test_a_talk_from_another_event_is_not_taken(self):
        elsewhere = make_event(self.host, start=timezone.now())
        theirs = make_session(elsewhere, timezone.now(), 30, 'Theirs')

        self.add(session_ids=[str(theirs.id)])

        theirs.refresh_from_db()
        self.assertIsNone(theirs.sub_event)

    # -- removing one -----------------------------------------------------

    def test_removing_a_heading_leaves_its_talks_standing(self):
        """A heading is a way of reading the day, not a container it is
        kept in."""
        self.add(session_ids=[str(self.opening.id)])
        group = SubEvent.objects.get()

        self.client.delete(f'{self.url}{group.id}/')

        self.opening.refresh_from_db()
        self.assertIsNone(self.opening.sub_event)
        self.assertTrue(Session.objects.filter(id=self.opening.id).exists())

    # -- who may ----------------------------------------------------------

    def test_nobody_but_the_host_writes_one(self):
        got = signed_in(self.other).post(
            self.url, {'title': 'Mine now'}, format='json'
        )

        self.assertEqual(got.status_code, 403)
        self.assertFalse(SubEvent.objects.exists())

    def test_they_come_back_with_what_is_in_them(self):
        self.add(session_ids=[str(self.opening.id)])

        rows = self.listed()

        self.assertEqual(len(rows), 1)
        self.assertEqual(
            [one['title'] for one in rows[0]['sessions']], ['Opening']
        )

    def test_a_session_says_which_group_it_is_in(self):
        self.add(session_ids=[str(self.opening.id)])
        group = SubEvent.objects.get()

        body = self.client.get(f'{API}/sessions/?event={self.event.id}').data
        rows = body['results'] if isinstance(body, dict) else body
        mine = next(one for one in rows if one['title'] == 'Opening')

        self.assertEqual(mine['sub_event'], group.id)


class FilingATalkUnderAHeadingTests(TestCase):
    """Which heading a talk may be filed under, written from its own form.

    The field has always been writable; until the host side grew a form
    that sets it, nothing ever did. What the form must not be allowed to
    do is file a talk under somebody else's heading: every screen reads
    a day as its event's headings plus whatever is under none of them,
    so a talk pointing elsewhere would be in neither list and simply
    stop appearing on the programme.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() + timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, minutes=240)
        self.talk = make_session(self.event, start, 30, 'Opening')
        self.mine = SubEvent.objects.create(event=self.event, title='Climate')

        # Another host's event entirely, with a heading of its own.
        self.stranger = make_host('stranger@example.com')
        theirs = make_event(self.stranger, start=start, minutes=60)
        self.not_mine = SubEvent.objects.create(event=theirs, title='Theirs')

        self.client = signed_in(self.host)

    def test_a_talk_goes_under_a_heading_of_its_own_event(self):
        response = self.client.patch(
            f'{API}/sessions/{self.talk.id}/',
            {'sub_event': str(self.mine.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.talk.refresh_from_db()
        self.assertEqual(self.talk.sub_event_id, self.mine.id)

    def test_a_heading_from_another_event_is_refused(self):
        response = self.client.patch(
            f'{API}/sessions/{self.talk.id}/',
            {'sub_event': str(self.not_mine.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('sub_event', response.data)
        self.talk.refresh_from_db()
        self.assertIsNone(self.talk.sub_event_id)

    def test_a_talk_can_be_taken_back_out_of_its_heading(self):
        self.talk.sub_event = self.mine
        self.talk.save(update_fields=['sub_event'])

        response = self.client.patch(
            f'{API}/sessions/{self.talk.id}/',
            {'sub_event': None},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.talk.refresh_from_db()
        self.assertIsNone(self.talk.sub_event_id)

    def test_a_new_talk_may_name_its_heading_as_it_is_written(self):
        start = self.event.scheduled_start + timezone.timedelta(hours=3)
        response = self.client.post(
            f'{API}/sessions/',
            {
                'event': str(self.event.id),
                'title': 'Carbon',
                'starts_at': start.isoformat(),
                'duration_minutes': 30,
                'sub_event': str(self.mine.id),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        written = Session.objects.get(id=response.data['id'])
        self.assertEqual(written.sub_event_id, self.mine.id)

    def test_a_new_talk_may_not_name_another_event_s_heading(self):
        start = self.event.scheduled_start + timezone.timedelta(hours=3)
        response = self.client.post(
            f'{API}/sessions/',
            {
                'event': str(self.event.id),
                'title': 'Carbon',
                'starts_at': start.isoformat(),
                'duration_minutes': 30,
                'sub_event': str(self.not_mine.id),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Session.objects.filter(title='Carbon').exists())
