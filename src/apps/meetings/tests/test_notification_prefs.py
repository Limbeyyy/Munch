"""What somebody asked not to be told about, they are not told about."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.accounts.models import NotificationPrefs
from src.apps.meetings.models import Event, Reminder, Session

User = get_user_model()


class NotificationPrefsTests(APITestCase):
    def setUp(self):
        self.host = User.objects.create_user(
            username='host', email='host@example.com', password='pw'
        )
        self.me = User.objects.create_user(
            username='me', email='me@example.com', password='pw'
        )
        starts = timezone.now() + timezone.timedelta(days=2)
        self.event = Event.objects.create(
            host=self.host, title='Emergency Service Meeting',
            event_date=starts.date(),
            scheduled_start=starts,
            scheduled_end=starts + timezone.timedelta(hours=3),
        )
        self.event.invites.create(email=self.me.email)
        Session.objects.create(
            event=self.event, title='Opening',
            starts_at=starts,
            duration_minutes=60,
        )

    def write(self):
        from src.apps.meetings.reminders import generate_for_meeting
        return generate_for_meeting(self.event)

    def mine(self, kind):
        return Reminder.objects.filter(user=self.me, kind=kind).count()

    # --- the endpoint ------------------------------------------------

    def test_the_screen_starts_with_everything_it_can_send_turned_on(self):
        self.client.force_authenticate(self.me)
        body = self.client.get('/api/v1/users/notifications/').json()

        self.assertTrue(body['event_reminders'])
        self.assertTrue(body['new_sessions'])

    def test_one_switch_can_be_sent_without_the_others(self):
        self.client.force_authenticate(self.me)
        self.client.post(
            '/api/v1/users/notifications/', {'new_sessions': False}, format='json'
        )
        body = self.client.get('/api/v1/users/notifications/').json()

        self.assertFalse(body['new_sessions'])
        self.assertTrue(body['event_reminders'], 'the others were left alone')

    def test_a_stranger_cannot_read_these(self):
        answer = self.client.get('/api/v1/users/notifications/')
        self.assertIn(answer.status_code, (401, 403))

    def test_one_person_s_answer_is_not_another_s(self):
        self.client.force_authenticate(self.me)
        self.client.post(
            '/api/v1/users/notifications/', {'event_reminders': False},
            format='json',
        )

        self.client.force_authenticate(self.host)
        body = self.client.get('/api/v1/users/notifications/').json()
        self.assertTrue(body['event_reminders'])

    # --- what the writer does with them ------------------------------

    def test_silence_is_not_a_request_to_be_left_out(self):
        self.write()
        self.assertEqual(self.mine(Reminder.Kind.EVENT), 1)
        self.assertEqual(self.mine(Reminder.Kind.SESSION), 1)

    def test_turning_event_reminders_off_stops_them_being_written(self):
        NotificationPrefs.objects.create(user=self.me, event_reminders=False)
        self.write()

        self.assertEqual(self.mine(Reminder.Kind.EVENT), 0)

    def test_and_leaves_the_session_ones_alone(self):
        NotificationPrefs.objects.create(user=self.me, event_reminders=False)
        self.write()

        self.assertEqual(self.mine(Reminder.Kind.SESSION), 1)

    def test_turning_session_reminders_off_stops_those(self):
        NotificationPrefs.objects.create(user=self.me, new_sessions=False)
        self.write()

        self.assertEqual(self.mine(Reminder.Kind.SESSION), 0)
        self.assertEqual(self.mine(Reminder.Kind.EVENT), 1)

    def test_one_person_opting_out_does_not_quieten_anybody_else(self):
        NotificationPrefs.objects.create(user=self.me, event_reminders=False)
        self.write()

        self.assertEqual(
            Reminder.objects.filter(
                user=self.host, kind=Reminder.Kind.EVENT
            ).count(),
            1,
        )
