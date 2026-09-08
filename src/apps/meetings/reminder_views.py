"""What somebody is owed a nudge about, and how to put it in their diary."""
import logging
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.meetings.models import Reminder
from src.apps.meetings.reminders import (
    MEETING_LEAD_MINUTES, SESSION_LEAD_MINUTES, calendar_link,
)

logger = logging.getLogger(__name__)

# How far back the list still reaches. A day, so this morning's sessions are
# still there this afternoon without the page turning into an archive.
LOOKBACK_HOURS = 24


def _as_json(reminder):
    """One reminder, with the diary link it deserves.

    The link is built here rather than in the browser so the times and the
    wording match what the reminder itself says.
    """
    meeting = reminder.meeting
    session = reminder.session

    if session is not None:
        title = f'{session.title} — {meeting.title}'
        ends = session.starts_at + timezone.timedelta(minutes=session.duration_minutes)
        where = session.hall or ''
        details = (
            f'Session in {meeting.title}. '
            f'Meeting code {meeting.meeting_code}.'
        )
        if session.speaker_name:
            details = f'{session.speaker_name} — ' + details
    else:
        title = meeting.title
        ends = meeting.scheduled_end
        where = ''
        details = f'Meeting code {meeting.meeting_code}.'

    return {
        'id': str(reminder.id),
        'kind': reminder.kind,
        'meeting_id': str(meeting.id),
        'meeting_code': meeting.meeting_code,
        'meeting_title': meeting.title,
        'session_id': str(session.id) if session else None,
        'session_title': session.title if session else None,
        'speaker_name': session.speaker_name if session else '',
        'hall': where,
        'starts_at': reminder.starts_at,
        'ends_at': ends,
        'due_at': reminder.due_at,
        'is_due': reminder.is_due,
        'read': reminder.read_at is not None,
        'lead_minutes': (
            SESSION_LEAD_MINUTES if session is not None else MEETING_LEAD_MINUTES
        ),
        'calendar_url': calendar_link(
            title=title,
            starts_at=reminder.starts_at,
            ends_at=ends,
            details=details,
            location=where,
        ),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_reminders(request):
    """Everything this person is owed a nudge about.

    Generated on read as well as on a timer, so somebody who has just been
    added to a programme sees it without waiting for the next sweep.
    """
    from src.apps.meetings.access import meetings_visible_to
    from src.apps.meetings.models import Meeting
    from src.apps.meetings.reminders import generate_for_meeting

    upcoming = Meeting.objects.filter(
        meetings_visible_to(request.user),
        scheduled_end__gte=timezone.now(),
    ).exclude(status=Meeting.Status.ENDED).distinct()

    for meeting in upcoming:
        generate_for_meeting(meeting)

    # Today's earlier nudges stay in the list rather than vanishing the
    # moment a session begins: somebody opening the page at noon wants to
    # see what they were called to this morning, not an empty screen.
    mine = (
        Reminder.objects.filter(
            user=request.user,
            starts_at__gte=timezone.now() - timedelta(hours=LOOKBACK_HOURS),
        )
        .select_related('meeting', 'session')
        .order_by('starts_at')
    )
    rows = [_as_json(r) for r in mine]

    # Anything already due has now been shown, which is what delivery means
    # for a reminder somebody reads rather than receives.
    Reminder.objects.filter(
        id__in=[r.id for r in mine if r.is_due], delivered_at__isnull=True
    ).update(delivered_at=timezone.now())

    return Response({
        'reminders': rows,
        'unread': sum(1 for r in rows if r['is_due'] and not r['read']),
        'meeting_lead_minutes': MEETING_LEAD_MINUTES,
        'session_lead_minutes': SESSION_LEAD_MINUTES,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_reminders_read(request):
    """Put the badge down. Either one reminder, or all of them."""
    mine = Reminder.objects.filter(user=request.user, read_at__isnull=True)

    one = request.data.get('id')
    if one:
        mine = mine.filter(id=one)

    marked = mine.update(read_at=timezone.now())
    return Response({'marked': marked})
