"""Endpoints for the event / meeting / session hierarchy."""
import logging

from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.meetings.event_serializers import (
    EventCreateSerializer,
    EventSerializer,
    MeetingWriteSerializer,
    SessionAttendanceSerializer,
    SessionSerializer,
    build_meeting,
)
from src.apps.meetings.models import (
    Event,
    Meeting,
    Session,
    SessionAttendance,
)

logger = logging.getLogger(__name__)


class EventViewSet(viewsets.ModelViewSet):
    """A day's programme, with the meetings and sessions inside it."""
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # An organizer sees the programmes they run. Meetings and sessions
        # are prefetched because the list view always renders the tree.
        return (
            Event.objects.filter(organizer=self.request.user)
            .prefetch_related(
                Prefetch(
                    'meetings',
                    queryset=Meeting.objects.order_by('scheduled_start')
                    .prefetch_related('sessions'),
                )
            )
        )

    def get_serializer_class(self):
        return EventCreateSerializer if self.action == 'create' else EventSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        logger.info(f"Created event {event.id} with {event.meetings.count()} meetings")
        return Response(
            EventSerializer(event, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def meetings(self, request, pk=None):
        """Add a meeting, with its sessions, to an existing event."""
        event = self.get_object()

        serializer = MeetingWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        meeting = build_meeting(event, serializer.validated_data)
        from src.apps.meetings.event_serializers import MeetingSummarySerializer

        return Response(
            MeetingSummarySerializer(meeting).data, status=status.HTTP_201_CREATED
        )


class SessionViewSet(viewsets.ModelViewSet):
    """Segments of the running order inside a meeting."""
    serializer_class = SessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Visible to the people who can already see the meeting: its host,
        # and anyone taking part in it.
        from django.db.models import Q

        user = self.request.user
        queryset = Session.objects.filter(
            Q(meeting__host=user) | Q(meeting__participants__user=user)
        ).distinct().select_related('meeting')

        # A meeting is addressed by its id or its room code, and only one of
        # those parses as a UUID.
        meeting_ref = self.request.query_params.get('meeting')
        if meeting_ref:
            import uuid as _uuid

            try:
                _uuid.UUID(str(meeting_ref))
            except (ValueError, AttributeError, TypeError):
                queryset = queryset.filter(meeting__meeting_code=meeting_ref)
            else:
                queryset = queryset.filter(meeting_id=meeting_ref)
        return queryset

    def _require_host(self, session):
        if str(session.meeting.host_id) != str(self.request.user.id):
            return Response(
                {'error': 'Only the host can change the running order'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def perform_create(self, serializer):
        meeting = serializer.validated_data['meeting']
        if str(meeting.host_id) != str(self.request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Only the host can add sessions')
        serializer.save()

    def perform_destroy(self, instance):
        if str(instance.meeting.host_id) != str(self.request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Only the host can remove sessions')
        instance.delete()

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """Put this session on stage.

        Only one session runs at a time, so any other live session in the
        same meeting is closed first - otherwise transcript lines would not
        know which segment they belong to.
        """
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        if session.status == Session.Status.LIVE:
            return Response(SessionSerializer(session).data)

        now = timezone.now()
        for other in session.meeting.sessions.filter(status=Session.Status.LIVE):
            _close_session(other, now)

        session.status = Session.Status.LIVE
        session.started_at = session.started_at or now
        session.ended_at = None
        session.save(update_fields=['status', 'started_at', 'ended_at', 'updated_at'])

        # A session on stage means the meeting is happening, so the room
        # opens with it rather than waiting to be started separately.
        meeting = session.meeting
        if meeting.status != Meeting.Status.ACTIVE:
            meeting.status = Meeting.Status.ACTIVE
            meeting.started_at = meeting.started_at or now
            meeting.ended_at = None
            meeting.save(update_fields=['status', 'started_at', 'ended_at', 'updated_at'])

        _broadcast(meeting.meeting_code, session, 'session_started')
        return Response(SessionSerializer(session).data)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        """Close the session and record who was in the room for it."""
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        recorded = _close_session(session, timezone.now())
        _broadcast(session.meeting.meeting_code, session, 'session_ended')

        return Response({
            **SessionSerializer(session).data,
            'attendance_recorded': recorded,
        })

    @action(detail=True, methods=['get'])
    def attendance(self, request, pk=None):
        """Who was present for this session."""
        session = self.get_object()
        rows = session.attendance.select_related('user', 'guest')
        return Response(SessionAttendanceSerializer(rows, many=True).data)

    @action(detail=True, methods=['post'], url_path='mark')
    def mark(self, request, pk=None):
        """Tick somebody off by hand, for a person the room did not see."""
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        user_id = request.data.get('user_id')
        guest_id = request.data.get('guest_id')
        if bool(user_id) == bool(guest_id):
            return Response(
                {'error': 'Name exactly one of user_id or guest_id'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        present = request.data.get('present', True)
        lookup = {'session': session, 'user_id': user_id, 'guest_id': guest_id}

        if present:
            SessionAttendance.objects.get_or_create(
                **lookup, defaults={'marked_manually': True}
            )
        else:
            SessionAttendance.objects.filter(**lookup).delete()

        return Response({'present': bool(present)})


def _close_session(session, now):
    """Mark a session done and snapshot who was in the room.

    Presence is taken from the meeting at the moment the session ends,
    which is the only point where the room's membership is settled.
    """
    session.status = Session.Status.DONE
    session.ended_at = now
    if not session.started_at:
        session.started_at = now
    session.save(update_fields=['status', 'started_at', 'ended_at', 'updated_at'])

    recorded = 0
    active_users = session.meeting.participants.filter(
        is_active=True, user__isnull=False
    ).values_list('user_id', flat=True)
    for user_id in active_users:
        _, created = SessionAttendance.objects.get_or_create(
            session=session, user_id=user_id
        )
        recorded += int(created)

    admitted_guests = session.meeting.guests.filter(status='admitted').values_list(
        'id', flat=True
    )
    for guest_id in admitted_guests:
        _, created = SessionAttendance.objects.get_or_create(
            session=session, guest_id=guest_id
        )
        recorded += int(created)

    return recorded


def _broadcast(meeting_code, session, event_type):
    """Tell the room the running order moved on. Best effort."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{meeting_code}',
            {
                'type': 'state_update',
                'user_id': '',
                'user_name': '',
                'state': {
                    event_type: True,
                    'session_id': str(session.id),
                    'session_title': session.title,
                },
                'timestamp': timezone.now().isoformat(),
            },
        )
    except Exception as e:
        logger.warning(f"Could not broadcast {event_type} for {meeting_code}: {e}")
