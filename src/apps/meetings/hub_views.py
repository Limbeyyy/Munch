"""Endpoints for the attendee hub.

Account holders reach these with their token, guests with the signed one
they were given at the door. Everything else about them is the same, which
is the point: a guest is a person in the room, not a lesser kind of user.
"""
import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from src.apps.meetings import hub
from src.apps.meetings.guest_tokens import resolve_guest
from src.apps.meetings.models import HubPost, Meeting, Session

logger = logging.getLogger(__name__)

MAX_BODY = 2000


def _who(request, meeting):
    """The person behind this request, and whether they belong in the room.

    Returns ``(user, guest, error)`` - exactly one of the first two, or an
    error response if neither is in the meeting.
    """
    token = request.query_params.get('guest_token') or request.data.get('guest_token')
    if token:
        guest = resolve_guest(token)
        if guest is None or guest.meeting_id != meeting.id or not guest.is_admitted:
            return None, None, Response(
                {'error': 'You are not in this meeting'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None, guest, None

    user = request.user
    if not (user and user.is_authenticated):
        return None, None, Response(
            {'error': 'Sign in, or join as a guest'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    from src.apps.meetings.entry import is_open

    belongs = (
        str(user.id) == str(meeting.host_id)
        or meeting.participants.filter(user=user).exists()
        or is_open(meeting)
    )
    if not belongs:
        return None, None, Response(
            {'error': 'You are not in this meeting'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return user, None, None


def _meeting_or_404(meeting_ref):
    return Meeting.objects.filter(meeting_code=meeting_ref).first()


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def hub_posts(request, meeting_ref):
    """Read the hub, or add something to it."""
    meeting = _meeting_or_404(meeting_ref)
    if meeting is None:
        return Response({'error': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)

    user, guest, denied = _who(request, meeting)
    if denied:
        return denied

    if request.method == 'GET':
        return Response(hub.board_for(meeting, user=user, guest=guest))

    kind = request.data.get('kind')
    if kind not in HubPost.Kind.values:
        return Response(
            {'error': f'kind must be one of {sorted(HubPost.Kind.values)}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    body = (request.data.get('body') or '').strip()
    if not body:
        return Response(
            {'error': 'Write something first.'}, status=status.HTTP_400_BAD_REQUEST
        )

    session = None
    session_id = request.data.get('session')
    if session_id:
        session = Session.objects.filter(id=session_id, meeting=meeting).first()

    # A suggestion is a private word with the organizer, so it does not
    # queue for approval - there is nobody else for it to be shown to.
    starting = (
        HubPost.Status.LOOKING if kind == HubPost.Kind.SUGGESTION
        else HubPost.Status.PENDING
    )

    post = HubPost.objects.create(
        meeting=meeting,
        session=session,
        user=user,
        guest=guest,
        kind=kind,
        body=body[:MAX_BODY],
        category=(request.data.get('category') or '')[:40],
        anonymous=bool(request.data.get('anonymous')),
        status=starting,
    )
    logger.info(f"Hub {kind} added to {meeting.meeting_code}")
    return Response(
        hub.as_json(post, user=user, guest=guest), status=status.HTTP_201_CREATED
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def hub_vote(request, meeting_ref, post_id):
    """Vote a post up or down, or take the vote back."""
    meeting = _meeting_or_404(meeting_ref)
    if meeting is None:
        return Response({'error': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)

    user, guest, denied = _who(request, meeting)
    if denied:
        return denied

    value = request.data.get('value')
    if value not in (1, -1):
        return Response(
            {'error': 'value must be 1 or -1'}, status=status.HTTP_400_BAD_REQUEST
        )

    post = hub.visible_to(meeting, user=user, guest=guest).filter(id=post_id).first()
    if post is None:
        return Response({'error': 'No such post'}, status=status.HTTP_404_NOT_FOUND)

    # A suggestion goes to the organizer alone, so there is no room to
    # weigh in on it.
    if post.kind == HubPost.Kind.SUGGESTION:
        return Response(
            {'error': 'Suggestions go to the organizer, and are not voted on.'},
            status=status.HTTP_409_CONFLICT,
        )

    hub.cast(post, value, user=user, guest=guest)
    return Response(hub.as_json(post, user=user, guest=guest))
