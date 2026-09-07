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
