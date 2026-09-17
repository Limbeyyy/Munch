"""When the doors open.

A room is not a thing the host switches on. It opens a quarter of an hour
before the event is due and anybody expected can walk in - attendees,
guests once admitted, and the host on the same terms as everyone else.
Nobody waits on anybody else to arrive.

Being open is not the same as being under way. The event starts when the
host says it starts, which they can only do once its hour has actually
come; until then the room is a place to gather in.

Late is always fine. Only earliness is refused, and only before the window
opens: turning up at twenty to eleven for an eleven o'clock event means
the room is not ready yet, and saying so is kinder than an empty hall.
"""
from django.utils import timezone

#: How long before its scheduled start a room opens.
ENTRY_WINDOW_MINUTES = 15


def opens_at(event):
    """The earliest moment anybody may come in."""
    return event.scheduled_start - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES)


def is_open(event, now=None) -> bool:
    """Whether the room can be entered at all right now.

    A event already under way is open whatever the clock says - it is
    happening, and somebody arriving late should not be turned away. One
    that has ended is closed.
    """
    from src.apps.meetings.models import Event

    if event.status == Event.Status.ENDED:
        return False
    if event.status == Event.Status.ACTIVE:
        return True
    return (now or timezone.now()) >= opens_at(event)


def too_early_response(event, now=None):
    """What to say to somebody who came before the doors opened."""
    from rest_framework import status
    from rest_framework.response import Response

    when = opens_at(event)
    return Response(
        {
            'error': (
                f'This room opens at {timezone.localtime(when):%H:%M}, '
                f'{ENTRY_WINDOW_MINUTES} minutes before the event. '
                'It is too early to go in.'
            ),
            'code': 'too_early',
            'opens_at': when.isoformat(),
            'scheduled_start': event.scheduled_start.isoformat(),
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def open_session(event, now=None):
    """The session on stage right now, if any.

    Kept because a caller may want to know what is running, but it no
    longer decides who may come in: see :func:`guest_door_open`.
    """
    from src.apps.meetings.models import Event, Session

    now = now or timezone.now()
    if event.status == Event.Status.ENDED:
        return None
    return (
        event.sessions.filter(status=Session.Status.LIVE)
        .order_by('starts_at')
        .first()
    )


def guest_door_open(event, now=None) -> bool:
    """Whether a guest may knock at all right now.

    The event decides it. A room belongs to a event, not to one talk in
    it: it opens a quarter of an hour before the event is due, stays open
    across the whole running order - including the gaps between one session
    and the next, when the host is setting up for the following speaker -
    and shuts when the event does.

    This used to be keyed to the sessions, which meant a guest admitted for
    the morning was turned away again the moment a talk finished. The
    fifteen minutes are still the rule; they are now counted from the
    event rather than from each session.
    """
    return is_open(event, now or timezone.now())


def opens_at_session(session):
    """The earliest moment anybody may come in for this session."""
    return session.starts_at - timezone.timedelta(minutes=ENTRY_WINDOW_MINUTES)


def next_session(event, now=None):
    """The next session still to come, for telling somebody when to return."""
    from src.apps.meetings.models import Session

    now = now or timezone.now()
    return (
        event.sessions.filter(status=Session.Status.SCHEDULED, starts_at__gte=now)
        .order_by('starts_at')
        .first()
    )


def no_session_response(event, now=None):
    """What to say to somebody the door is shut against.

    Two ways it can be shut, and they want different answers: the event
    has not opened yet, in which case say when to come back, or it is over,
    in which case there is nothing to come back for.
    """
    from rest_framework import status
    from rest_framework.response import Response
    from src.apps.meetings.models import Event

    now = now or timezone.now()

    if event.status == Event.Status.ENDED:
        return Response(
            {
                'error': 'This event has finished.',
                'code': 'no_session_live',
                'opens_at': None,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    return too_early_response(event, now)


def can_start(event, now=None) -> bool:
    """Whether the host may declare the event begun.

    Once the room is open, which is a quarter of an hour before its hour.
    Starting early is not refused any more - it means the event is
    happening earlier, and the day is brought forward to match - so the
    button that does it has to be there before the hour, or the host can
    only start early by being late for something else.
    """
    return is_open(event, now)


def entry_state(event, now=None) -> dict:
    """What the room should offer, for the client to render.

    Kept here rather than worked out in the browser so the buttons and the
    rules behind them cannot disagree.
    """
    now = now or timezone.now()
    return {
        'opens_at': opens_at(event).isoformat(),
        'scheduled_start': event.scheduled_start.isoformat(),
        'is_open': is_open(event, now),
        'can_start': can_start(event, now),
        'entry_window_minutes': ENTRY_WINDOW_MINUTES,
    }
