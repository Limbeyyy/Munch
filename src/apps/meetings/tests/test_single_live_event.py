from rest_framework.test import APITestCase
from django.utils import timezone

from src.apps.meetings.models import Event
from src.apps.meetings.tests.factories import make_host, make_event, make_session


class OneLiveEventPerHostTests(APITestCase):
    def setUp(self):
        self.host = make_host()
        self.client.force_authenticate(user=self.host)
        now = timezone.now()
        self.running = make_event(
            self.host,
            start=now - timezone.timedelta(minutes=30),
            title='Already live',
        )
        self.running.status = Event.Status.ACTIVE
        self.running.started_at = now - timezone.timedelta(minutes=30)
        self.running.save(update_fields=['status', 'started_at'])

        self.next = make_event(self.host, start=now, title='Another event')
        self.session = make_session(
            self.next, now - timezone.timedelta(minutes=1)
        )

    def test_a_second_event_cannot_be_started(self):
        response = self.client.post(
            f'/api/v1/events/{self.next.id}/start/'
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'host_already_live')
        self.next.refresh_from_db()
        self.assertEqual(self.next.status, Event.Status.SCHEDULED)

    def test_a_session_cannot_start_in_a_second_event(self):
        response = self.client.post(
            f'/api/v1/sessions/{self.session.id}/start/'
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'host_already_live')
        self.session.refresh_from_db()
        self.assertNotEqual(self.session.status, 'live')
