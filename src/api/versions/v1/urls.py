from django.core.exceptions import ValidationError
from django.urls import path, include, re_path
from rest_framework import routers, status
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

# Import viewsets from apps
try:
    from src.apps.accounts.views import UserViewSet, AuthViewSet
except ImportError:
    UserViewSet = None
    AuthViewSet = None

try:
    from src.apps.meetings.views import MeetingViewSet
except ImportError:
    MeetingViewSet = None

try:
    from src.apps.meetings.event_views import EventViewSet, SessionViewSet
except ImportError:
    EventViewSet = None
    SessionViewSet = None

router = routers.DefaultRouter()

# Register implemented viewsets
if UserViewSet:
    router.register(r'users', UserViewSet, basename='user')
if AuthViewSet:
    router.register(r'auth', AuthViewSet, basename='auth')
if MeetingViewSet:
    router.register(r'meetings', MeetingViewSet, basename='meeting')
if EventViewSet:
    router.register(r'events', EventViewSet, basename='event')
if SessionViewSet:
    router.register(r'sessions', SessionViewSet, basename='session')

def _resolve_meeting(meeting_ref):
    """Find a meeting by meeting_code or primary key."""
    from src.apps.meetings.models import Meeting

    meeting = Meeting.objects.filter(meeting_code=meeting_ref).first()
    if meeting is None:
        try:
            meeting = Meeting.objects.filter(pk=meeting_ref).first()
        except (ValueError, ValidationError):
            meeting = None
    return meeting


def _resolve_participant(meeting, participant_ref):
    """Find a participant by its own id or by the id of its user."""
    from django.db.models import Q

    try:
        return meeting.participants.select_related('user').filter(
            Q(id=participant_ref) | Q(user_id=participant_ref)
        ).first()
    except (ValueError, ValidationError):
        return None


# Custom view for participant update
@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_participant_view(request, meeting_ref, participant_ref):
    """Update a participant's own media state (mute, video, screen share).

    Roles are deliberately not settable here - see update_participant_role_view.
    """
    from src.apps.meetings.serializers import ParticipantSerializer

    meeting = _resolve_meeting(meeting_ref)
    if meeting is None:
        return Response({'error': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)

    participant = _resolve_participant(meeting, participant_ref)
    if participant is None:
        return Response({'error': 'Participant not found'}, status=status.HTTP_404_NOT_FOUND)

    is_host = str(request.user.id) == str(meeting.host_id)
    if str(participant.user_id) != str(request.user.id) and not is_host:
        return Response(
            {'error': 'You can only change your own state'},
            status=status.HTTP_403_FORBIDDEN
        )

    allowed = {'is_muted', 'is_video_on', 'is_screen_sharing'}
    updates = {k: v for k, v in request.data.items() if k in allowed}
    if not updates:
        return Response(
            {'error': f'Nothing to update. Allowed fields: {sorted(allowed)}'},
            status=status.HTTP_400_BAD_REQUEST
        )

    for field, value in updates.items():
        setattr(participant, field, bool(value))
    participant.save(update_fields=list(updates.keys()))

    return Response(ParticipantSerializer(participant).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_participant_role_view(request, meeting_ref, participant_ref):
    """Change a participant's role. Host only.

    Assigning the ``host`` role transfers ownership of the meeting: the
    previous host is demoted to co-host and loses host controls.
    """
    from django.db import transaction
    from src.apps.meetings.models import MeetingParticipant
    from src.apps.meetings.serializers import ParticipantSerializer

    meeting = _resolve_meeting(meeting_ref)
    if meeting is None:
        return Response({'error': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)

    if str(request.user.id) != str(meeting.host_id):
        return Response(
            {'error': 'Only the host can change roles'},
            status=status.HTTP_403_FORBIDDEN
        )

    participant = _resolve_participant(meeting, participant_ref)
    if participant is None:
        return Response({'error': 'Participant not found'}, status=status.HTTP_404_NOT_FOUND)

    role = request.data.get('role')
    valid_roles = [c[0] for c in MeetingParticipant.Role.choices]
    if role not in valid_roles:
        return Response(
            {'error': f'Role must be one of {valid_roles}'},
            status=status.HTTP_400_BAD_REQUEST
        )

    is_self = str(participant.user_id) == str(meeting.host_id)

    if role == MeetingParticipant.Role.HOST:
        if is_self:
            return Response(ParticipantSerializer(participant).data)

        with transaction.atomic():
            previous_host_participant = meeting.participants.filter(
                user_id=meeting.host_id
            ).first()

            meeting.host = participant.user
            meeting.save(update_fields=['host', 'updated_at'])

            participant.role = MeetingParticipant.Role.HOST
            participant.save(update_fields=['role'])

            if previous_host_participant:
                previous_host_participant.role = MeetingParticipant.Role.CO_HOST
                previous_host_participant.save(update_fields=['role'])
    else:
        if is_self:
            return Response(
                {'error': 'Transfer the host role to someone else before changing your own'},
                status=status.HTTP_400_BAD_REQUEST
            )
        participant.role = role
        participant.save(update_fields=['role'])

    _broadcast_roles_changed(meeting.meeting_code)
    return Response(ParticipantSerializer(participant).data)


def _broadcast_roles_changed(meeting_code):
    """Nudge everyone in the room to refetch participants."""
    import logging

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
                'state': {'roles_changed': True},
                'timestamp': '',
            },
        )
    except Exception as e:
        logging.getLogger(__name__).warning(
            f"Could not broadcast role change for {meeting_code}: {e}"
        )


# Custom nested routes for participants (must come before router include)
from src.apps.meetings import guest_views
from src.apps.meetings import hub_views
from src.apps.artifacts import photo_views
from src.apps.drive import export_views
from src.apps.meetings import reminder_views
from src.apps.transcription import ingest as transcription_ingest

urlpatterns = [
    # The hall's capture device streams text in; clients only read it out.
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/transcription/$',
        transcription_ingest.ingest_transcription,
        name='transcription-ingest',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/segments/$',
        transcription_ingest.meeting_segments,
        name='transcription-segments',
    ),
    path('meetings/guest/knock/', guest_views.guest_knock, name='guest-knock'),
    path('meetings/guest/status/', guest_views.guest_status, name='guest-status'),
    path('meetings/guest/leave/', guest_views.guest_leave, name='guest-leave'),
    path('meetings/guest/chat/', guest_views.guest_chat, name='guest-chat'),
    # The photographs of the day. Kept apart from files and summaries: one
    # is the record of an occasion, the other the papers circulated at it.
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/photos/$',
        photo_views.meeting_photos,
        name='meeting-photos',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/photos/folders/$',
        photo_views.create_photo_folder,
        name='photo-folder-create',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/photos/folders/(?P<folder_id>[0-9a-f-]+)/$',
        photo_views.photo_folder,
        name='photo-folder',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/photos/folders/(?P<folder_id>[0-9a-f-]+)/upload/$',
        photo_views.upload_photo,
        name='photo-upload',
    ),
    re_path(
        r'^meetings/photos/(?P<photo_id>[0-9a-f-]+)/file/$',
        photo_views.photo_file,
        name='photo-file',
    ),

    # A report goes to the reader's own Google Sheets rather than to their
    # Downloads folder.
    path('exports/sheet/', export_views.export_to_sheet, name='export-to-sheet'),

    path('reminders/', reminder_views.my_reminders, name='my-reminders'),
    path('reminders/read/', reminder_views.mark_reminders_read,
         name='reminders-read'),

    path('meetings/guest/board/', guest_views.guest_board, name='guest-board'),
    path('meetings/guest/board/vote/', guest_views.guest_vote_board,
         name='guest-board-vote'),

    # The attendee hub: questions, ideas and suggestions, for account
    # holders and guests alike.
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/hub/$',
        hub_views.hub_posts,
        name='hub-posts',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/hub/(?P<post_id>[0-9a-f-]+)/vote/$',
        hub_views.hub_vote,
        name='hub-vote',
    ),
    path('meetings/guest/presenters/', guest_views.guest_presenters, name='guest-presenters'),
    path('meetings/guest/resources/', guest_views.guest_resources, name='guest-resources'),
    re_path(
        r'^meetings/guest/resources/(?P<artifact_id>[0-9a-f-]+)/download/$',
        guest_views.guest_resource_download,
        name='guest-resource-download',
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/participants/(?P<participant_ref>[^/.]+)/role/$',
        update_participant_role_view,
        name='meeting-participant-role'
    ),
    re_path(
        r'^meetings/(?P<meeting_ref>[^/.]+)/participants/(?P<participant_ref>[^/.]+)/$',
        update_participant_view,
        name='meeting-participant-update'
    ),
    path('', include(router.urls)),
]
