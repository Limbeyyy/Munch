"""Who is reminded of what, and how long before.

A meeting is somewhere you have to get to, so an hour's warning helps. A
session is a talk inside a meeting you are probably already at, so fifteen
minutes is enough - and an hour's warning for each of four talks would be
noise rather than help.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import MeetingInvite, Reminder
from src.apps.meetings.reminders import (
    MEETING_LEAD_MINUTES, SESSION_LEAD_MINUTES, calendar_link,
    generate_for_meeting,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class LeadTimeTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=240)
        # One meeting, four sessions - the shape from the brief.
        self.sessions = [
            make_session(
                self.meeting,
                self.start + timezone.timedelta(minutes=45 * i),
                30,
                f'Session {i + 1}',
            )
            for i in range(4)
        ]

    def mine(self, kind=None):
        rows = Reminder.objects.filter(user=self.host)
        return rows.filter(kind=kind) if kind else rows

    def test_one_meeting_reminder_and_one_per_session(self):
        generate_for_meeting(self.meeting)

        self.assertEqual(self.mine(Reminder.Kind.MEETING).count(), 1)
        self.assertEqual(self.mine(Reminder.Kind.SESSION).count(), 4)

    def test_the_meeting_is_remembered_an_hour_before(self):
        generate_for_meeting(self.meeting)

        reminder = self.mine(Reminder.Kind.MEETING).get()
        self.assertEqual(
            reminder.due_at,
            self.start - timezone.timedelta(minutes=MEETING_LEAD_MINUTES),
        )

    def test_each_session_a_quarter_of_an_hour_before_its_own_start(self):
        generate_for_meeting(self.meeting)

        for session in self.sessions:
            reminder = Reminder.objects.get(user=self.host, session=session)
            self.assertEqual(
                reminder.due_at,
                session.starts_at - timezone.timedelta(minutes=SESSION_LEAD_MINUTES),
            )

    def test_sessions_are_not_each_given_an_hour(self):
        # The point of two lead times: four hour-early nudges for one
        # morning would be noise.
        generate_for_meeting(self.meeting)

        hours_early = [
            r for r in self.mine(Reminder.Kind.SESSION)
            if (r.starts_at - r.due_at) > timezone.timedelta(minutes=SESSION_LEAD_MINUTES)
        ]
        self.assertEqual(hours_early, [])

    def test_writing_them_again_does_not_double_them(self):
        generate_for_meeting(self.meeting)
        generate_for_meeting(self.meeting)

        self.assertEqual(self.mine().count(), 5)

    def test_moving_the_timetable_moves_the_reminder(self):
        generate_for_meeting(self.meeting)
        moved = self.sessions[0]
        moved.starts_at = moved.starts_at + timezone.timedelta(hours=2)
        moved.save(update_fields=['starts_at'])

        generate_for_meeting(self.meeting)

        reminder = Reminder.objects.get(user=self.host, session=moved)
        self.assertEqual(
            reminder.due_at,
            moved.starts_at - timezone.timedelta(minutes=SESSION_LEAD_MINUTES),
        )
        self.assertEqual(self.mine().count(), 5)

    def test_nothing_is_written_for_a_meeting_already_over(self):
        past = make_meeting(
            self.host, self.event, start=timezone.now() - timezone.timedelta(days=1)
        )
        make_session(past, past.scheduled_start, 30, 'Long gone')

        self.assertEqual(generate_for_meeting(past), 0)

    def test_a_session_already_run_is_not_remembered(self):
        ran = self.sessions[0]
        ran.status = ran.Status.DONE
        ran.save(update_fields=['status'])

        generate_for_meeting(self.meeting)

        self.assertFalse(Reminder.objects.filter(session=ran).exists())


class WhoIsRemindedTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=self.start)
        self.session = make_session(self.meeting, self.start, 30, 'Haldi')

    def test_the_host_is_reminded(self):
        generate_for_meeting(self.meeting)
        self.assertTrue(Reminder.objects.filter(user=self.host).exists())

    def test_somebody_invited_is_reminded(self):
        asked = make_host('asked@example.com')
        MeetingInvite.objects.create(
            meeting=self.meeting, email=asked.email, invited_by=self.host
        )

        generate_for_meeting(self.meeting)

        self.assertTrue(Reminder.objects.filter(user=asked).exists())

    def test_the_speaker_is_reminded(self):
        speaker = make_host('surya@example.com')
        self.session.speaker_email = speaker.email
        self.session.save(update_fields=['speaker_email'])

        generate_for_meeting(self.meeting)

        self.assertTrue(Reminder.objects.filter(user=speaker).exists())

    def test_a_stranger_is_not(self):
        stranger = make_host('stranger@example.com')

        generate_for_meeting(self.meeting)

        self.assertFalse(Reminder.objects.filter(user=stranger).exists())


class ReminderPageTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() + timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=120)
        self.session = make_session(self.meeting, self.start, 30, 'Haldi')
        self.client = signed_in(self.host)

    def page(self):
        return self.client.get(f'{API}/reminders/').json()

    def test_the_page_generates_what_is_missing(self):
        self.assertEqual(Reminder.objects.count(), 0)

        body = self.page()

        self.assertEqual(len(body['reminders']), 2)
        self.assertEqual(body['meeting_lead_minutes'], MEETING_LEAD_MINUTES)
        self.assertEqual(body['session_lead_minutes'], SESSION_LEAD_MINUTES)

    def test_each_carries_a_link_to_put_it_in_a_diary(self):
        rows = self.page()['reminders']

        for row in rows:
            self.assertIn('calendar.google.com', row['calendar_url'])
            self.assertIn('action=TEMPLATE', row['calendar_url'])

    def test_the_session_link_names_the_session_and_its_meeting(self):
        rows = self.page()['reminders']
        session_row = next(r for r in rows if r['kind'] == 'session')

        self.assertIn('Haldi', session_row['calendar_url'])
        self.assertEqual(session_row['session_title'], 'Haldi')

    def test_nothing_already_past_is_listed(self):
        gone = make_meeting(
            self.host, self.event,
            start=timezone.now() - timezone.timedelta(hours=2),
            title='Yesterday',
        )
        make_session(gone, gone.scheduled_start, 30, 'Over')

        titles = [r['meeting_title'] for r in self.page()['reminders']]
        self.assertNotIn('Yesterday', titles)

    def ran(self, hours_ago):
        """Put the whole thing that far into the past.

        The timetable moves as well as the reminder rows: a meeting still
        ahead would be regenerated on the next read, which would quietly
        put the times back.
        """
        then = timezone.now() - timezone.timedelta(hours=hours_ago)
        self.meeting.scheduled_start = then
        self.meeting.scheduled_end = then + timezone.timedelta(minutes=120)
        self.meeting.save()
        self.session.starts_at = then
        self.session.save(update_fields=['starts_at'])
        Reminder.objects.update(starts_at=then)

    def test_this_morning_is_still_there_this_afternoon(self):
        # Written while the session was still ahead, then the session ran.
        # The nudge stays on the page rather than disappearing the moment
        # it stops being useful as a warning.
        self.page()
        self.ran(2)

        self.assertEqual(len(self.page()['reminders']), 2)

    def test_it_does_not_become_an_archive(self):
        self.page()
        self.ran(30)

        self.assertEqual(self.page()['reminders'], [])

    def test_only_a_due_reminder_counts_as_unread(self):
        # Three hours off, so nothing is due yet.
        self.assertEqual(self.page()['unread'], 0)

    def imminent(self):
        """Bring the whole thing close enough that both nudges are due.

        The times are moved, not the reminder rows: reading regenerates
        those from the timetable, which is the only thing that decides when
        a nudge is owed.
        """
        soon = timezone.now() + timezone.timedelta(minutes=5)
        self.meeting.scheduled_start = soon
        self.meeting.scheduled_end = soon + timezone.timedelta(minutes=120)
        self.meeting.save()
        self.session.starts_at = soon
        self.session.save(update_fields=['starts_at'])

    def test_marking_them_read_puts_the_badge_down(self):
        self.imminent()
        self.assertEqual(self.page()['unread'], 2)

        self.client.post(f'{API}/reminders/read/')

        self.assertEqual(self.page()['unread'], 0)

    def test_one_can_be_marked_on_its_own(self):
        self.imminent()
        rows = self.page()['reminders']

        self.client.post(f'{API}/reminders/read/', {'id': rows[0]['id']}, format='json')

        self.assertEqual(self.page()['unread'], 1)

    def test_somebody_elses_reminders_are_not_mine(self):
        other = make_host('other@example.com')
        self.page()

        self.assertEqual(len(signed_in(other).get(f'{API}/reminders/').json()['reminders']), 0)


class CalendarLinkTests(TestCase):
    def test_it_carries_the_times_in_the_shape_google_wants(self):
        start = timezone.datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)
        url = calendar_link(
            title='Haldi', starts_at=start,
            ends_at=start + timezone.timedelta(minutes=30),
        )

        self.assertIn('dates=20260908T090000Z%2F20260908T093000Z', url)

    def test_it_survives_a_title_with_awkward_characters(self):
        start = timezone.datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)
        url = calendar_link(
            title='Haldi & Mehendi — "the day"', starts_at=start,
            ends_at=start + timezone.timedelta(minutes=30),
            location='Hall A & B',
        )

        self.assertNotIn(' ', url)
        self.assertIn('Haldi', url)
