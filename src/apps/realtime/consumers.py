"""WebSocket consumers for real-time meeting features"""
import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from src.apps.meetings.models import Meeting, MeetingParticipant, ChatMessage
from src.apps.transcription.models import TranscriptionSegment
from src.apps.monitoring.models import MeetingEvent

logger = logging.getLogger(__name__)

CHAT_MAX_LENGTH = 2000


class MeetingConsumer(AsyncWebsocketConsumer):
    """
    Handles real-time meeting state updates and participant communication
    """

    async def connect(self):
        self.meeting_code = self.scope['url_route']['kwargs']['meeting_code']
        self.room_group_name = f'meeting_{self.meeting_code}'
        self.user = self.scope['user']
        self.guest = self.scope.get('guest')

        # A guest connects on a signed guest token instead of an account. They
        # get their own group so the host's decision can reach them, but they
        # are not announced to the room until admitted.
        if self.guest and not self.user.is_authenticated:
            self.guest_group_name = (
                f'{self.room_group_name}_guest_{self.guest["id"]}'
            )
            await self.channel_layer.group_add(
                self.guest_group_name, self.channel_name
            )
            if self.guest['status'] == 'admitted':
                await self.channel_layer.group_add(
                    self.room_group_name, self.channel_name
                )
            await self.accept()
            logger.info(
                f"Guest {self.guest['name']} connected to {self.meeting_code} "
                f"({self.guest['status']})"
            )
            return

        if not self.user.is_authenticated:
            await self.close()
            return

        # A per-user group lets direct messages reach one person only.
        self.user_group_name = f'{self.room_group_name}_user_{self.user.id}'

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )
        await self.accept()

        # Notify others that user joined
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'participant_joined',
                'user_id': str(self.user.id),
                'user_name': self.user.display_name,
                'timestamp': self._get_timestamp()
            }
        )

        logger.info(f"User {self.user.email} connected to meeting {self.meeting_code}")

    async def disconnect(self, close_code):
        guest_group = getattr(self, 'guest_group_name', None)
        if guest_group:
            await self.channel_layer.group_discard(guest_group, self.channel_name)
            await self.channel_layer.group_discard(
                self.room_group_name, self.channel_name
            )
            return

        # A rejected connection never joined the group and has no real user.
        if not getattr(self, 'user', None) or not self.user.is_authenticated:
            return

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        if getattr(self, 'user_group_name', None):
            await self.channel_layer.group_discard(
                self.user_group_name,
                self.channel_name
            )

        # Notify others that user left
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'participant_left',
                'user_id': str(self.user.id),
                'user_name': self.user.display_name,
                'timestamp': self._get_timestamp()
            }
        )

        logger.info(f"User {self.user.email} disconnected from meeting {self.meeting_code}")

    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        if getattr(self, 'guest_group_name', None):
            # Guests may chat, but have no participant row to change state on.
            try:
                data = json.loads(text_data)
                if data.get('type') == 'chat_message':
                    await self.handle_chat_message(data)
            except json.JSONDecodeError:
                logger.error("Invalid JSON received from guest")
            except Exception as e:
                logger.error(f"Error handling guest message: {str(e)}")
            return
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'participant_state_update':
                await self.handle_participant_state_update(data)
            elif message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'transcription_segment':
                await self.handle_transcription_segment(data)
            else:
                logger.warning(f"Unknown message type: {message_type}")

        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
        except Exception as e:
            logger.error(f"Error handling message: {str(e)}")

    async def handle_participant_state_update(self, data):
        """Handle participant media state changes (mute, video, etc)"""
        updates = {
            'is_muted': data.get('is_muted'),
            'is_video_on': data.get('is_video_on'),
            'is_screen_sharing': data.get('is_screen_sharing')
        }
        updates = {k: v for k, v in updates.items() if v is not None}

        await self.update_participant_state(updates)

        # Broadcast to all participants
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'state_update',
                'user_id': str(self.user.id),
                'user_name': self.user.display_name,
                'state': updates,
                'timestamp': self._get_timestamp()
            }
        )

    @property
    def _identity(self):
        """Who this connection speaks as, guest or account holder."""
        if getattr(self, 'guest_group_name', None):
            return {
                'id': self.guest['id'],
                'name': self.guest['name'],
                'is_guest': True,
                'group': self.guest_group_name,
            }
        return {
            'id': str(self.user.id),
            'name': self.user.display_name,
            'is_guest': False,
            'group': self.user_group_name,
        }

    async def handle_chat_message(self, data):
        """Handle a room message or a direct message to one participant.

        Both are gated by host settings, checked server-side on every send so
        a client cannot bypass a closed room.
        """
        message = data.get('message', '').strip()
        if not message:
            return
        if len(message) > CHAT_MAX_LENGTH:
            await self._send_chat_error('Message is too long')
            return

        recipient_id = data.get('recipient_id') or None
        settings_ = await self.get_chat_settings()

        if not settings_['chat_enabled']:
            await self._send_chat_error('Chat room needs to be enabled by the host')
            return
        if recipient_id and not settings_['direct_messages_enabled']:
            await self._send_chat_error('Direct messages need to be enabled by the host')
            return

        me = self._identity
        saved = await self.save_chat_message(message, recipient_id)
        if saved is None:
            await self._send_chat_error('Could not send message')
            return

        payload = {
            'type': 'chat_message',
            'message_id': saved['id'],
            'user_id': me['id'],
            'user_name': me['name'],
            'sender_is_guest': me['is_guest'],
            'message': message,
            'recipient_id': saved['recipient_id'],
            'recipient_name': saved['recipient_name'],
            'recipient_is_guest': saved['recipient_is_guest'],
            'is_direct': saved['recipient_id'] is not None,
            'moderation_status': saved['moderation_status'],
            'timestamp': self._get_timestamp(),
        }

        if saved['moderation_status'] == ChatMessage.Moderation.PENDING:
            # Held for review: the host sees it, the sender sees it is waiting,
            # and the intended recipient sees nothing yet.
            await self.channel_layer.group_send(
                f'{self.room_group_name}_user_{saved["host_id"]}',
                {**payload, 'type': 'chat_pending'},
            )
            await self.channel_layer.group_send(me['group'], payload)
            return

        if saved['recipient_id']:
            await self.channel_layer.group_send(saved['recipient_group'], payload)
            if saved['recipient_group'] != me['group']:
                await self.channel_layer.group_send(me['group'], payload)
        else:
            await self.channel_layer.group_send(self.room_group_name, payload)

    async def _send_chat_error(self, reason):
        await self.send(text_data=json.dumps({
            'type': 'chat_error',
            'error': reason,
            'timestamp': self._get_timestamp(),
        }))

    async def handle_transcription_segment(self, data):
        """Handle transcription segment"""
        segment_data = {
            'meeting_code': self.meeting_code,
            'speaker_id': str(self.user.id),
            'speaker_name': self.user.display_name,
            'text': data.get('text', ''),
            'start_time': data.get('start_time', 0),
            'end_time': data.get('end_time', 0),
            'is_final': data.get('is_final', False),
            'confidence': data.get('confidence', 0.0),
            # The room may switch between Nepali and English mid-session.
            'language': data.get('language', 'en'),
        }

        if not segment_data['text'].strip():
            return

        await self.save_transcription_segment(segment_data)

        # Broadcast to all
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'transcription_update',
                'segment': segment_data,
                'timestamp': self._get_timestamp()
            }
        )

    # Group message handlers (called by other consumers)

    async def participant_joined(self, event):
        """Broadcast when participant joins"""
        await self.send(text_data=json.dumps({
            'type': 'participant_joined',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'timestamp': event['timestamp']
        }))

    async def participant_left(self, event):
        """Broadcast when participant leaves"""
        await self.send(text_data=json.dumps({
            'type': 'participant_left',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'timestamp': event['timestamp']
        }))

    async def roster_update(self, event):
        """Somebody came in or stepped out of the room."""
        await self.send(text_data=json.dumps({
            'type': 'roster_update',
            'active_count': event.get('active_count'),
        }))

    async def resources_update(self, event):
        """A file arrived, or who may read one changed."""
        await self.send(text_data=json.dumps({'type': 'resources_update'}))

    async def attendance_update(self, event):
        """The attendance record moved."""
        await self.send(text_data=json.dumps({'type': 'attendance_update'}))

    async def state_update(self, event):
        """Broadcast participant state update"""
        await self.send(text_data=json.dumps({
            'type': 'state_update',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'state': event['state'],
            'timestamp': event['timestamp']
        }))

    async def chat_message(self, event):
        """Broadcast chat message"""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message_id': event.get('message_id'),
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'sender_is_guest': event.get('sender_is_guest', False),
            'message': event['message'],
            'recipient_id': event.get('recipient_id'),
            'recipient_name': event.get('recipient_name'),
            'recipient_is_guest': event.get('recipient_is_guest', False),
            'is_direct': event.get('is_direct', False),
            'moderation_status': event.get('moderation_status'),
            'timestamp': event['timestamp']
        }))

    async def chat_pending(self, event):
        """Tell the host a message is waiting for review"""
        await self.send(text_data=json.dumps({
            'type': 'chat_pending',
            'message_id': event.get('message_id'),
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'sender_is_guest': event.get('sender_is_guest', False),
            'message': event['message'],
            'recipient_id': event.get('recipient_id'),
            'recipient_name': event.get('recipient_name'),
            'timestamp': event['timestamp'],
        }))

    async def chat_moderated(self, event):
        """Tell a client the outcome of a host review"""
        await self.send(text_data=json.dumps({
            'type': 'chat_moderated',
            'message_id': event.get('message_id'),
            'moderation_status': event.get('moderation_status'),
            'recipient_name': event.get('recipient_name'),
        }))

    async def guest_waiting(self, event):
        """Tell the host a guest is asking to be let in"""
        await self.send(text_data=json.dumps({
            'type': 'guest_waiting',
            'guest_id': event['guest_id'],
            'full_name': event['full_name'],
            'phone': event['phone'],
            'created_at': event['created_at'],
        }))

    async def guest_decision(self, event):
        """Tell a waiting guest whether they were let in"""
        await self.send(text_data=json.dumps({
            'type': 'guest_decision',
            'status': event['status'],
        }))

    async def meeting_started(self, event):
        """Broadcast the authoritative start time"""
        await self.send(text_data=json.dumps({
            'type': 'meeting_started',
            'started_at': event['started_at'],
            'status': event.get('status'),
        }))

    async def meeting_ended(self, event):
        """Tell everyone the meeting is over, then hang up.

        Closing the socket here means the room really is shut for everybody at
        the same moment, rather than relying on each client to disconnect.
        """
        await self.send(text_data=json.dumps({
            'type': 'meeting_ended',
            'reason': event.get('reason'),
            'ended_at': event.get('ended_at'),
        }))
        await self.close(code=4000)

    async def chat_settings_update(self, event):
        """Tell clients the host opened or closed the chat room"""
        await self.send(text_data=json.dumps({
            'type': 'chat_settings_update',
            'chat_enabled': event.get('chat_enabled', False),
            'direct_messages_enabled': event.get('direct_messages_enabled', False),
        }))

    async def transcription_update(self, event):
        """Broadcast transcription segment"""
        await self.send(text_data=json.dumps({
            'type': 'transcription_update',
            'segment': event['segment'],
            'timestamp': event['timestamp']
        }))

    # Database operations (sync_to_async)

    @database_sync_to_async
    def get_chat_settings(self):
        """Current host-controlled chat settings for this meeting."""
        try:
            meeting = Meeting.objects.only(
                'chat_enabled', 'direct_messages_enabled'
            ).get(meeting_code=self.meeting_code)
        except Meeting.DoesNotExist:
            return {'chat_enabled': False, 'direct_messages_enabled': False}

        return {
            'chat_enabled': meeting.chat_enabled,
            'direct_messages_enabled': meeting.direct_messages_enabled,
        }

    @database_sync_to_async
    def save_chat_message(self, body, recipient_id=None):
        """Persist a message and decide whether the host must review it.

        Sender and recipient may each be an account holder or a guest. A
        direct message from an attendee or guest to anyone other than the host
        is held pending so the host can approve, decline or remove it.
        """
        from src.apps.meetings.models import GuestAttendee

        try:
            meeting = Meeting.objects.select_related('host').get(
                meeting_code=self.meeting_code
            )
        except Meeting.DoesNotExist:
            return None

        is_guest_sender = bool(getattr(self, 'guest_group_name', None))
        room = self.room_group_name

        recipient_user = None
        recipient_guest = None
        recipient_group = None
        recipient_name = None

        if recipient_id:
            participant = MeetingParticipant.objects.select_related('user').filter(
                meeting=meeting, user_id=recipient_id, is_active=True
            ).first()
            if participant:
                recipient_user = participant.user
                recipient_group = f'{room}_user_{recipient_user.id}'
                recipient_name = recipient_user.display_name or recipient_user.email
            else:
                guest = GuestAttendee.objects.filter(
                    meeting=meeting,
                    id=recipient_id,
                    status=GuestAttendee.Status.ADMITTED,
                ).first()
                if guest is None:
                    logger.warning(
                        f"Direct message to unknown recipient {recipient_id} "
                        f"in {self.meeting_code}"
                    )
                    return None
                recipient_guest = guest
                recipient_group = f'{room}_guest_{guest.id}'
                recipient_name = guest.full_name

        moderation = ChatMessage.Moderation.NOT_REQUIRED
        if recipient_id:
            if is_guest_sender:
                # A guest has no role; treat them as an attendee.
                sender_is_attendee = True
            else:
                sender_role = MeetingParticipant.objects.filter(
                    meeting=meeting, user=self.user
                ).values_list('role', flat=True).first()
                sender_is_attendee = sender_role == MeetingParticipant.Role.ATTENDEE

            recipient_is_host = (
                recipient_user is not None
                and str(recipient_user.id) == str(meeting.host_id)
            )
            if sender_is_attendee and not recipient_is_host:
                moderation = ChatMessage.Moderation.PENDING

        message = ChatMessage.objects.create(
            meeting=meeting,
            sender=None if is_guest_sender else self.user,
            guest_sender_id=self.guest['id'] if is_guest_sender else None,
            recipient=recipient_user,
            guest_recipient=recipient_guest,
            body=body,
            moderation_status=moderation,
        )
        return {
            'id': str(message.id),
            'recipient_id': str(recipient_id) if recipient_id else None,
            'recipient_name': recipient_name,
            'recipient_is_guest': recipient_guest is not None,
            'recipient_group': recipient_group,
            'moderation_status': moderation,
            'host_id': str(meeting.host_id),
        }

    @database_sync_to_async
    def update_participant_state(self, updates):
        """Update participant state in database"""
        try:
            meeting = Meeting.objects.get(meeting_code=self.meeting_code)
            participant = MeetingParticipant.objects.get(
                meeting=meeting,
                user=self.user,
                is_active=True
            )

            for key, value in updates.items():
                setattr(participant, key, value)

            participant.save()

            # Log event
            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.PARTICIPANT_MUTED if updates.get('is_muted') else None,
                description=f"Participant state updated: {updates}",
                user=str(self.user.id),
                data=updates
            )

        except Exception as e:
            logger.error(f"Failed to update participant state: {str(e)}")

    @database_sync_to_async
    def save_transcription_segment(self, segment_data):
        """Save transcription segment to database"""
        try:
            meeting = Meeting.objects.get(meeting_code=self.meeting_code)

            TranscriptionSegment.objects.create(
                meeting=meeting,
                speaker_id=segment_data['speaker_id'],
                speaker_name=segment_data['speaker_name'],
                text=segment_data['text'],
                start_time=segment_data['start_time'],
                end_time=segment_data['end_time'],
                is_final=segment_data['is_final'],
                confidence=segment_data['confidence'],
                language=segment_data.get('language', 'en'),
            )

        except Exception as e:
            logger.error(f"Failed to save transcription segment: {str(e)}")

    @staticmethod
    def _get_timestamp():
        from django.utils import timezone
        return timezone.now().isoformat()


class SignalingConsumer(AsyncWebsocketConsumer):
    """WebRTC signalling: peer discovery plus SDP/ICE relay.

    Relaying offers and answers is not enough on its own - a client that has
    just arrived has no idea who else is present, so nobody ever starts a
    negotiation. This consumer keeps a roster of connected peers in the shared
    cache, hands it to each newcomer, and announces arrivals and departures.

    Peers are identified by user id, or by guest id for people who joined by
    code and have no account.
    """

    PRESENCE_TTL = 60 * 60 * 12

    @property
    def _roster_key(self):
        return f'signaling_peers_{self.meeting_code}'

    async def connect(self):
        self.meeting_code = self.scope['url_route']['kwargs']['meeting_code']
        self.room_group_name = f'signaling_{self.meeting_code}'
        self.user = self.scope['user']
        self.guest = self.scope.get('guest')

        if self.guest and self.guest.get('status') == 'admitted':
            self.peer_id = self.guest['id']
            self.peer_name = self.guest['name']
            self.is_guest_peer = True
        elif getattr(self.user, 'is_authenticated', False):
            self.peer_id = str(self.user.id)
            self.peer_name = self.user.display_name or self.user.email
            self.is_guest_peer = False
        else:
            await self.close()
            return

        await self.channel_layer.group_add(
            self.room_group_name, self.channel_name
        )
        await self.accept()

        # Tell the newcomer who is already here, then tell the room about them.
        existing = await self._roster_add()
        await self.send(text_data=json.dumps({
            'type': 'peers',
            'self_id': self.peer_id,
            'peers': existing,
        }))
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'peer_joined',
                'peer_id': self.peer_id,
                'name': self.peer_name,
                'is_guest': self.is_guest_peer,
            },
        )

        logger.info(
            f"{self.peer_name} connected to signalling for {self.meeting_code}"
        )

    async def disconnect(self, close_code):
        if not getattr(self, 'peer_id', None):
            return

        await self._roster_remove()
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'peer_left', 'peer_id': self.peer_id},
        )
        await self.channel_layer.group_discard(
            self.room_group_name, self.channel_name
        )

    @database_sync_to_async
    def _roster_add(self):
        """Register this peer and return everyone who was already present."""
        from django.core.cache import cache

        roster = cache.get(self._roster_key) or {}
        existing = [
            {'peer_id': pid, **info}
            for pid, info in roster.items()
            if pid != self.peer_id
        ]
        roster[self.peer_id] = {
            'name': self.peer_name,
            'is_guest': self.is_guest_peer,
        }
        cache.set(self._roster_key, roster, self.PRESENCE_TTL)
        return existing

    @database_sync_to_async
    def _roster_remove(self):
        from django.core.cache import cache

        roster = cache.get(self._roster_key) or {}
        roster.pop(self.peer_id, None)
        if roster:
            cache.set(self._roster_key, roster, self.PRESENCE_TTL)
        else:
            cache.delete(self._roster_key)

    async def receive(self, text_data):
        """Handle WebRTC signaling messages"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'offer':
                await self.handle_offer(data)
            elif message_type == 'answer':
                await self.handle_answer(data)
            elif message_type == 'ice_candidate':
                await self.handle_ice_candidate(data)
            else:
                logger.warning(f"Unknown signaling message type: {message_type}")

        except Exception as e:
            logger.error(f"Error handling signaling: {str(e)}")

    async def handle_offer(self, data):
        """Relay a WebRTC offer to one peer"""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'webrtc_offer',
                'from_user_id': self.peer_id,
                'from_name': self.peer_name,
                'to_user_id': data.get('to_user_id'),
                'offer': data.get('offer'),
            }
        )

    async def handle_answer(self, data):
        """Relay a WebRTC answer to one peer"""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'webrtc_answer',
                'from_user_id': self.peer_id,
                'to_user_id': data.get('to_user_id'),
                'answer': data.get('answer'),
            }
        )

    async def handle_ice_candidate(self, data):
        """Relay an ICE candidate to one peer"""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'ice_candidate',
                'from_user_id': self.peer_id,
                'to_user_id': data.get('to_user_id'),
                'candidate': data.get('candidate'),
            }
        )

    # Group message handlers

    async def peer_joined(self, event):
        """Announce a peer that just arrived"""
        if event['peer_id'] == self.peer_id:
            return
        await self.send(text_data=json.dumps({
            'type': 'peer_joined',
            'peer_id': event['peer_id'],
            'name': event.get('name'),
            'is_guest': event.get('is_guest', False),
        }))

    async def peer_left(self, event):
        """Announce a peer that disconnected"""
        if event['peer_id'] == self.peer_id:
            return
        await self.send(text_data=json.dumps({
            'type': 'peer_left',
            'peer_id': event['peer_id'],
        }))

    async def webrtc_offer(self, event):
        """Forward WebRTC offer"""
        if event['to_user_id'] == self.peer_id:
            await self.send(text_data=json.dumps({
                'type': 'offer',
                'from_user_id': event['from_user_id'],
                'from_name': event.get('from_name'),
                'offer': event['offer']
            }))

    async def webrtc_answer(self, event):
        """Forward WebRTC answer"""
        if event['to_user_id'] == self.peer_id:
            await self.send(text_data=json.dumps({
                'type': 'answer',
                'from_user_id': event['from_user_id'],
                'answer': event['answer']
            }))

    async def ice_candidate(self, event):
        """Forward ICE candidate"""
        if event['to_user_id'] == self.peer_id:
            await self.send(text_data=json.dumps({
                'type': 'ice_candidate',
                'from_user_id': event['from_user_id'],
                'candidate': event['candidate']
            }))
