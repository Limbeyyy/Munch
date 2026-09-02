"""Transcript ingest for the capture device in the meeting hall.

The device does the listening and the speech-to-text; the server only accepts
the resulting text, stores the finalised phrases and fans them out to everyone
watching the meeting. No audio ever reaches this service.

Devices are not people, so they authenticate with a shared ingest token rather
than a user session.
"""
import logging

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import (
    api_view, authentication_classes, permission_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from src.apps.meetings.models import Meeting
from src.apps.transcription.models import TranscriptionSegment

logger = logging.getLogger(__name__)

MAX_TEXT_LENGTH = 5000


def _device_authorised(request) -> bool:
    """Check the device's shared token.

    Compared in constant time so a wrong token cannot be discovered by timing
    the response.
    """
    import hmac

    expected = getattr(settings, 'TRANSCRIPTION_INGEST_TOKEN', '') or ''
    if not expected:
        return False

    header = request.META.get('HTTP_AUTHORIZATION', '')
    presented = header[7:] if header.startswith('Bearer ') else ''
    if not presented:
        presented = request.META.get('HTTP_X_INGEST_TOKEN', '')

    return bool(presented) and hmac.compare_digest(presented, expected)


def publish_segment(meeting, segment: dict) -> None:
    """Send a transcript line to every client watching this meeting.

    Best-effort: a channel layer problem must not fail the device's request,
    because the line is already stored.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{meeting.meeting_code}',
            {
                'type': 'transcription_update',
                'segment': segment,
                'timestamp': timezone.now().isoformat(),
            },
        )
    except Exception as e:
        logger.warning(
            f"Could not broadcast transcript for {meeting.meeting_code}: {e}"
        )


@api_view(['POST'])
# The device presents its own shared token, not a user JWT. Without this the
# JWT authenticator would try to parse that token and reject the request
# before the view is ever reached.
@authentication_classes([])
@permission_classes([AllowAny])
def ingest_transcription(request, meeting_ref):
    """Accept a transcript line from the room's capture device.

    Interim lines are broadcast so the screen keeps up with the speaker, but
    only finalised lines are stored - interim text is rewritten constantly and
    would otherwise fill the transcript with half-formed phrases.
    """
    if not _device_authorised(request):
        return Response(
            {'error': 'Invalid or missing ingest token'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    meeting = Meeting.objects.filter(meeting_code=meeting_ref).first()
    if meeting is None:
        meeting = Meeting.objects.filter(pk=meeting_ref).first() \
            if meeting_ref.count('-') >= 4 else None
    if meeting is None:
        return Response(
            {'error': f'No meeting found for {meeting_ref}'},
            status=status.HTTP_404_NOT_FOUND
        )
    if meeting.status == Meeting.Status.ENDED:
        return Response(
            {'error': 'This meeting has ended'},
            status=status.HTTP_409_CONFLICT
        )

    text = (request.data.get('text') or '').strip()
    if not text:
        return Response(
            {'error': 'text is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if len(text) > MAX_TEXT_LENGTH:
        return Response(
            {'error': f'text exceeds {MAX_TEXT_LENGTH} characters'},
            status=status.HTTP_400_BAD_REQUEST
        )

    is_final = bool(request.data.get('is_final', True))

    segment = {
        'meeting_code': meeting.meeting_code,
        # The device reports who is speaking when it can; otherwise the room.
        'speaker_id': str(request.data.get('speaker_id') or 'room-device'),
        'speaker_name': request.data.get('speaker_name') or 'Room',
        'text': text,
        'language': request.data.get('language') or 'en',
        'start_time': float(request.data.get('start_time') or 0),
        'end_time': float(request.data.get('end_time') or 0),
        'confidence': float(request.data.get('confidence') or 0.0),
        'is_final': is_final,
    }

    if is_final:
        TranscriptionSegment.objects.create(
            meeting=meeting,
            speaker_id=segment['speaker_id'],
            speaker_name=segment['speaker_name'],
            text=segment['text'],
            language=segment['language'],
            start_time=segment['start_time'],
            end_time=segment['end_time'],
            confidence=segment['confidence'],
            is_final=True,
        )

    publish_segment(meeting, segment)
    return Response({'stored': is_final, 'segment': segment},
                    status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([AllowAny])
def meeting_segments(request, meeting_ref):
    """Recent transcript lines, so someone arriving late is not left blank.

    Readable by anyone who can already reach the meeting: participants use
    their JWT, guests their signed token.
    """
    from src.apps.meetings.guest_tokens import resolve_guest

    meeting = Meeting.objects.filter(meeting_code=meeting_ref).first()
    if meeting is None:
        return Response(
            {'error': 'Meeting not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    guest_token = request.query_params.get('guest_token')
    if guest_token:
        guest = resolve_guest(guest_token)
        allowed = bool(guest and guest.is_admitted and guest.meeting_id == meeting.id)
    else:
        user = request.user
        allowed = bool(
            user
            and user.is_authenticated
            and (
                str(user.id) == str(meeting.host_id)
                or meeting.participants.filter(user=user).exists()
            )
        )

    if not allowed:
        return Response(
            {'error': 'You are not in this meeting'},
            status=status.HTTP_403_FORBIDDEN
        )

    segments = meeting.transcription_segments.filter(
        is_final=True
    ).order_by('created_at')[:500]

    return Response([
        {
            'speaker_id': s.speaker_id,
            'speaker_name': s.speaker_name,
            'text': s.text,
            'language': s.language,
            'start_time': s.start_time,
            'end_time': s.end_time,
            'confidence': s.confidence,
            'is_final': s.is_final,
            'created_at': s.created_at,
        }
        for s in segments
    ])
