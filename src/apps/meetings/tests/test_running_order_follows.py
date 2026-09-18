"""The first talk opens the event, whatever the event's hour is changed to."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import Session
from src.apps.meetings.scheduling import ScheduleConflict, check_slot, realign_running_order
from src.apps.meetings.tests.factories import at, make_event, make_host, make_session

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class RealignTests(TestCase):
    """An event is the parent of its sessions; its hour is the one they keep."""

    def setUp(self):
        self.host = make_host()
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=30, second=0, microsecond=0
        )
        self.event = make_event(self.host, start=self.nine, minutes=180)
        self.first = make_session(self.event, self.nine, 30, 'Kataho')
        self.second = make_session(
            self.event, at(self.nine, hours=1, minutes=30), 30, 'Addressgraph'
        )

    def test_moving_the_event_takes_the_first_talk_with_it(self):
        self.event.scheduled_start = at(self.nine, hours=1)
        self.event.save(update_fields=['scheduled_start'])

        realign_running_order(self.event)

        self.first.refresh_from_db()
        self.assertEqual(self.first.starts_at, self.event.scheduled_start)

    def test_the_rest_of_the_day_keeps_its_shape(self):
        self.event.scheduled_start = at(self.nine, hours=1)
        self.event.save(update_fields=['scheduled_start'])

        realign_running_order(self.event)

        self.first.refresh_from_db()
        self.second.refresh_from_db()
        # An hour and a half apart before, an hour and a half apart after.
        self.assertEqual(
            self.second.starts_at - self.first.starts_at,
            timezone.timedelta(hours=1, minutes=30),
        )

    def test_a_running_order_left_behind_is_put_back(self):
        # The shape of the reported bug: the event was moved later and the
        # talks stayed in the morning.
        self.event.scheduled_start = at(self.nine, hours=1)
        self.event.save(update_fields=['scheduled_start'])
        self.assertLess(self.first.starts_at, self.event.scheduled_start)

        realign_running_order(self.event)

        self.first.refresh_from_db()
        self.assertEqual(self.first.starts_at, self.event.scheduled_start)

    def test_it_pulls_a_late_running_order_forward_too(self):
        self.event.scheduled_start = at(self.nine, hours=-1)
        self.event.save(update_fields=['scheduled_start'])

        realign_running_order(self.event)

        self.first.refresh_from_db()
        self.assertEqual(self.first.starts_at, self.event.scheduled_start)

    def test_it_does_nothing_when_the_two_already_agree(self):
        moved = realign_running_order(self.event)

        self.assertEqual(moved, [])

    def test_it_leaves_a_day_that_has_started_alone(self):
        """Once a talk has run, its time is a record rather than a plan."""
        self.first.status = Session.Status.DONE
        self.first.save(update_fields=['status'])
        self.event.scheduled_start = at(self.nine, hours=1)
        self.event.save(update_fields=['scheduled_start'])

        realign_running_order(self.event)

        self.first.refresh_from_db()
        self.second.refresh_from_db()
        self.assertEqual(self.first.starts_at, self.nine)
        self.assertEqual(self.second.starts_at, at(self.nine, hours=1, minutes=30))

    def test_the_window_grows_to_cover_a_day_pushed_past_it(self):
        self.event.scheduled_start = at(self.nine, hours=2)
        self.event.save(update_fields=['scheduled_start'])

        realign_running_order(self.event)

        self.second.refresh_from_db()
        self.event.refresh_from_db()
        last_ends = self.second.starts_at + timezone.timedelta(
            minutes=self.second.duration_minutes
        )
        self.assertGreaterEqual(self.event.scheduled_end, last_ends)


class SavingTheEventTests(TestCase):
    """The same rule, through the endpoint a screen actually uses."""

    def setUp(self):
        self.host = make_host()
        self.nine = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=9, minute=30, second=0, microsecond=0
        )
        self.event = make_event(self.host, start=self.nine, minutes=180)
        self.first = make_session(self.event, self.nine, 30, 'Kataho')
        self.client = signed_in(self.host)

    def test_changing_the_hour_moves_the_running_order(self):
        later = at(self.nine, hours=1)

        response = self.client.patch(
            f'{API}/events/{self.event.id}/',
            {'scheduled_start': later.isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.first.refresh_from_db()
        self.assertEqual(self.first.starts_at, later)

    def test_saving_anything_else_puts_a_drifted_order_back(self):
        # Drifted apart before this fix existed.
        Session.objects.filter(id=self.first.id).update(
            starts_at=at(self.nine, hours=-1)
        )

        self.client.patch(
            f'{API}/events/{self.event.id}/', {'venue': 'Bhrikuti Mandap'},
            format='json',
        )

        self.first.refresh_from_db()
        self.assertEqual(self.first.starts_at, self.event.scheduled_start)


class NothingStartsBeforeTheEventTests(TestCase):
    """An event is the parent of its sessions; none of them precedes it."""

    def setUp(self):
        self.host = make_host()
        self.ten = (timezone.now() + timezone.timedelta(days=1)).replace(
            hour=10, minute=30, second=0, microsecond=0
        )
        self.event = make_event(self.host, start=self.ten, minutes=180)

    def test_a_slot_before_the_event_opens_is_refused(self):
        with self.assertRaises(ScheduleConflict) as refused:
            check_slot(self.event, at(self.ten, hours=-1), 30)

        self.assertIn('opens at', str(refused.exception))

    def test_the_hour_it_opens_is_allowed(self):
        check_slot(self.event, self.ten, 30)

    def test_so_is_anything_after_it(self):
        check_slot(self.event, at(self.ten, hours=2), 30)

    def test_the_endpoint_refuses_it_too(self):
        response = signed_in(self.host).post(
            f'{API}/sessions/',
            {
                'event': str(self.event.id),
                'title': 'Too early',
                'starts_at': at(self.ten, hours=-1).isoformat(),
                'duration_minutes': 30,
                'speaker_name': 'A Speaker',
                'speaker_email': 'speaker@example.com',
                'speaker_phone': '9800000000',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Session.objects.filter(event=self.event).count(), 0)
