"""The hall's capture device, streaming transcript over a socket.

The device may post a line at a time or hold one socket open and stream
them. Both doors lead to the same rule - stored if final, broadcast
either way, filed against whatever is on stage - because two copies of
that rule would drift, and the difference would be which lines got kept.

A device is not a person, so what is pinned hardest here is that the
token is what gets it in, and that a line reaches exactly one event.
"""
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from src.apps.meetings.models import Event
from src.apps.meetings.tests.factories import make_event, make_host, make_session
from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns
from src.apps.transcription.models import TranscriptionSegment

TOKEN = 'a-shared-device-secret'


def app():
    return JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns))


@override_settings(
    TRANSCRIPTION_INGEST_TOKEN=TOKEN,
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}},
)
class TheCaptureDeviceSocketTests(TransactionTestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(
            self.event, start, 60, 'Opening', status='live'
        )

    async def device(self, token=TOKEN, code=None):
        comm = WebsocketCommunicator(
            app(),
            f'/ws/device/{code or self.event.code}/transcribe/?token={token}'
        )
        connected, _ = await comm.connect()
        return comm, connected

    def lines(self):
        return list(
            TranscriptionSegment.objects.filter(event=self.event)
            .values_list('text', flat=True)
        )

    # -- getting in -------------------------------------------------------

    async def test_the_token_is_what_gets_it_in(self):
        comm, connected = await self.device()

        self.assertTrue(connected)
        await comm.disconnect()

    async def test_without_the_token_it_is_refused(self):
        """Refused before accepting, so it never holds a connection."""
        comm, connected = await self.device(token='')

        self.assertFalse(connected)

    async def test_and_the_wrong_token_is_no_better(self):
        comm, connected = await self.device(token='not-the-secret')

        self.assertFalse(connected)

    async def test_a_device_naming_no_event_is_refused(self):
        comm, connected = await self.device(code='NOSUCH')

        self.assertFalse(connected)

    # -- what it sends ----------------------------------------------------

    async def test_a_final_line_is_kept(self):
        comm, _ = await self.device()

        await comm.send_json_to({
            'text': 'Sixty-nine districts passed.', 'is_final': True,
        })
        said = await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertEqual(said['type'], 'line_taken')
        self.assertTrue(said['stored'])
        self.assertEqual(await database_sync_to_async(self.lines)(),
                         ['Sixty-nine districts passed.'])

    async def test_an_interim_line_is_not(self):
        """Interim text is rewritten constantly; keeping it would fill the
        transcript with half-formed phrases."""
        comm, _ = await self.device()

        await comm.send_json_to({'text': 'Sixty-nine dist', 'is_final': False})
        said = await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertFalse(said['stored'])
        self.assertEqual(await database_sync_to_async(self.lines)(), [])

    async def test_the_devices_own_wording_is_understood(self):
        """It says event: partial | final, which is the same distinction."""
        comm, _ = await self.device()

        await comm.send_json_to({'event': 'final', 'text': 'We opened at nine.'})
        await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertEqual(await database_sync_to_async(self.lines)(),
                         ['We opened at nine.'])

    async def test_a_line_is_filed_against_whatever_is_on_stage(self):
        comm, _ = await self.device()

        await comm.send_json_to({'text': 'On the record.', 'is_final': True})
        await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        filed = await database_sync_to_async(
            lambda: TranscriptionSegment.objects.get(
                event=self.event
            ).session_id
        )()
        self.assertEqual(filed, self.session.id)

    # -- when it cannot be taken ------------------------------------------

    async def test_a_refusal_comes_back_with_a_reason(self):
        """A device cannot read a toast. Without this it would transcribe
        into silence all afternoon with nothing to say the lines were
        being dropped."""
        comm, _ = await self.device()

        await comm.send_json_to({'text': '   ', 'is_final': True})
        said = await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertEqual(said['type'], 'line_refused')
        self.assertIn('text is required', said['error'])

    async def test_nothing_is_taken_once_the_event_is_over(self):
        await database_sync_to_async(
            Event.objects.filter(id=self.event.id).update
        )(status=Event.Status.ENDED)
        comm, _ = await self.device()

        await comm.send_json_to({'text': 'Too late.', 'is_final': True})
        said = await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertEqual(said['type'], 'line_refused')
        self.assertEqual(await database_sync_to_async(self.lines)(), [])

    async def test_something_that_is_not_json_is_said_so(self):
        comm, _ = await self.device()

        await comm.send_to(text_data='not json at all')
        said = await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        self.assertEqual(said['type'], 'line_refused')

    # -- where it goes ----------------------------------------------------

    async def test_the_line_reaches_the_room_it_was_said_in(self):
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        await layer.group_add(f'event_{self.event.code}', 'a-watcher')

        comm, _ = await self.device()
        await comm.send_json_to({'text': 'Heard in the hall.', 'is_final': True})
        await comm.receive_json_from(timeout=2)
        await comm.disconnect()

        # Bounded: a channel nothing arrives on never answers, so an
        # unbounded receive turns a regression here into a hung suite
        # rather than a failing test.
        import asyncio

        heard = await asyncio.wait_for(layer.receive('a-watcher'), timeout=3)
        self.assertEqual(heard['type'], 'transcription_update')
        self.assertEqual(heard['segment']['text'], 'Heard in the hall.')


@override_settings(TRANSCRIPTION_INGEST_TOKEN=TOKEN)
class WhereALineGoesTests(TransactionTestCase):
    """One device speaks for one event, and reaches no other room.

    Asserted on the group the line is addressed to rather than by
    listening on another room's channel: an empty channel never answers,
    so proving a message did not arrive by waiting for it hangs.

    This is the whole reason the device socket is per-event. A single
    shared channel - the obvious way to build this - would put every
    hall's transcript on every other hall's screen.
    """

    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()

    def test_a_line_is_addressed_to_its_own_events_group(self):
        from unittest.mock import MagicMock, patch

        from src.apps.transcription.ingest import accept_line

        layer = MagicMock()
        with patch('channels.layers.get_channel_layer', return_value=layer):
            accept_line(self.event, {'text': 'Ours alone.', 'is_final': True})

        (group, message), _ = layer.group_send.call_args
        self.assertEqual(group, f'event_{self.event.code}')
        self.assertEqual(message['type'], 'transcription_update')
        self.assertEqual(message['segment']['text'], 'Ours alone.')

    def test_and_a_second_event_has_a_group_of_its_own(self):
        from unittest.mock import MagicMock, patch

        from src.apps.transcription.ingest import accept_line

        elsewhere = make_event(self.host, start=timezone.now())
        elsewhere.status = Event.Status.ACTIVE
        elsewhere.save(update_fields=['status'])

        layer = MagicMock()
        with patch('channels.layers.get_channel_layer', return_value=layer):
            accept_line(self.event, {'text': 'Ours.', 'is_final': True})
            accept_line(elsewhere, {'text': 'Theirs.', 'is_final': True})

        sent_to = [call.args[0] for call in layer.group_send.call_args_list]
        self.assertEqual(
            sent_to, [f'event_{self.event.code}', f'event_{elsewhere.code}']
        )
        self.assertNotEqual(sent_to[0], sent_to[1])
