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
    """The session on stage right now, if any.

    Kept because a caller may want to know what is running, but it no
    longer decides who may come in: see :func:`guest_door_open`.
    """
    from src.apps.meetings.models import Meeting, Session

    now = now or timezone.now()
    if meeting.status == Meeting.Status.ENDED:
        return None
    return (
        meeting.sessions.filter(status=Session.Status.LIVE)
        .order_by('starts_at')
        .first()
    )


def guest_door_open(meeting, now=None) -> bool:
    """Whether a guest may knock at all right now.

    The meeting decides it. A room belongs to a meeting, not to one talk in
    it: it opens a quarter of an hour before the meeting is due, stays open
    across the whole running order - including the gaps between one session
    and the next, when the host is setting up for the following speaker -
    and shuts when the meeting does.

    This used to be keyed to the sessions, which meant a guest admitted for
    the morning was turned away again the moment a talk finished. The
    fifteen minutes are still the rule; they are now counted from the
    meeting rather than from each session.
    """
    return is_open(meeting, now or timezone.now())


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
    """What to say to somebody the door is shut against.

    Two ways it can be shut, and they want different answers: the meeting
    has not opened yet, in which case say when to come back, or it is over,
    in which case there is nothing to come back for.
    """
    from rest_framework import status
    from rest_framework.response import Response
    from src.apps.meetings.models import Meeting

    now = now or timezone.now()

    if meeting.status == Meeting.Status.ENDED:
        return Response(
            {
                'error': 'This meeting has finished.',
                'code': 'no_session_live',
                'opens_at': None,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    return too_early_response(meeting, now)


def can_start(meeting, now=None) -> bool:
    """Whether the host may declare the meeting begun.

    Once the room is open, which is a quarter of an hour before its hour.
    Starting early is not refused any more - it means the meeting is
    happening earlier, and the day is brought forward to match - so the
    button that does it has to be there before the hour, or the host can
    only start early by being late for something else.
    """
    return is_open(meeting, now)


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
