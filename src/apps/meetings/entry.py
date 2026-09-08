"""When the doors open.

A room is not a thing the host switches on. It opens a quarter of an hour
before the meeting is due and anybody expected can walk in - attendees,
guests once admitted, and the host on the same terms as everyone else.
Nobody waits on anybody else to arrive.

Being open is not the same as being under way. The meeting starts when the
host says it starts, which they can only do once its hour has actually
come; until then the room is a place to gather in.

Late is always fine. Only earliness is refused, and only before the window
opens: turning up at twenty to eleven for an eleven o'clock meeting means
the room is not ready yet, and saying so is kinder than an empty hall.
"""
from django.utils import timezone

#: How long before its scheduled start a room opens.
ENTRY_WINDOW_MINUTES = 15


def opens_at(meeting):
    """The earliest moment anybody may come in."""
    return meeting.scheduled_start - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES)


def is_open(meeting, now=None) -> bool:
    """Whether the room can be entered at all right now.

    A meeting already under way is open whatever the clock says - it is
    happening, and somebody arriving late should not be turned away. One
    that has ended is closed.
    """
    from src.apps.meetings.models import Meeting

    if meeting.status == Meeting.Status.ENDED:
        return False
    if meeting.status == Meeting.Status.ACTIVE:
        return True
    return (now or timezone.now()) >= opens_at(meeting)


def too_early_response(meeting, now=None):
    """What to say to somebody who came before the doors opened."""
    from rest_framework import status
    from rest_framework.response import Response

    when = opens_at(meeting)
    return Response(
        {
            'error': (
                f'This room opens at {timezone.localtime(when):%H:%M}, '
                f'{ENTRY_WINDOW_MINUTES} minutes before the meeting. '
                'It is too early to go in.'
            ),
            'code': 'too_early',
            'opens_at': when.isoformat(),
            'scheduled_start': meeting.scheduled_start.isoformat(),
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def open_session(meeting, now=None):
    """The session the door is open for right now, if any.

    A guest arriving at the door is arriving for a talk, not for a morning:
    the room is a session. So the question is not whether the meeting has
    begun but whether anything is on stage or about to be - one that is
    running, or the next one whose window has opened. In the gap between
    two sessions there is nothing to come in for, which is worth saying
    plainly rather than seating somebody in an empty hall.
    """
    from src.apps.meetings.lifecycle import scheduled_end
    from src.apps.meetings.models import Meeting, Session

    now = now or timezone.now()
    if meeting.status == Meeting.Status.ENDED:
        return None

    for live in meeting.sessions.filter(status=Session.Status.LIVE).order_by('starts_at'):
        # An overrun session is finished whether or not the sweep has been
        # round to close it.
        if now <= scheduled_end(live):
            return live

    ahead = (
        meeting.sessions.filter(status=Session.Status.SCHEDULED)
        .order_by('starts_at')
    )
    for session in ahead:
        if now < opens_at_session(session):
            # The next one is still to open, and everything after it is later.
            return None
        if now <= scheduled_end(session):
            return session

    return None


def guest_door_open(meeting, now=None) -> bool:
    """Whether a guest may knock at all right now.

    Sessions decide it where there are any. A meeting with nothing in its
    running order yet falls back to its own window: it is still a meeting
    that is happening, and refusing everybody from it because the schedule
    has not been filled in would be a stranger answer than letting them in.
    """
    now = now or timezone.now()
    if not meeting.sessions.exists():
        return is_open(meeting, now)
    return open_session(meeting, now) is not None


def opens_at_session(session):
    """The earliest moment anybody may come in for this session."""
    return session.starts_at - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES)


def next_session(meeting, now=None):
    """The next session still to come, for telling somebody when to return."""
    from src.apps.meetings.models import Session

    now = now or timezone.now()
    return (
        meeting.sessions.filter(status=Session.Status.SCHEDULED, starts_at__gte=now)
        .order_by('starts_at')
        .first()
    )


def no_session_response(meeting, now=None):
    """What to say when there is nothing to come in for.

    Either the day has not reached its first talk yet, in which case say
    when to come back, or there is nothing left of it.
    """
    from rest_framework import status
    from rest_framework.response import Response

    now = now or timezone.now()

    # Nothing in the running order: the meeting's own window is all there
    # is to go by, and "the room opens at ten to" is the true answer.
    if not meeting.sessions.exists():
        from src.apps.meetings.models import Meeting

        if meeting.status != Meeting.Status.ENDED:
            return too_early_response(meeting, now)

    coming = next_session(meeting, now)

    if coming is None:
        return Response(
            {
                'error': 'No session is live right now.',
                'code': 'no_session_live',
                'opens_at': None,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    when = opens_at_session(coming)
    return Response(
        {
            'error': (
                f'No session is live right now. “{coming.title}” opens at '
                f'{timezone.localtime(when):%H:%M}, '
                f'{ENTRY_WINDOW_MINUTES} minutes before it starts.'
            ),
            'code': 'no_session_live',
            'opens_at': when.isoformat(),
            'session_title': coming.title,
            'session_starts_at': coming.starts_at.isoformat(),
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def can_start(meeting, now=None) -> bool:
    """Whether the meeting's hour has come.

    Gathering early is one thing; declaring the meeting begun before its
    own start time is another, and the schedule is what everyone else is
    reading.
    """
    return (now or timezone.now()) >= meeting.scheduled_start


def entry_state(meeting, now=None) -> dict:
    """What the room should offer, for the client to render.

    Kept here rather than worked out in the browser so the buttons and the
    rules behind them cannot disagree.
    """
    now = now or timezone.now()
    return {
        'opens_at': opens_at(meeting).isoformat(),
        'scheduled_start': meeting.scheduled_start.isoformat(),
        'is_open': is_open(meeting, now),
        'can_start': can_start(meeting, now),
        'entry_window_minutes': ENTRY_WINDOW_MINUTES,
    }
