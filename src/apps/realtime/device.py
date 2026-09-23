"""The hall's capture device, holding a socket open.

The device listens in the room, turns speech into text itself, and sends
only the text. It can do that a line at a time over HTTP, which is what
``transcription.ingest`` is for - but a device transcribing continuously
is opening a connection per phrase to do it, and interim lines arrive
several times a second. So it may instead hold one socket open and
stream them.

What arrives is the same line either way, and it goes through the same
rule: stored if final, broadcast either way, filed against whatever is
on stage. Two copies of that rule would drift, and the difference would
be which lines got kept.

A device is not a person. It authenticates with the shared ingest token
rather than a user session, and it speaks for exactly one event - the
one in the URL. There is no room-wide channel it could reach: a line
sent here goes to that event's group and nowhere else.
"""
import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class DeviceConsumer(AsyncWebsocketConsumer):
    """One capture device, streaming transcript lines for one event."""

    async def connect(self):
        self.code = self.scope['url_route']['kwargs']['code']

        presented = self._presented_token()
        if not await self._may_speak(presented):
            # Refused before accepting, so an unauthorised device never
            # holds a connection at all.
            await self.close(code=4401)
            return

        self.event_id = await self._event_id()
        if self.event_id is None:
            await self.close(code=4404)
            return

        await self.accept()
        logger.info(f"Capture device connected for {self.code}")

    async def disconnect(self, close_code):
        logger.info(f"Capture device left {self.code}")

    async def receive(self, text_data=None, bytes_data=None):
        """Take one line, or say why it was not taken.

        The device is a machine and cannot read a toast, so a refusal
        comes back on the socket with a reason on it - otherwise a
        misconfigured device transcribes into silence all afternoon with
        nothing anywhere to say the lines were being dropped.
        """
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self._refuse('That was not JSON')
            return

        # The device's own shape: {"event": "partial"|"final", ...}. Its
        # own word for what a line is stands in for is_final, so a device
        # already written against that wording needs no changes.
        if 'is_final' not in data and 'event' in data:
            data['is_final'] = data.get('event') == 'final'

        try:
            segment = await self._take(data)
        except Exception as e:
            await self._refuse(str(e))
            return

        await self.send(text_data=json.dumps({
            'type': 'line_taken',
            'stored': segment['is_final'],
        }))

    # -- the parts that touch the database --------------------------------

    def _presented_token(self) -> str:
        """The token, from the header or the query string.

        A browser cannot set headers on a WebSocket, and neither can every
        device library, so the query string is accepted as well. It is the
        same token either way.
        """
        for name, value in self.scope.get('headers', []):
            if name == b'authorization':
                said = value.decode()
                if said.startswith('Bearer '):
                    return said[7:]
                return said

        from urllib.parse import parse_qs

        query = parse_qs(self.scope.get('query_string', b'').decode())
        return (query.get('token') or [''])[0]

    @database_sync_to_async
    def _may_speak(self, presented: str) -> bool:
        from src.apps.transcription.ingest import token_matches

        return token_matches(presented)

    @database_sync_to_async
    def _event_id(self):
        from src.apps.transcription.ingest import find_event

        event = find_event(self.code)
        return str(event.id) if event else None

    @database_sync_to_async
    def _take(self, data: dict) -> dict:
        from src.apps.meetings.models import Event
        from src.apps.transcription.ingest import accept_line

        event = Event.objects.get(id=self.event_id)
        return accept_line(event, data)

    async def _refuse(self, why: str) -> None:
        await self.send(text_data=json.dumps({
            'type': 'line_refused',
            'error': why,
        }))
