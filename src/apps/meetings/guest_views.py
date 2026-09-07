"""Public endpoints for guests joining by meeting code.

Guests have no account, so these are unauthenticated and identified instead by
a signed token issued when they knock.
"""
import logging
from urllib.parse import quote

from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from django.db import models as db_models
from src.apps.meetings.models import Meeting, GuestAttendee, ChatMessage
from src.apps.meetings.serializers import (
    GuestJoinSerializer, GuestAttendeeSerializer, ChatMessageSerializer
)
from src.apps.meetings.guest_tokens import make_guest_token, resolve_guest

logger = logging.getLogger(__name__)


class GuestKnockThrottle(AnonRateThrottle):
    scope = 'guest_knock'


def notify_host_of_guest(guest):
    """Push a waiting guest to the host's screen."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{guest.meeting.meeting_code}_user_{guest.meeting.host_id}',
            {
                'type': 'guest_waiting',
                'guest_id': str(guest.id),
                'full_name': guest.full_name,
                'phone': guest.phone,
                'created_at': guest.created_at.isoformat(),
            },
        )
    except Exception as e:
        logger.warning(f"Could not notify host of guest {guest.id}: {e}")


def notify_guest_of_decision(guest):
    """Tell a waiting guest they were admitted or denied."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{guest.meeting.meeting_code}_guest_{guest.id}',
            {'type': 'guest_decision', 'status': guest.status},
        )
    except Exception as e:
        logger.warning(f"Could not notify guest {guest.id}: {e}")


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([GuestKnockThrottle])
def guest_knock(request):
    """A guest asks to join a meeting by code. Returns a waiting token."""
    serializer = GuestJoinSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    meeting = Meeting.objects.filter(meeting_code=data['meeting_code']).first()
    if meeting is None:
        return Response(
            {'error': f"No meeting found with code {data['meeting_code']}"},
            status=status.HTTP_404_NOT_FOUND
        )
    if meeting.status == Meeting.Status.ENDED:
        return Response(
            {'error': 'This meeting has already ended'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Someone the host already admitted is coming back - whether they dropped
    # out or left deliberately. Approval already happened; don't ask again.
    returning = GuestAttendee.objects.filter(
        meeting=meeting,
        status__in=[
            GuestAttendee.Status.ADMITTED,
            GuestAttendee.Status.LEFT,
        ],
        phone__iexact=data['phone'],
        full_name__iexact=data['full_name'],
    ).order_by('-updated_at').first()

    if returning is not None:
        if returning.status != GuestAttendee.Status.ADMITTED:
            returning.status = GuestAttendee.Status.ADMITTED
            returning.save(update_fields=['status', 'updated_at'])
        logger.info(
            f"Guest {returning.full_name} rejoined {meeting.meeting_code} "
            f"without re-approval"
        )
        return Response(
            {
                'guest_token': make_guest_token(returning),
                'guest': GuestAttendeeSerializer(returning).data,
                'meeting': {
                    'meeting_code': meeting.meeting_code,
                    'title': meeting.title,
                },
                'rejoined': True,
            },
            status=status.HTTP_200_OK
        )

    # Someone the host explicitly denied should not get another prompt by
    # simply resubmitting the form.
    denied = GuestAttendee.objects.filter(
        meeting=meeting,
        status=GuestAttendee.Status.DENIED,
        phone__iexact=data['phone'],
        full_name__iexact=data['full_name'],
    ).first()
    if denied is not None:
        return Response(
            {'error': 'The host declined your request to join this meeting'},
            status=status.HTTP_403_FORBIDDEN
        )

    guest = GuestAttendee.objects.create(
        meeting=meeting,
        full_name=data['full_name'],
        phone=data['phone'],
    )
    notify_host_of_guest(guest)

    return Response(
        {
            'guest_token': make_guest_token(guest),
            'guest': GuestAttendeeSerializer(guest).data,
            'meeting': {
                'meeting_code': meeting.meeting_code,
                'title': meeting.title,
            },
            'rejoined': False,
        },
        status=status.HTTP_201_CREATED
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_status(request):
    """Where a waiting guest stands. Polled from the waiting screen."""
    token = request.query_params.get('token', '')
    guest = resolve_guest(token)
    if guest is None:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    meeting = guest.meeting
    if (
        meeting.status != Meeting.Status.ENDED
        and meeting.scheduled_end
        and timezone.now() >= meeting.scheduled_end
    ):
        from src.apps.meetings.services.meeting_service import MeetingService
        meeting = MeetingService.end_meeting(meeting.id)
        guest.meeting = meeting

    return Response({
        'guest': GuestAttendeeSerializer(guest).data,
        'meeting': {
            'meeting_code': guest.meeting.meeting_code,
            'title': guest.meeting.title,
            'status': guest.meeting.status,
            'started_at': (
                guest.meeting.started_at.isoformat()
                if guest.meeting.started_at else None
            ),
        },
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def guest_leave(request):
    """A guest closes their session."""
    guest = resolve_guest(request.data.get('token', ''))
    if guest is None:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    guest.status = GuestAttendee.Status.LEFT
    guest.save(update_fields=['status', 'updated_at'])
    return Response({'status': guest.status})


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_board(request):
    """The questions and suggestions the host has put up, for a guest.

    A guest can ask, so a guest can read what was asked. Mirrors the
    account-holder endpoint exactly - only what the host sorted, and only
    the asker named.
    """
    guest = resolve_guest(request.query_params.get('token', ''))
    if guest is None:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    if not guest.is_admitted:
        return Response(
            {'error': 'You have not been admitted to this meeting'},
            status=status.HTTP_403_FORBIDDEN
        )

    from src.apps.meetings.board import board_for

    return Response(board_for(guest.meeting))


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_chat(request):
    """Chat history and settings for an admitted guest.

    Mirrors the account-holder endpoint: public room messages, plus direct
    messages this guest sent or received, and nothing still pending review.
    """
    guest = resolve_guest(request.query_params.get('token', ''))
    if guest is None:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    if not guest.is_admitted:
        return Response(
            {'error': 'You have not been admitted to this meeting'},
            status=status.HTTP_403_FORBIDDEN
        )

    meeting = guest.meeting
    settings_payload = {
        'chat_enabled': meeting.chat_enabled,
        'direct_messages_enabled': meeting.direct_messages_enabled,
    }
    if not meeting.chat_enabled:
        return Response({'settings': settings_payload, 'messages': []})

    deliverable = db_models.Q(moderation_status__in=[
        ChatMessage.Moderation.NOT_REQUIRED,
        ChatMessage.Moderation.APPROVED,
    ])
    visible = (
        (db_models.Q(recipient__isnull=True, guest_recipient__isnull=True) & deliverable)
        | db_models.Q(guest_sender=guest)
        | (db_models.Q(guest_recipient=guest) & deliverable)
    )

    qs = ChatMessage.objects.filter(meeting=meeting).filter(visible).exclude(
        moderation_status=ChatMessage.Moderation.REMOVED
    ).select_related(
        'sender', 'recipient', 'guest_sender', 'guest_recipient'
    ).order_by('created_at')

    return Response({
        'settings': settings_payload,
        'messages': ChatMessageSerializer(qs[:500], many=True).data,
        'me': {'id': str(guest.id), 'name': guest.full_name},
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_presenters(request):
    """People an admitted guest may address directly."""
    from src.apps.meetings.models import MeetingParticipant

    guest = resolve_guest(request.query_params.get('token', ''))
    if guest is None or not guest.is_admitted:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # Everyone who holds a speaking role, whether or not they are connected
    # right now: someone who dropped out should still be addressable.
    people = guest.meeting.participants.filter(
        role__in=[
            MeetingParticipant.Role.HOST,
            MeetingParticipant.Role.CO_HOST,
            MeetingParticipant.Role.PRESENTER,
        ],
    ).select_related('user')

    return Response([
        {
            'id': str(p.user.id),
            'name': p.user.display_name or p.user.email,
            'role': p.role,
            'is_active': p.is_active,
        }
        for p in people.order_by('role', 'joined_at')
    ])


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_resources(request):
    """Files shared in the meeting, for an admitted guest.

    Guests have no Google account, so the Drive link is useless to them; each
    entry carries a download URL served by this backend instead.
    """
    from src.apps.artifacts.models import Artifact, ArtifactType

    guest = resolve_guest(request.query_params.get('token', ''))
    if guest is None:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    if not guest.is_admitted:
        return Response(
            {'error': 'You have not been admitted to this meeting'},
            status=status.HTTP_403_FORBIDDEN
        )

    token = request.query_params.get('token', '')

    # A guest is in the room, not running it, so a session's files reach
    # them only once that session is over.
    from src.apps.artifacts.visibility import resources_for

    resources = resources_for(guest.meeting, include_unreleased=False)

    return Response([
        {
            'id': str(a.id),
            'display_name': a.display_name,
            'mime_type': a.mime_type,
            'file_size': a.file_size,
            'created_at': a.created_at,
            'uploaded_by': a.metadata.get('uploaded_by_email'),
            'download_url': (
                f"/api/v1/meetings/guest/resources/{a.id}/download/"
                f"?token={quote(token)}"
            ),
        }
        for a in resources
    ])


@api_view(['GET'])
@permission_classes([AllowAny])
def guest_resource_download(request, artifact_id):
    """Stream a shared file to an admitted guest.

    Served with the host's Drive credentials so the file's sharing settings
    stay untouched.
    """
    from django.http import HttpResponse
    from src.apps.artifacts.models import Artifact, ArtifactType
    from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter

    guest = resolve_guest(request.query_params.get('token', ''))
    if guest is None or not guest.is_admitted:
        return Response(
            {'error': 'Invalid or expired guest session'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    artifact = Artifact.objects.filter(
        id=artifact_id,
        meeting=guest.meeting,
        artifact_type=ArtifactType.RESOURCE,
    ).first()
    if artifact is None or not artifact.drive_file_id:
        return Response(
            {'error': 'File not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # Listing withholds a session's files until it ends; the download has to
    # say the same, or the link is a way around the rule.
    from src.apps.artifacts.visibility import is_released

    if not is_released(artifact):
        return Response(
            {'error': 'This file opens when its session ends'},
            status=status.HTTP_403_FORBIDDEN
        )

    try:
        adapter = GoogleDriveAdapter(str(guest.meeting.host_id))
        content = adapter.download_file(artifact.drive_file_id)
    except Exception as e:
        logger.error(f"Guest download failed for {artifact.id}: {e}")
        return Response(
            {'error': 'Could not fetch this file'},
            status=status.HTTP_502_BAD_GATEWAY
        )

    response = HttpResponse(
        content,
        content_type=artifact.mime_type or 'application/octet-stream',
    )
    response['Content-Disposition'] = (
        f'attachment; filename="{artifact.display_name}"'
    )
    response['Content-Length'] = str(len(content))
    return response
