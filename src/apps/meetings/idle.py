"""Letting go of somebody who has stopped being in the room.

A socket held open is not a person present. A tab left running in a
window nobody is looking at keeps its connection all afternoon, and
counting that as attendance is how a register comes to say somebody sat
through a talk they walked out of ten minutes into.

So the room watches for activity rather than for connection, and after a
stretch of nothing it lets the person go and writes down when they
stopped - not when the sweep happened to notice.
"""
import logging

from django.utils import timezone

logger = logging.getLogger(__name__)

#: How long a host gets by default, and the longest they may ask for.
IDLE_MINUTES = 15
MAX_IDLE_MINUTES = 240


def timeout_for(event) -> int:
    """How long this event's host lets somebody sit idle, in minutes.

    Zero means the host has turned it off, and nobody is let go.
    """
    account = getattr(event.host, 'host_account', None)
    if account is None:
        return IDLE_MINUTES
    return int(account.idle_timeout_minutes)


def evict_idle(event, now=None) -> int:
    """Let go of everybody in this event who has gone quiet. Returns how many.

    The time written down is when they were last doing something plus the
    grace they were allowed - not the moment this ran. The two are
    different, and the second is a property of when a worker happened to
    wake up rather than anything about the person: somebody who went
    quiet at five past, with a quarter of an hour's grace, left at twenty
    past whether this sweep runs at twenty past or at half past.

    The host is left alone. Somebody has to be able to hold a room open
    while the hall fills, and the host is the one person whose leaving
    would strand everybody else.
    """
    minutes = timeout_for(event)
    if minutes <= 0:
        return 0

    now = now or timezone.now()
    grace = timezone.timedelta(minutes=minutes)
    cutoff = now - grace

    from src.apps.meetings.models import EventParticipant

    quiet = event.participants.filter(is_active=True).exclude(
        role=EventParticipant.Role.HOST
    ).exclude(user_id=event.host_id)

    let_go = 0
    for person in quiet:
        # Somebody who has never said anything is measured from when they
        # arrived, which is the last thing they are known to have done.
        since = person.last_seen_at or person.joined_at
        if since is None or since > cutoff:
            continue

        person.is_active = False
        person.left_at = since + grace
        person.save(update_fields=['is_active', 'left_at'])
        let_go += 1

        _tell_them(event, person)

    let_go += _let_go_of_guests(event, cutoff, grace)

    if let_go:
        logger.info(f"Let go of {let_go} idle attendee(s) in {event.code}")
    return let_go


def _let_go_of_guests(event, cutoff, grace) -> int:
    """The same rule for somebody who came in by the door.

    A guest holds a socket open exactly the way an account holder does,
    so counting one as present and not the other would make the register
    say two different things about the same afternoon.
    """
    from src.apps.meetings.models import GuestAttendee

    let_go = 0
    quiet = event.guests.filter(status=GuestAttendee.Status.ADMITTED)
    for guest in quiet:
        since = guest.last_seen_at or guest.created_at
        if since is None or since > cutoff:
            continue

        guest.status = GuestAttendee.Status.LEFT
        guest.left_at = since + grace
        guest.save(update_fields=['status', 'left_at', 'updated_at'])
        let_go += 1
        _tell_guest(event, guest)

    return let_go


def _tell_guest(event, guest) -> None:
    """Say so down the guest's own channel."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return

    try:
        async_to_sync(layer.group_send)(
            f'event_{event.code}_guest_{guest.id}',
            {
                'type': 'idle_evicted',
                'reason': 'idle',
                'left_at': guest.left_at.isoformat(),
            },
        )
    except Exception:
        logger.debug(f"Could not reach guest {guest.id} to say they were let go")


def _tell_them(event, person) -> None:
    """Say so over the socket, so the room closes rather than just going stale.

    Without this the row says they left and their screen does not, which
    is worse than either: they carry on watching a room that no longer
    counts them, and nothing tells them why their questions stop landing.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return

    room = f'event_{event.code}'
    try:
        async_to_sync(layer.group_send)(
            f'{room}_user_{person.user_id}',
            {
                'type': 'idle_evicted',
                'reason': 'idle',
                'left_at': person.left_at.isoformat(),
            },
        )
    except Exception:
        # A room nobody is connected to is the ordinary case here - the
        # person shut the tab - and it must not stop the register being
        # written.
        logger.debug(f"Could not reach {person.user_id} to say they were let go")
