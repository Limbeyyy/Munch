"""The interval between sessions, as the host sets it.

Fifteen minutes was the rule for everybody. A hall that has to be cleared
and re-laid needs longer; a panel changing chairs needs less. What is
worth pinning is that the number the host chooses is the number the
scheduler actually uses - the field would be decoration otherwise.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.accounts.models import HostAccount
from src.apps.meetings.models import Session
from src.apps.meetings.scheduling import (
    GAP_MINUTES, MAX_GAP_MINUTES, ScheduleConflict, check_slot, earliest_start,
    gap_minutes_for, reschedule,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


class IntervalTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=600)
        self.first = make_session(self.meeting, self.start, 60, 'Haldi')

    def set_gap(self, minutes):
        HostAccount.objects.update_or_create(
            user=self.host, defaults={'session_gap_minutes': minutes}
        )
        self.meeting.refresh_from_db()

    def test_without_a_preference_it_is_the_old_fifteen(self):
        self.assertEqual(gap_minutes_for(self.meeting), GAP_MINUTES)

    def test_the_hosts_own_interval_is_what_counts(self):
        self.set_gap(45)

        self.assertEqual(gap_minutes_for(self.meeting), 45)

    def test_the_next_session_may_start_after_that_interval(self):
        self.set_gap(45)

        soonest = earliest_start(self.meeting)

        self.assertEqual(
            (soonest - (self.start + timezone.timedelta(minutes=60))).total_seconds() / 60,
            45,
        )

    def test_a_slot_inside_the_interval_is_refused(self):
        self.set_gap(45)

        # Half an hour after the first ends: fine at fifteen, not at
        # forty-five.
        with self.assertRaises(ScheduleConflict):
            check_slot(
                self.meeting,
                self.start + timezone.timedelta(minutes=90),
                30,
            )

    def test_and_the_refusal_quotes_the_hosts_own_number(self):
        self.set_gap(45)

        with self.assertRaises(ScheduleConflict) as refused:
            check_slot(self.meeting, self.start + timezone.timedelta(minutes=90), 30)

        self.assertIn('45 minutes', str(refused.exception))

    def test_the_same_slot_is_allowed_at_the_shorter_interval(self):
        self.set_gap(15)

        check_slot(self.meeting, self.start + timezone.timedelta(minutes=90), 30)

    def test_moving_a_session_reflows_by_the_hosts_interval(self):
        self.set_gap(30)
        second = make_session(
            self.meeting, self.start + timezone.timedelta(minutes=90), 60, 'Sagun'
        )

        # Drag the second onto the first's heels; the reflow should push it
        # to the first's end plus thirty rather than plus fifteen.
        reschedule(
            self.meeting,
            {str(second.id): {'starts_at': self.start + timezone.timedelta(minutes=61)}},
            anchored_id=str(second.id),
        )

        second.refresh_from_db()
        self.assertEqual(
            (second.starts_at - (self.start + timezone.timedelta(minutes=60)))
            .total_seconds() / 60,
            30,
        )

    def test_zero_means_back_to_back(self):
        self.set_gap(0)

        check_slot(self.meeting, self.start + timezone.timedelta(minutes=60), 30)


class IntervalEndpointTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')

    def client_for(self, user):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def test_it_reports_the_default_before_anything_is_set(self):
        body = self.client_for(self.host).get(f'{API}/users/scheduling/').json()

        self.assertEqual(body['session_gap_minutes'], GAP_MINUTES)
        self.assertEqual(body['max_session_gap_minutes'], MAX_GAP_MINUTES)

    def test_setting_it_sticks(self):
        client = self.client_for(self.host)

        client.post(
            f'{API}/users/scheduling/', {'session_gap_minutes': 25},
            content_type='application/json',
        )

        self.assertEqual(
            client.get(f'{API}/users/scheduling/').json()['session_gap_minutes'], 25
        )
        self.assertEqual(
            HostAccount.objects.get(user=self.host).session_gap_minutes, 25
        )

    def test_something_that_is_not_a_number_is_refused(self):
        response = self.client_for(self.host).post(
            f'{API}/users/scheduling/', {'session_gap_minutes': 'half an hour'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'not_a_number')

    def test_an_interval_longer_than_the_day_is_refused(self):
        response = self.client_for(self.host).post(
            f'{API}/users/scheduling/', {'session_gap_minutes': 600},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'out_of_range')

    def test_a_negative_interval_is_refused(self):
        response = self.client_for(self.host).post(
            f'{API}/users/scheduling/', {'session_gap_minutes': -5},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)

    def test_it_needs_signing_in(self):
        from django.test import Client

        self.assertEqual(Client().get(f'{API}/users/scheduling/').status_code, 401)


class ReminderSettingTests(TestCase):
    """How much warning a programme gives, as the host sets it."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=180)
        self.session = make_session(self.meeting, self.start, 60, 'Haldi')

    def client_for(self, user):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def set_leads(self, **fields):
        HostAccount.objects.update_or_create(user=self.host, defaults=fields)
        self.meeting.refresh_from_db()

    def reminders(self):
        from src.apps.meetings.models import Reminder
        from src.apps.meetings.reminders import generate_for_meeting

        Reminder.objects.all().delete()
        generate_for_meeting(self.meeting)
        return {r.kind: r for r in Reminder.objects.filter(user=self.host)}

    def test_without_a_preference_it_is_an_hour_and_a_quarter_of_one(self):
        rows = self.reminders()

        self.assertEqual(
            (self.meeting.scheduled_start - rows['meeting'].due_at).total_seconds() / 60,
            60,
        )
        self.assertEqual(
            (self.session.starts_at - rows['session'].due_at).total_seconds() / 60,
            15,
        )

    def test_the_hosts_own_warning_is_what_is_used(self):
        self.set_leads(meeting_reminder_minutes=180, session_reminder_minutes=45)

        rows = self.reminders()

        self.assertEqual(
            (self.meeting.scheduled_start - rows['meeting'].due_at).total_seconds() / 60,
            180,
        )
        self.assertEqual(
            (self.session.starts_at - rows['session'].due_at).total_seconds() / 60,
            45,
        )

    def test_turning_them_off_writes_none_at_all(self):
        self.set_leads(reminders_enabled=False)

        self.assertEqual(self.reminders(), {})

    def test_turning_them_back_on_writes_them_again(self):
        self.set_leads(reminders_enabled=False)
        self.reminders()
        self.set_leads(reminders_enabled=True)

        self.assertEqual(len(self.reminders()), 2)

    def test_the_page_quotes_the_warning_it_actually_gave(self):
        self.set_leads(meeting_reminder_minutes=120, session_reminder_minutes=30)
        self.reminders()

        body = self.client_for(self.host).get(f'{API}/reminders/').json()

        self.assertEqual(body['meeting_lead_minutes'], 120)
        self.assertEqual(body['session_lead_minutes'], 30)
        leads = {r['kind']: r['lead_minutes'] for r in body['reminders']}
        self.assertEqual(leads, {'meeting': 120, 'session': 30})

    def test_the_settings_endpoint_carries_them(self):
        client = self.client_for(self.host)

        client.post(
            f'{API}/users/scheduling/',
            {'meeting_reminder_minutes': 90, 'reminders_enabled': False},
            content_type='application/json',
        )

        body = client.get(f'{API}/users/scheduling/').json()
        self.assertEqual(body['meeting_reminder_minutes'], 90)
        self.assertFalse(body['reminders_enabled'])
        # Untouched fields keep what they had.
        self.assertEqual(body['session_reminder_minutes'], 15)

    def test_one_field_at_a_time_leaves_the_others_alone(self):
        client = self.client_for(self.host)
        client.post(
            f'{API}/users/scheduling/', {'session_gap_minutes': 25},
            content_type='application/json',
        )
        client.post(
            f'{API}/users/scheduling/', {'session_reminder_minutes': 5},
            content_type='application/json',
        )

        body = client.get(f'{API}/users/scheduling/').json()
        self.assertEqual(body['session_gap_minutes'], 25)
        self.assertEqual(body['session_reminder_minutes'], 5)

    def test_more_than_a_day_of_warning_is_refused(self):
        response = self.client_for(self.host).post(
            f'{API}/users/scheduling/', {'meeting_reminder_minutes': 2000},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['field'], 'meeting_reminder_minutes')

    def test_sending_nothing_changes_nothing_and_says_so(self):
        response = self.client_for(self.host).post(
            f'{API}/users/scheduling/', {}, content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'nothing_to_change')
