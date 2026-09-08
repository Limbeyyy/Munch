import logging

from django.core.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, permission_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db import models
from drf_yasg.utils import swagger_auto_schema
from drf_yasg import openapi
from src.apps.meetings.models import (
    Meeting, MeetingParticipant, ChatMessage, GuestAttendee, MeetingInvite
)
from src.apps.meetings.serializers import (
    MeetingSerializer, MeetingCreateSerializer, 
    MeetingJoinSerializer, ParticipantSerializer,
    ChatMessageSerializer, ChatSettingsSerializer,
    GuestAttendeeSerializer, MeetingInviteSerializer, InviteCreateSerializer
)
from src.apps.meetings.services.meeting_service import MeetingService
from src.apps.monitoring.models import MeetingEvent
from src.apps.meetings.permissions import IsMeetingHost, IsMeetingParticipant
from src.apps.artifacts.services.artifact_service import MeetingArtifactService
from src.utilities.decorators import rate_limit
from src.utilities.exceptions import MeetingException, PermissionDeniedException

logger = logging.getLogger(__name__)

MAX_RESOURCE_UPLOAD_BYTES = 25 * 1024 * 1024


def deliver_moderated_message(meeting, message, decision):
    """Push the outcome of a host review to the people who need it.

    Approved messages are delivered to the recipient as a normal chat message;
    the sender is always told what happened to theirs.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return

        room = f'meeting_{meeting.meeting_code}'
        sender_group = (
            f'{room}_guest_{message.guest_sender_id}'
            if message.guest_sender_id
            else f'{room}_user_{message.sender_id}'
        )
        sender_name = message.sender_label
        recipient_name = message.recipient_label

        recipient_group = (
            f'{room}_guest_{message.guest_recipient_id}'
            if message.guest_recipient_id
            else f'{room}_user_{message.recipient_id}'
            if message.recipient_id else None
        )

        if decision == 'approve' and recipient_group:
            async_to_sync(layer.group_send)(
                recipient_group,
                {
                    'type': 'chat_message',
                    'message_id': str(message.id),
                    'user_id': str(message.guest_sender_id or message.sender_id),
                    'user_name': sender_name,
                    'sender_is_guest': message.guest_sender_id is not None,
                    'message': message.body,
                    'recipient_id': str(
                        message.guest_recipient_id or message.recipient_id
                    ),
                    'recipient_name': recipient_name,
                    'is_direct': True,
                    'moderation_status': message.moderation_status,
                    'timestamp': message.created_at.isoformat(),
                },
            )

        if decision != 'remove':
            async_to_sync(layer.group_send)(
                sender_group,
                {
                    'type': 'chat_moderated',
                    'message_id': str(message.id),
                    'moderation_status': message.moderation_status,
                    'recipient_name': recipient_name,
                },
            )
    except Exception as e:
        logger.warning(
            f"Could not deliver moderation outcome for {message.id}: {e}"
        )


# Defined with the rest of the lifecycle rules and re-exported here, which
# is where the callers already look for it.
from src.apps.meetings.lifecycle import broadcast_meeting_ended  # noqa: E402


def broadcast_meeting_started(meeting):
    """Tell everyone in the room when the clock started."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{meeting.meeting_code}',
            {
                'type': 'meeting_started',
                'started_at': meeting.started_at.isoformat(),
                'status': meeting.status,
            },
        )
    except Exception as e:
        logger.warning(
            f"Could not broadcast start of {meeting.meeting_code}: {e}"
        )


def broadcast_chat_settings(meeting_code, payload):
    """Push new chat settings to everyone currently in the room.

    Best-effort: a channel layer problem must not fail the HTTP request that
    already persisted the change.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            f'meeting_{meeting_code}',
            {'type': 'chat_settings_update', **payload},
        )
    except Exception as e:
        logger.warning(f"Could not broadcast chat settings for {meeting_code}: {e}")

def _push(meeting_code, payload, what):
    """Tell everyone in the room something changed. Best effort.

    A channel layer problem must not fail the request that already made
    the change stick.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(f'meeting_{meeting_code}', payload)
    except Exception as e:
        logger.warning(f"Could not broadcast {what} for {meeting_code}: {e}")


def broadcast_roster_changed(meeting):
    """Somebody came in or stepped out.

    Sent rather than leaving every client to poll: a participant list that
    only changes when you reload is not a list of who is in the room.
    """
    _push(
        meeting.meeting_code,
        {
            'type': 'roster_update',
            'active_count': meeting.participants.filter(is_active=True).count(),
        },
        'roster',
    )


def broadcast_resources_changed(meeting):
    """A file arrived, or who may read one changed."""
    _push(meeting.meeting_code, {'type': 'resources_update'}, 'resources')


def broadcast_attendance_changed(meeting):
    """The attendance record moved."""
    _push(meeting.meeting_code, {'type': 'attendance_update'}, 'attendance')


class MeetingViewSet(viewsets.ModelViewSet):
    """
    ViewSet for meeting operations
    """
    queryset = Meeting.objects.all()
    serializer_class = MeetingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Return meetings the user has access to.

        Joining is how a user gains access in the first place, so that action
        must be able to find a meeting the user is not yet part of.
        """
        if self.action == 'join':
            return Meeting.objects.all()

        from src.apps.meetings.access import meetings_visible_to

        return (
            Meeting.objects.filter(meetings_visible_to(self.request.user))
            .distinct()
            .order_by('-scheduled_start')
        )

    #: Reading a meeting you hold the code for. A code is handed out to be
    #: used - it is how somebody is told the meeting exists at all - so
    #: presenting one is enough to look the meeting up and walk in. Writing
    #: to it still needs the ordinary membership.
    CODE_IS_ENOUGH = {'retrieve', 'join'}

    def get_object(self):
        """Find the meeting by its code, or failing that by its id."""
        queryset = self.get_queryset()
        lookup_value = self.kwargs.get('pk')

        obj = None
        if lookup_value:
            try:
                obj = queryset.get(meeting_code=lookup_value)
            except Meeting.DoesNotExist:
                obj = None

            # Somebody who was given the code but has not joined yet is in
            # none of the lists the visibility filter checks, so the filter
            # would turn them away from the very meeting they were invited
            # to by code. The code itself is the credential here.
            if obj is None and self.action in self.CODE_IS_ENOUGH:
                obj = Meeting.objects.filter(meeting_code=lookup_value).first()

        if obj is None:
            # Fall back to default pk lookup
            obj = super().get_object()

        return self._auto_end_if_expired(obj)

    @staticmethod
    def _auto_end_if_expired(meeting):
        """Close a meeting once its running order is done.

        Checked whenever the meeting is touched, so it does not depend on a
        background worker being alive.

        The window running out is not enough on its own. A meeting is its
        sessions, and while one of them could still be put on stage the
        meeting has not finished - saying otherwise shut the door on a
        session the host was about to start.
        """
        from src.apps.meetings.lifecycle import has_more_to_run

        if (
            meeting.status != Meeting.Status.ENDED
            and meeting.scheduled_end
            and timezone.now() >= meeting.scheduled_end
            and not has_more_to_run(meeting)
        ):
            logger.info(
                f"Meeting {meeting.meeting_code} reached its scheduled end"
            )
            meeting = MeetingService.end_meeting(meeting.id)
            broadcast_meeting_ended(meeting, reason='time_elapsed')
        return meeting
    
    @swagger_auto_schema(
        request_body=MeetingCreateSerializer,
        responses={201: MeetingSerializer()}
    )
    def create(self, request, *args, **kwargs):
        """Create a new meeting"""
        serializer = MeetingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        try:
            meeting_service = MeetingService()
            meeting = meeting_service.create_meeting(
                host_id=request.user.id,
                title=serializer.validated_data['title'],
                scheduled_start=serializer.validated_data['scheduled_start'],
                scheduled_end=serializer.validated_data['scheduled_end'],
                description=serializer.validated_data.get('description', ''),
                max_participants=serializer.validated_data.get('max_participants', 100)
            )
            
            # Initialize Google Drive folder for the meeting. Drive is optional:
            # the meeting is usable without it, so don't fail creation here.
            drive_warning = None
            try:
                artifact_service = MeetingArtifactService(meeting.id, request.user.id)
                artifact_service.initialize_meeting_folder()
            except Exception as e:
                drive_warning = str(e)
                logger.warning(
                    f"Drive folder init failed for meeting {meeting.meeting_code}: {e}"
                )

            response_serializer = MeetingSerializer(meeting)
            data = dict(response_serializer.data)
            if drive_warning:
                data['drive_warning'] = drive_warning
            return Response(data, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'])
    @rate_limit(requests=10, period=60)  # 10 requests per minute
    def join(self, request, pk=None):
        """Join a meeting"""
        meeting = self.get_object()

        # The room opens a quarter of an hour before its hour, for everyone
        # on the same terms - the host included. Nobody has to be here
        # first, and being late is never the problem.
        from src.apps.meetings.entry import is_open, too_early_response

        if not is_open(meeting):
            return too_early_response(meeting)

        serializer = MeetingJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        try:
            meeting_service = MeetingService()
            participant = meeting_service.join_meeting(
                meeting=meeting,
                user=request.user,
                role=serializer.validated_data.get('role', MeetingParticipant.Role.ATTENDEE)
            )
            
            # Somebody arriving on an invitation has now accepted it, which
            # is what makes the expected headcount mean anything.
            meeting.invites.filter(
                email__iexact=request.user.email, joined_at__isnull=True
            ).update(joined_at=participant.joined_at, joined_user=request.user)

            # Record attendance to Drive. Optional: joining must not fail if
            # Drive is unavailable.
            try:
                artifact_service = MeetingArtifactService(meeting.id, request.user.id)
                artifact_service.record_attendance({
                    'name': request.user.display_name,
                    'email': request.user.email,
                    'role': participant.role,
                    'join_time': timezone.now().isoformat()
                })
            except Exception as e:
                logger.warning(
                    f"Attendance recording failed for meeting {meeting.meeting_code}: {e}"
                )


            broadcast_roster_changed(meeting)

            # Get meeting state for WebSocket connection
            meeting_state = meeting_service.get_meeting_state(meeting.id)
            
            return Response({
                'meeting': MeetingSerializer(meeting).data,
                'participant': ParticipantSerializer(participant).data,
                'state': meeting_state,
                'websocket_url': f"/ws/meeting/{meeting.meeting_code}/"
            })
            
        except PermissionDeniedException as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_403_FORBIDDEN
            )
        except MeetingException as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """Start the meeting clock. Host only, and only ever once.

        ``started_at`` is the single source of truth for elapsed time: every
        client renders from it, so the count is identical for everyone and
        survives the host - or everyone - leaving and coming back.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host can start the meeting'},
                status=status.HTTP_403_FORBIDDEN
            )

        if meeting.status == Meeting.Status.ENDED:
            return Response(
                {'error': 'This meeting has already ended'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Gathering early is one thing; declaring the meeting begun before
        # its own hour is another. The room is already open for whoever
        # turned up - this is only about calling it started.
        from src.apps.meetings.entry import can_start, opens_at

        if not can_start(meeting):
            return Response(
                {
                    'error': (
                        f'This meeting starts at '
                        f'{timezone.localtime(meeting.scheduled_start):%H:%M}. '
                        'You can gather in the room until then.'
                    ),
                    'code': 'not_yet',
                    'scheduled_start': meeting.scheduled_start.isoformat(),
                    'opens_at': opens_at(meeting).isoformat(),
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Rejoining must not restart the clock, but opening a meeting today
        # that was last opened yesterday is a new run, not a rejoin. The
        # thing that tells them apart is whether it is running now - not
        # whether it has ever run, which stays true for ever and left the
        # counter measuring from a sitting that finished a day ago.
        if meeting.status != Meeting.Status.ACTIVE:
            meeting.started_at = timezone.now()
            meeting.ended_at = None
            meeting.status = Meeting.Status.ACTIVE
            meeting.save(
                update_fields=['started_at', 'ended_at', 'status', 'updated_at']
            )

            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.MEETING_STARTED,
                description=f"Meeting started by {request.user.email}",
                user=str(request.user.id),
            )
            broadcast_meeting_started(meeting)
            logger.info(f"Meeting {meeting.meeting_code} started")

        return Response(MeetingSerializer(meeting).data)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        """End the meeting for everyone. Host only.

        Everyone else leaves via ``leave``; the meeting keeps running without
        them until the host ends it or its scheduled time runs out.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host can end the meeting. You can leave instead.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if meeting.status == Meeting.Status.ENDED:
            return Response({
                'message': 'Meeting already ended',
                'meeting': MeetingSerializer(meeting).data
            })

        try:
            meeting = MeetingService.end_meeting(meeting.id)
            broadcast_meeting_ended(meeting, reason='host_ended')

            return Response({
                'message': 'Meeting ended successfully',
                'meeting': MeetingSerializer(meeting).data
            })

        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        """Leave the meeting without ending it for anyone else."""
        meeting = self.get_object()

        participant = meeting.participants.filter(user=request.user).first()
        if participant is None:
            return Response(
                {'error': 'You are not in this meeting'},
                status=status.HTTP_404_NOT_FOUND
            )

        participant.is_active = False
        participant.left_at = timezone.now()
        participant.save(update_fields=['is_active', 'left_at'])

        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.PARTICIPANT_LEFT,
            description=f"{request.user.email} left the meeting",
            user=str(request.user.id),
        )

        broadcast_roster_changed(meeting)
        return Response({'message': 'You left the meeting'})

    @action(detail=True, methods=['get'])
    def participants(self, request, pk=None):
        """Everyone currently in the meeting - account holders and guests.

        Guests have no participant row, so they are projected into the same
        shape with ``is_guest`` set; otherwise the headcount would not match
        what people can actually see in the room.
        """
        meeting = self.get_object()

        people = [
            {**ParticipantSerializer(p).data, 'is_guest': False}
            for p in meeting.participants.filter(is_active=True).select_related('user')
        ]

        for g in meeting.guests.filter(status=GuestAttendee.Status.ADMITTED):
            people.append({
                'id': str(g.id),
                'user': {
                    'id': str(g.id),
                    'email': g.full_name,
                    'first_name': g.full_name,
                    'last_name': '',
                },
                'role': 'guest',
                'is_active': True,
                'is_muted': False,
                'is_video_on': False,
                'is_screen_sharing': False,
                'joined_at': (g.decided_at or g.created_at),
                'left_at': None,
                'session_id': None,
                'participant_metadata': {'phone': g.phone},
                'is_guest': True,
            })

        return Response(people)

    @action(detail=True, methods=['get', 'patch'], url_path='chat_settings')
    def chat_settings(self, request, pk=None):
        """Read the chat settings, or change them (host only)."""
        meeting = self.get_object()

        if request.method == 'GET':
            return Response({
                'chat_enabled': meeting.chat_enabled,
                'direct_messages_enabled': meeting.direct_messages_enabled,
            })

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host can change chat settings'},
                status=status.HTTP_403_FORBIDDEN
            )

        serializer = ChatSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        for field, value in serializer.validated_data.items():
            setattr(meeting, field, value)

        # Direct messages live inside the room; closing the room closes them.
        if not meeting.chat_enabled:
            meeting.direct_messages_enabled = False

        meeting.save(update_fields=['chat_enabled', 'direct_messages_enabled', 'updated_at'])

        settings_payload = {
            'chat_enabled': meeting.chat_enabled,
            'direct_messages_enabled': meeting.direct_messages_enabled,
        }
        broadcast_chat_settings(meeting.meeting_code, settings_payload)
        return Response(settings_payload)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Chat history visible to the requesting user.

        Public room messages, plus direct messages they sent or received.
        """
        meeting = self.get_object()

        if not meeting.chat_enabled:
            return Response(
                {'error': 'Chat room needs to be enabled by the host'},
                status=status.HTTP_403_FORBIDDEN
            )

        deliverable = models.Q(moderation_status__in=[
            ChatMessage.Moderation.NOT_REQUIRED,
            ChatMessage.Moderation.APPROVED,
        ])

        # You always see your own messages, including ones still pending, so
        # you know they are waiting. Recipients only see delivered messages.
        visible = (
            # Truly public: addressed to neither a user nor a guest.
            (models.Q(recipient__isnull=True, guest_recipient__isnull=True)
             & deliverable) |
            models.Q(sender=request.user) |
            (models.Q(recipient=request.user) & deliverable)
        )

        qs = ChatMessage.objects.filter(meeting=meeting).filter(
            visible
        ).exclude(
            # A removed message is gone for everyone, sender included.
            moderation_status=ChatMessage.Moderation.REMOVED
        ).select_related(
            'sender', 'recipient', 'guest_sender', 'guest_recipient'
        ).order_by('created_at')

        return Response(ChatMessageSerializer(qs[:500], many=True).data)

    @action(detail=True, methods=['get', 'post'], url_path='invites')
    def invites(self, request, pk=None):
        """The addresses the meeting link was shared with. Host only.

        Each invite counts toward the expected headcount.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host manages invitations'},
                status=status.HTTP_403_FORBIDDEN
            )

        if request.method == 'GET':
            return Response(
                MeetingInviteSerializer(meeting.invites.all(), many=True).data
            )

        serializer = InviteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        created, already = [], []
        for email in serializer.validated_data['emails']:
            invite, was_created = MeetingInvite.objects.get_or_create(
                meeting=meeting,
                email=email,
                defaults={'invited_by': request.user},
            )
            (created if was_created else already).append(invite)

        # Someone invited after they already joined still counts as attended.
        for invite in created:
            participant = meeting.participants.filter(
                user__email__iexact=invite.email
            ).select_related('user').first()
            if participant:
                invite.joined_at = participant.joined_at
                invite.joined_user = participant.user
                invite.save(update_fields=['joined_at', 'joined_user'])

        return Response(
            {
                'added': MeetingInviteSerializer(created, many=True).data,
                'already_invited': MeetingInviteSerializer(already, many=True).data,
                'total_invited': meeting.invites.count(),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'], url_path='attendance')
    def attendance(self, request, pk=None):
        """Who was expected, who actually came, and who never showed up.

        Attending means having entered the meeting at least once, so people
        who have since left still count - flagged inactive rather than
        dropped. Guests count from the moment the host admitted them.
        """
        meeting = self.get_object()

        invites = list(meeting.invites.select_related('joined_user'))

        # Every participant row exists because that person entered the room.
        participants = list(
            meeting.participants.select_related('user').order_by('joined_at')
        )

        # Admitted guests attended; guests who then left still attended.
        # Pending and denied guests never entered, so they are excluded.
        guests = list(
            meeting.guests.filter(
                status__in=[
                    GuestAttendee.Status.ADMITTED,
                    GuestAttendee.Status.LEFT,
                ]
            ).order_by('created_at')
        )

        invited_emails = {i.email.lower() for i in invites}

        attended_users = [
            {
                'type': 'user',
                'name': p.user.display_name or p.user.email,
                'email': p.user.email,
                'phone': None,
                'role': p.role,
                'joined_at': p.joined_at,
                'left_at': p.left_at,
                'is_active': p.is_active,
                'was_invited': p.user.email.lower() in invited_emails,
            }
            for p in participants
        ]

        attended_guests = [
            {
                'type': 'guest',
                'name': g.full_name,
                'email': None,
                'phone': g.phone,
                'role': 'guest',
                'joined_at': g.decided_at or g.created_at,
                'left_at': None,
                'is_active': g.status == GuestAttendee.Status.ADMITTED,
                'was_invited': False,
            }
            for g in guests
        ]

        attended = attended_users + attended_guests

        no_show = [
            {'email': i.email, 'invited_at': i.created_at}
            for i in invites if i.joined_at is None
        ]

        return Response({
            'expected_from_invites': len(invites),
            'attended_count': len(attended),
            'active_count': sum(1 for a in attended if a['is_active']),
            'inactive_count': sum(1 for a in attended if not a['is_active']),
            'invited_who_attended': sum(1 for i in invites if i.joined_at),
            'invited_who_did_not': len(no_show),
            'guests_admitted': len(attended_guests),
            'attended': attended,
            'did_not_attend': no_show,
        })

    @action(detail=True, methods=['get'], url_path='guests')
    def guests(self, request, pk=None):
        """Guests waiting for, or already given, a decision. Host only."""
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host can see the waiting room'},
                status=status.HTTP_403_FORBIDDEN
            )

        qs = meeting.guests.exclude(
            status=GuestAttendee.Status.LEFT
        ).order_by('created_at')
        return Response(GuestAttendeeSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='admit_guest')
    def admit_guest(self, request, pk=None):
        """Admit or deny a waiting guest. Host only."""
        from src.apps.meetings.guest_views import notify_guest_of_decision

        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host can admit guests'},
                status=status.HTTP_403_FORBIDDEN
            )

        guest_id = request.data.get('guest_id')
        decision = request.data.get('decision')
        decisions = {
            'admit': GuestAttendee.Status.ADMITTED,
            'deny': GuestAttendee.Status.DENIED,
        }
        if decision not in decisions:
            return Response(
                {'error': "decision must be 'admit' or 'deny'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        guest = meeting.guests.filter(id=guest_id).first()
        if guest is None:
            return Response(
                {'error': 'Guest not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        guest.status = decisions[decision]
        guest.decided_by = request.user
        guest.decided_at = timezone.now()
        guest.save(update_fields=['status', 'decided_by', 'decided_at', 'updated_at'])

        notify_guest_of_decision(guest)
        return Response(GuestAttendeeSerializer(guest).data)

    @action(detail=True, methods=['get'], url_path='pending_messages')
    def pending_messages(self, request, pk=None):
        """Messages awaiting the host's review. Host only."""
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host reviews messages'},
                status=status.HTTP_403_FORBIDDEN
            )

        qs = ChatMessage.objects.filter(
            meeting=meeting,
            moderation_status=ChatMessage.Moderation.PENDING,
        ).select_related(
            'sender', 'recipient', 'guest_sender', 'guest_recipient'
        ).order_by('created_at')

        return Response(ChatMessageSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='reviewed_messages')
    def reviewed_messages(self, request, pk=None):
        """Direct messages the host has seen. Host only.

        Everything private that reached its recipient - what the host let
        through, and what never needed letting through because it was sent
        to the host in the first place. That second kind used to appear
        nowhere: it skipped the queue, correctly, and then fell outside a
        record that only listed approvals, so a question asked of the host
        from the room could not be filed as one afterwards.

        Split by who sent it, because an account holder and a guest are
        answered in different places. Each carries whether it also went on
        the board. The host's own outgoing messages are not a queue of
        anything, so they are left out.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host reviews messages'},
                status=status.HTTP_403_FORBIDDEN
            )

        reviewed = ChatMessage.objects.filter(
            meeting=meeting,
            moderation_status__in=[
                ChatMessage.Moderation.APPROVED,
                ChatMessage.Moderation.NOT_REQUIRED,
            ],
        ).exclude(
            recipient__isnull=True, guest_recipient__isnull=True
        ).exclude(
            sender=request.user
        ).select_related(
            'sender', 'recipient', 'guest_sender', 'guest_recipient'
        ).order_by('-created_at')

        rows = ChatMessageSerializer(reviewed, many=True).data
        return Response({
            'from_users': [
                row for row, m in zip(rows, reviewed) if m.guest_sender_id is None
            ],
            'from_guests': [
                row for row, m in zip(rows, reviewed) if m.guest_sender_id is not None
            ],
        })

    @action(detail=True, methods=['post'], url_path='moderate_message')
    def moderate_message(self, request, pk=None):
        """Approve, decline or remove a held message. Host only.

        Approving forwards it to the intended recipient; declining tells only
        the sender; removing discards it silently.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host reviews messages'},
                status=status.HTTP_403_FORBIDDEN
            )

        message_id = request.data.get('message_id')
        decision = request.data.get('decision')

        decisions = {
            'approve': ChatMessage.Moderation.APPROVED,
            'decline': ChatMessage.Moderation.DECLINED,
            'remove': ChatMessage.Moderation.REMOVED,
        }
        if decision not in decisions:
            return Response(
                {'error': f'decision must be one of {sorted(decisions)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        message = ChatMessage.objects.filter(
            meeting=meeting, id=message_id
        ).select_related(
            'sender', 'recipient', 'guest_sender', 'guest_recipient'
        ).first()
        if message is None:
            return Response(
                {'error': 'Message not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if message.moderation_status != ChatMessage.Moderation.PENDING:
            return Response(
                {'error': f'Message is already {message.moderation_status}'},
                status=status.HTTP_409_CONFLICT
            )

        message.moderation_status = decisions[decision]
        message.moderated_by = request.user
        message.moderated_at = timezone.now()
        changed = ['moderation_status', 'moderated_by', 'moderated_at']

        # Sorting it onto the board can be done in the same breath as
        # approving it, which is when the host has just read it.
        topic = request.data.get('topic')
        if topic and topic != ChatMessage.Topic.NONE and decision == 'approve':
            if topic not in ChatMessage.Topic.values:
                return Response(
                    {'error': f'topic must be one of {sorted(ChatMessage.Topic.values)}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            # Same rule as sorting one afterwards: the board is for what
            # was said privately, not for what the room already heard.
            if not message.is_direct:
                return Response(
                    {
                        'error': (
                            'The board is for direct messages. This one was '
                            'sent to the whole room.'
                        ),
                        'code': 'not_direct',
                    },
                    status=status.HTTP_409_CONFLICT
                )
            message.topic = topic
            changed.append('topic')

        message.save(update_fields=changed)

        deliver_moderated_message(meeting, message, decision)
        return Response(ChatMessageSerializer(message).data)

    @action(detail=True, methods=['post'], url_path='sort_message')
    def sort_message(self, request, pk=None):
        """Put a message on the board as a question or a suggestion, or take
        it off again. Host only.

        This publishes. The board is read by everyone in the meeting, so a
        direct message sorted onto it stops being private - which is why
        only the host can do it, and only deliberately.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host sorts messages'},
                status=status.HTTP_403_FORBIDDEN
            )

        topic = request.data.get('topic')
        if topic not in ChatMessage.Topic.values:
            return Response(
                {'error': f'topic must be one of {sorted(ChatMessage.Topic.values)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        message = ChatMessage.objects.filter(
            meeting=meeting, id=request.data.get('message_id')
        ).select_related('sender', 'guest_sender').first()
        if message is None:
            return Response(
                {'error': 'Message not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # A message the host has not let through cannot be published by
        # sorting it - that would be a way round their own decision.
        held = (
            ChatMessage.Moderation.PENDING,
            ChatMessage.Moderation.DECLINED,
            ChatMessage.Moderation.REMOVED,
        )
        if topic != ChatMessage.Topic.NONE and message.moderation_status in held:
            return Response(
                {'error': 'Let the message through before putting it on the board'},
                status=status.HTTP_409_CONFLICT
            )

        # Only what was said privately. A room message has already been
        # read by everyone present, so putting it on the board adds
        # nothing; the board is for the questions people brought to the
        # host or a speaker rather than to the room.
        if topic != ChatMessage.Topic.NONE and not message.is_direct:
            return Response(
                {
                    'error': (
                        'The board is for direct messages. This one was sent '
                        'to the whole room, which has already read it.'
                    ),
                    'code': 'not_direct',
                },
                status=status.HTTP_409_CONFLICT
            )

        message.topic = topic
        message.save(update_fields=['topic'])
        return Response(ChatMessageSerializer(message).data)

    @action(detail=True, methods=['post'], url_path='answer_message')
    def answer_message(self, request, pk=None):
        """Answer a question on the board, or change the answer. Host only.

        Written whenever it suits - from the front of the room while the
        question is live, or days later when somebody has actually found
        out. Only what is already on the board can be answered: an answer
        the room cannot see would be talking to nobody.
        """
        meeting = self.get_object()

        if str(request.user.id) != str(meeting.host_id):
            return Response(
                {'error': 'Only the host answers from the board'},
                status=status.HTTP_403_FORBIDDEN
            )

        message = ChatMessage.objects.filter(
            meeting=meeting, id=request.data.get('message_id')
        ).select_related('sender', 'guest_sender', 'answered_by').first()
        if message is None:
            return Response(
                {'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND
            )
        if message.topic == ChatMessage.Topic.NONE:
            return Response(
                {
                    'error': 'Put it on the board before answering it.',
                    'code': 'not_on_board',
                },
                status=status.HTTP_409_CONFLICT
            )

        answer = (request.data.get('answer') or '').strip()
        message.answer = answer
        # Clearing the answer clears who gave it, rather than leaving a
        # name attached to nothing.
        message.answered_by = request.user if answer else None
        message.answered_at = timezone.now() if answer else None
        message.save(update_fields=['answer', 'answered_by', 'answered_at'])

        logger.info(f"Board answer {'written' if answer else 'cleared'} on {message.id}")
        return Response(ChatMessageSerializer(message).data)

    @action(detail=True, methods=['post'], url_path='vote_board')
    def vote_board(self, request, pk=None):
        """Vote a question or suggestion up or down, or take the vote back.

        Everybody in the meeting gets one. The room deciding what most
        wants answering is the point of a board.
        """
        from src.apps.meetings.board import board_for, cast

        meeting = self.get_object()

        value = request.data.get('value')
        if value not in (1, -1):
            return Response(
                {'error': 'value must be 1 or -1'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = ChatMessage.objects.filter(
            meeting=meeting, id=request.data.get('message_id')
        ).exclude(topic=ChatMessage.Topic.NONE).first()
        if message is None:
            return Response(
                {'error': 'Nothing on the board with that id'},
                status=status.HTTP_404_NOT_FOUND,
            )

        cast(message, value, user=request.user)
        return Response(board_for(meeting, user=request.user))

    @action(detail=True, methods=['get'], url_path='board')
    def board(self, request, pk=None):
        """The questions and suggestions the host has put up.

        Read by attendees as well as the host - it is the point of sorting
        them. Only what the host actually sorted appears, and only the
        asker is named: who a direct message was addressed to is nobody
        else's business, whatever became of the message.
        """
        meeting = self.get_object()

        from src.apps.meetings.board import board_for

        return Response(board_for(meeting, user=request.user))

    @action(detail=True, methods=['get'], url_path='qr', permission_classes=[AllowAny])
    def qr(self, request, pk=None):
        """The join link as a QR square, for a door or a projector.

        Served openly: it encodes the same link the host hands out, and a
        code alone still gets a guest no further than the waiting room.
        """
        import io

        import qrcode
        import qrcode.image.svg
        from django.http import HttpResponse

        meeting = Meeting.objects.filter(meeting_code=pk).first()
        if meeting is None:
            try:
                meeting = Meeting.objects.filter(pk=pk).first()
            except (ValueError, ValidationError):
                meeting = None
        if meeting is None:
            return Response(
                {'error': 'Meeting not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        target = request.query_params.get('url') or (
            f"{request.scheme}://{request.get_host()}/login?join={meeting.meeting_code}"
        )

        image = qrcode.make(target, image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
        buffer = io.BytesIO()
        image.save(buffer)

        response = HttpResponse(buffer.getvalue(), content_type='image/svg+xml')
        # The code does not change, so a scanner may keep the square.
        response['Cache-Control'] = 'public, max-age=3600'
        return response

    @action(detail=False, methods=['post'], url_path='with_sessions')
    def with_sessions(self, request):
        """Create a meeting together with the sessions that make it up.

        The meeting may belong to a programme or stand on its own - pass an
        event to attach it, leave it out and it stands alone. Either way it
        arrives with its running order, because a meeting with nothing in it
        is not yet a meeting.
        """
        from src.apps.meetings.event_serializers import (
            MeetingSummarySerializer, MeetingWriteSerializer, build_meeting,
        )
        from src.apps.meetings.models import Event

        serializer = MeetingWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        event = None
        event_id = data.pop('event', None)
        if event_id:
            event = Event.objects.filter(id=event_id, organizer=request.user).first()
            if event is None:
                return Response(
                    {'error': 'No such event, or it is not yours'},
                    status=status.HTTP_404_NOT_FOUND
                )

        from src.apps.accounts.plans import check_can_add_meeting, check_session_count
        from src.apps.accounts.roles import ensure_host

        check_can_add_meeting(request.user, event)
        check_session_count(request.user, len(data.get('sessions') or []))
        ensure_host(request.user)

        meeting = build_meeting(data, event=event, host=request.user)
        logger.info(
            f"Created meeting {meeting.meeting_code} "
            f"({'in ' + str(event.id) if event else 'standalone'})"
        )
        return Response(
            MeetingSummarySerializer(meeting).data,
            status=status.HTTP_201_CREATED
        )

    @action(
        detail=True,
        methods=['get', 'post'],
        parser_classes=[MultiPartParser, FormParser],
    )
    def resources(self, request, pk=None):
        """List, or upload, shared files for a meeting.

        Uploads always land in the host's Drive regardless of who sends them,
        and every participant is granted read access.
        """
        from src.apps.artifacts.serializers import ArtifactSerializer

        meeting = self.get_object()
        artifact_service = MeetingArtifactService(meeting.id, meeting.host_id)

        if request.method == 'GET':
            # Attendees read a session's files once that session is over;
            # organizers see what they have staged for sessions still to come.
            from src.apps.artifacts.visibility import can_organize

            resources = artifact_service.list_resources(
                include_unreleased=can_organize(meeting, request.user)
            )
            return Response(ArtifactSerializer(resources, many=True).data)

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response(
                {'error': 'No file provided'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if uploaded_file.size > MAX_RESOURCE_UPLOAD_BYTES:
            return Response(
                {'error': f'File exceeds the {MAX_RESOURCE_UPLOAD_BYTES // (1024 * 1024)}MB limit'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            artifact = artifact_service.upload_resource(uploaded_file, request.user)
        except Exception as e:
            logger.error(f"Resource upload failed for {meeting.meeting_code}: {e}")
            return Response(
                {'error': f'Upload failed: {e}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        broadcast_resources_changed(meeting)
        return Response(
            ArtifactSerializer(artifact).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'], url_path='resource_settings')
    def resource_settings(self, request, pk=None):
        """Say who may read a shared file, and where it sits in the order.

        Whoever uploaded it chose to begin with; the organizers can change
        it afterwards, which is the point of having the choice at all.
        """
        from src.apps.artifacts.models import Artifact
        from src.apps.artifacts.serializers import ArtifactSerializer
        from src.apps.artifacts.visibility import can_organize

        meeting = self.get_object()
        if not can_organize(meeting, request.user):
            return Response(
                {'error': 'Only the people running the meeting can change this'},
                status=status.HTTP_403_FORBIDDEN,
            )

        artifact = Artifact.objects.filter(
            meeting=meeting, id=request.data.get('resource_id')
        ).select_related('session').first()
        if artifact is None:
            return Response(
                {'error': 'No such file on this meeting'},
                status=status.HTTP_404_NOT_FOUND,
            )

        changed = []
        wanted = request.data.get('visibility')
        if wanted is not None:
            if wanted not in Artifact.Visibility.values:
                return Response(
                    {'error': f'visibility must be one of '
                              f'{sorted(Artifact.Visibility.values)}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            artifact.visibility = wanted
            changed.append('visibility')

        position = request.data.get('position')
        if position is not None:
            artifact.position = max(0, int(position))
            changed.append('position')

        if not changed:
            return Response(
                {'error': 'Nothing to change.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        artifact.save(update_fields=changed + ['updated_at'])
        broadcast_resources_changed(meeting)
        return Response(ArtifactSerializer(artifact).data)

    def update_participant(self, request, pk=None, participant_id=None):
        """Update a meeting participant's status"""
        meeting = self.get_object()
        try:
            participant = meeting.participants.get(id=participant_id)
        except MeetingParticipant.DoesNotExist:
            return Response(
                {'error': 'Participant not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = MeetingParticipantUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Update participant fields
        for field, value in serializer.validated_data.items():
            setattr(participant, field, value)
        participant.save()

        return Response(ParticipantSerializer(participant).data)
    
    @action(detail=True, methods=['get'])
    def artifacts(self, request, pk=None):
        """Get meeting artifacts"""
        meeting = self.get_object()
        artifacts = meeting.artifacts.all()
        from src.apps.artifacts.serializers import ArtifactSerializer
        serializer = ArtifactSerializer(artifacts, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def export(self, request, pk=None):
        """Export meeting artifacts"""
        meeting = self.get_object()
        export_format = request.data.get('format', 'pdf')
        
        try:
            artifact_service = MeetingArtifactService(meeting.id, request.user.id)
            export_data = artifact_service.export_meeting_data(export_format)
            
            return Response({
                'message': 'Export initiated',
                'format': export_format,
                'download_url': export_data.get('url')
            })
            
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get active meetings for the user"""
        user = request.user
        
        # Meetings where user is host or participant
        active_meetings = Meeting.objects.filter(
            models.Q(host=user) | 
            models.Q(participants__user=user, participants__is_active=True),
            status=Meeting.Status.ACTIVE
        ).distinct()
        
        serializer = MeetingSerializer(active_meetings, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def update_artifact(self, request, pk=None):
        """Update a meeting artifact"""
        meeting = self.get_object()
        artifact_type = request.data.get('artifact_type')
        content = request.data.get('content')
        
        if not artifact_type or content is None:
            return Response(
                {'error': 'artifact_type and content are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            artifact_service = MeetingArtifactService(meeting.id, request.user.id)
            
            if artifact_type == 'transcript':
                success = artifact_service.save_transcript(content)
            elif artifact_type == 'notes':
                success = artifact_service.save_meeting_notes(content)
            else:
                return Response(
                    {'error': f'Unsupported artifact type: {artifact_type}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            if success:
                return Response({'message': 'Artifact updated successfully'})
            else:
                return Response(
                    {'error': 'Failed to update artifact'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )