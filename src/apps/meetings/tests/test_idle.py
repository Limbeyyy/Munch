"""Letting go of somebody who has stopped being in the room.

A socket held open is not a person present. The register is read
afterwards as a record of who was actually there, so a tab left running
in a window nobody is looking at must not be counted as an afternoon of
attendance.
"""
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns

from src.apps.accounts.models import HostAccount
from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.idle import evict_idle, timeout_for
from src.apps.meetings.models import Event, EventParticipant
from src.apps.meetings.tests.factories import make_event, make_host

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class LettingGoOfTheIdleTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        self.other = make_host('other@example.com')

        self.start = timezone.now() - timezone.timedelta(hours=1)
        self.event = make_event(self.host, start=self.start, minutes=180)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = self.start
        self.event.save()

        self.host_row = EventParticipant.objects.create(
            event=self.event, user=self.host,
            role=EventParticipant.Role.HOST, is_active=True,
        )
        self.row = EventParticipant.objects.create(
            event=self.event, user=self.attendee,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

    def seen(self, minutes_ago, row=None):
        row = row or self.row
        row.last_seen_at = timezone.now() - timezone.timedelta(minutes=minutes_ago)
        row.save(update_fields=['last_seen_at'])
        return row

    # -- the rule ---------------------------------------------------------

    def test_somebody_quiet_past_the_grace_is_let_go(self):
        self.seen(20)

        self.assertEqual(evict_idle(self.event), 1)

        self.row.refresh_from_db()
        self.assertFalse(self.row.is_active)
        self.assertIsNotNone(self.row.left_at)

    def test_somebody_who_has_just_done_something_is_left_alone(self):
        self.seen(2)

        self.assertEqual(evict_idle(self.event), 0)

        self.row.refresh_from_db()
        self.assertTrue(self.row.is_active)

    def test_the_hour_written_down_is_when_they_went_quiet_plus_the_grace(self):
        """The gap this closes.

        Writing down the moment the sweep ran would make the register a
        record of when a worker woke up. Somebody who went quiet at five,
        with a quarter of an hour's grace, left at a quarter past - and
        says so whether the sweep runs at a quarter past or at half past.
        """
        went_quiet = self.seen(40).last_seen_at

        evict_idle(self.event)

        self.row.refresh_from_db()
        self.assertEqual(
            self.row.left_at, went_quiet + timezone.timedelta(minutes=15)
        )

    def test_somebody_who_never_said_anything_is_measured_from_arriving(self):
        """Arriving is the last thing they are known to have done."""
        EventParticipant.objects.filter(pk=self.row.pk).update(
            last_seen_at=None,
            joined_at=timezone.now() - timezone.timedelta(minutes=30),
        )

        self.assertEqual(evict_idle(self.event), 1)

    def test_the_host_is_never_let_go(self):
        """Somebody has to hold the room open while the hall fills."""
        self.seen(120, row=self.host_row)

        evict_idle(self.event)

        self.host_row.refresh_from_db()
        self.assertTrue(self.host_row.is_active)

    def test_somebody_already_gone_is_not_let_go_twice(self):
        self.seen(40)
        first = evict_idle(self.event)
        was = EventParticipant.objects.get(pk=self.row.pk).left_at

        second = evict_idle(self.event)

        self.assertEqual((first, second), (1, 0))
        self.assertEqual(EventParticipant.objects.get(pk=self.row.pk).left_at, was)

    # -- the host's setting -----------------------------------------------

    def test_the_grace_is_the_hosts_to_set(self):
        HostAccount.objects.create(user=self.host, idle_timeout_minutes=45)
        self.seen(20)

        self.assertEqual(evict_idle(self.event), 0)

        self.seen(50)
        self.assertEqual(evict_idle(self.event), 1)

    def test_nought_turns_it_off_altogether(self):
        HostAccount.objects.create(user=self.host, idle_timeout_minutes=0)
        self.seen(600)

        self.assertEqual(evict_idle(self.event), 0)

    def test_a_host_with_no_account_gets_the_ordinary_quarter_hour(self):
        self.assertEqual(timeout_for(self.event), 15)

    # -- the sweep --------------------------------------------------------

    def test_the_sweep_leaves_a_room_that_is_not_running(self):
        from src.apps.meetings.tasks import evict_idle_attendees

        self.event.status = Event.Status.SCHEDULED
        self.event.save(update_fields=['status'])
        self.seen(40)

        self.assertEqual(evict_idle_attendees(), 0)
        self.assertTrue(EventParticipant.objects.get(pk=self.row.pk).is_active)

    def test_the_sweep_goes_through_the_rooms_that_are(self):
        from src.apps.meetings.tasks import evict_idle_attendees

        self.seen(40)

        self.assertEqual(evict_idle_attendees(), 1)


class TheIdleSettingTests(TestCase):
    """How long a host lets somebody sit idle, as a thing they can change."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.client = signed_in(self.host)
        self.url = f'{API}/users/scheduling/'

    def test_it_comes_back_with_the_other_intervals(self):
        got = self.client.get(self.url)

        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.data['idle_timeout_minutes'], 15)
        self.assertEqual(got.data['defaults']['idle_timeout_minutes'], 15)

    def test_a_host_may_set_it(self):
        got = self.client.post(
            self.url, {'idle_timeout_minutes': 30}, format='json'
        )

        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.data['idle_timeout_minutes'], 30)

    def test_nought_is_allowed_because_it_means_off(self):
        got = self.client.post(
            self.url, {'idle_timeout_minutes': 0}, format='json'
        )

        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.data['idle_timeout_minutes'], 0)

    def test_something_absurd_is_refused(self):
        got = self.client.post(
            self.url, {'idle_timeout_minutes': 10000}, format='json'
        )

        self.assertEqual(got.status_code, 400)


@override_settings(
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
)
class SayingSoOverTheSocketTests(TransactionTestCase):
    """What counts as a sign of life, driven against the real consumer."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.attendee = make_host('attendee@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.chat_enabled = True
        self.event.direct_messages_enabled = True
        self.event.save()
        for user, role in (
            (self.host, EventParticipant.Role.HOST),
            (self.attendee, EventParticipant.Role.ATTENDEE),
        ):
            EventParticipant.objects.create(
                event=self.event, user=user, role=role, is_active=True,
            )

    async def speaking_as(self, user):
        token = str(AccessToken.for_user(user))
        comm = WebsocketCommunicator(
            JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
            f'/ws/event/{self.event.code}/?token={token}'
        )
        connected, _ = await comm.connect()
        assert connected, f'{user.email} could not reach the room'
        return comm

    def seen_at(self):
        return EventParticipant.objects.get(
            event=self.event, user=self.attendee
        ).last_seen_at

    async def test_a_heartbeat_counts_as_being_here(self):
        """The gap this closes.

        Somebody watching a talk says nothing for half an hour. Measuring
        presence by what they send would let the room go of them mid-talk,
        so the room reports that they are moving and typing even when they
        are not writing anything.
        """
        await database_sync_to_async(
            EventParticipant.objects.filter(
                event=self.event, user=self.attendee
            ).update
        )(last_seen_at=None)

        comm = await self.speaking_as(self.attendee)
        await comm.send_json_to({'type': 'heartbeat'})
        await comm.receive_nothing(timeout=0.3)
        await comm.disconnect()

        self.assertIsNotNone(await database_sync_to_async(self.seen_at)())

    async def test_and_so_does_anything_else_they_send(self):
        await database_sync_to_async(
            EventParticipant.objects.filter(
                event=self.event, user=self.attendee
            ).update
        )(last_seen_at=None)

        comm = await self.speaking_as(self.attendee)
        await comm.send_json_to({
            'type': 'chat_message', 'message': 'Why this budget?',
            'recipient_id': str(self.host.id),
        })
        for _ in range(4):
            said = await comm.receive_json_from()
            if said.get('type') in ('chat_message', 'chat_pending'):
                break
        await comm.disconnect()

        self.assertIsNotNone(await database_sync_to_async(self.seen_at)())

    async def test_being_let_go_reaches_the_person_it_happened_to(self):
        """Otherwise the row says they left and their screen does not."""
        comm = await self.speaking_as(self.attendee)
        await comm.send_json_to({'type': 'heartbeat'})
        await comm.receive_nothing(timeout=0.3)

        await database_sync_to_async(
            EventParticipant.objects.filter(
                event=self.event, user=self.attendee
            ).update
        )(last_seen_at=timezone.now() - timezone.timedelta(minutes=40))

        await database_sync_to_async(evict_idle)(self.event)

        # The room is chatty on the way in, so the frame is looked for
        # rather than assumed to be the next thing said.
        for _ in range(6):
            said = await comm.receive_json_from(timeout=2)
            if said.get('type') == 'idle_evicted':
                break
        else:
            self.fail('the room never said they had been let go')

        self.assertIsNotNone(said['left_at'])
        await comm.disconnect()
