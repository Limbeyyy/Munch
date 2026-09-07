"""When a session is over, and what closing one entails.

The rules about a session's lifetime used to sit inside the view that
happened to need them first. They are shared now: the host's "end" button,
the sweep that closes a session whose slot has run out, and the speaker
contact rules all have to agree on what "over" means, and they can only
agree if they read the same function.

The one distinction this module exists to protect: a session the host never
put on stage does **not** become "ended" when its slot passes. It stays
scheduled, and reads as never started. Only something that actually ran can
be closed.
"""
import logging

from django.db import transaction
from django.utils import timezone

from src.apps.meetings.models import Meeting, Session, SessionAttendance

logger = logging.getLogger(__name__)


def scheduled_end(session):
    """When this session was meant to finish."""
    return session.starts_at + timezone.timedelta(minutes=session.duration_minutes)


def session_is_over(session):
    """Whether the speaking is done and the room has moved on."""
    if session.status in (Session.Status.DONE, Session.Status.SKIPPED):
        return True
    if session.status == Session.Status.LIVE:
        return False
    return timezone.now() > scheduled_end(session)


def deadline_passed(session, now=None):
    """Whether this session's slot has been and gone.

    Asked before putting something on stage: a slot that closed yesterday
    cannot be opened today without moving it first.
    """
    now = now or timezone.now()
    return now > scheduled_end(session)


def close_session(session, now):
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


def has_more_to_run(meeting, now=None) -> bool:
    """Whether anything in this meeting could still happen.

    Something on stage, or a session whose slot has not yet run out. A
    session nobody ever started and whose time has been and gone does not
    count - it is missed, not pending, and waiting for it would keep the
    meeting open for ever.
    """
    now = now or timezone.now()

    if meeting.sessions.filter(status=Session.Status.LIVE).exists():
        return True

    for session in meeting.sessions.filter(status=Session.Status.SCHEDULED):
        if now <= scheduled_end(session):
            return True
    return False


def close_meeting_if_spent(meeting, now=None):
    """Close a meeting once nothing in it is still running and its time is up.

    A meeting is only ever ended if it was started: one nobody opened keeps
    whatever state it had, so it can still read as never started.
    """
    now = now or timezone.now()
    if meeting.status != Meeting.Status.ACTIVE:
        return False
    # A meeting is over when its running order is, not when its own window
    # happens to run out. A session still to come is still to come.
    if has_more_to_run(meeting, now):
        return False
    if meeting.scheduled_end and now < meeting.scheduled_end:
        return False

    meeting.status = Meeting.Status.ENDED
    meeting.ended_at = now
    meeting.save(update_fields=['status', 'ended_at', 'updated_at'])
    logger.info(f"Meeting {meeting.meeting_code} closed: its time ran out")
    return True


def sweep_expired(sessions=None, now=None):
    """End anything that is still on stage past the time it was given.

    Only a session that actually started is closed here. One that was never
    put on stage is left exactly as it is, because "never started" and
    "ended" are different things and turning the first into the second
    would quietly invent a meeting that never happened.

    Safe to call often: it is a narrow indexed query that usually matches
    nothing, and it takes each row under a lock before closing it so two
    callers cannot both record attendance.
    """
    now = now or timezone.now()
    queryset = sessions if sessions is not None else Session.objects.all()

    overdue = list(
        queryset.filter(status=Session.Status.LIVE)
        .select_related('meeting')
        .values_list('id', flat=True)
    )
    if not overdue:
        return 0

    closed = 0
    for session_id in overdue:
        with transaction.atomic():
            session = (
                Session.objects.select_for_update()
                .select_related('meeting')
                .filter(id=session_id, status=Session.Status.LIVE)
                .first()
            )
            # Another caller may have closed it between the two queries.
            if session is None or now <= scheduled_end(session):
                continue
            close_session(session, scheduled_end(session))
            closed += 1
            logger.info(f"Session {session.id} closed: its slot ran out")

        broadcast(session.meeting.meeting_code, session, 'session_ended')
        close_meeting_if_spent(session.meeting, now)

    return closed


def broadcast(meeting_code, session, event_type):
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


def current_session(meeting, now=None):
    """The session the room is actually in.

    A room is a session, not a meeting. A meeting is a morning or an
    afternoon and may run for hours; what people are sitting through is one
    talk with its own start and its own end, and that is what the clock on
    the wall should be counting.

    Whatever is on stage, if anything is. Otherwise whatever the timetable
    says is happening at this moment - somebody arriving during a slot has
    arrived for that session even if the host has not pressed anything yet.
    Nothing outside a slot: between sessions the room is between sessions.
    """
    now = now or timezone.now()

    live = meeting.sessions.filter(status=Session.Status.LIVE).order_by('starts_at').first()
    if live is not None:
        return live

    for session in meeting.sessions.order_by('starts_at'):
        if session.starts_at <= now <= scheduled_end(session):
            return session
    return None


def session_room_state(meeting, now=None) -> dict:
    """What the room should show about the session it is holding.

    Worked out here rather than in each client so the two rooms - the one
    account holders use and the one guests use - cannot disagree about
    whose clock is running or when the door shuts.
    """
    now = now or timezone.now()
    session = current_session(meeting, now)

    if session is None:
        # Nothing is running. If a session has just been and gone, say so -
        # somebody opening the page a minute late should be told the talk
        # is over, not left sitting in a room whose clock never starts.
        finished = (
            meeting.sessions.filter(starts_at__lte=now)
            .order_by('-starts_at').first()
        )
        if finished is not None and now > scheduled_end(finished):
            return {
                'id': str(finished.id),
                'title': finished.title,
                'starts_at': finished.starts_at.isoformat(),
                'started_at': (
                    finished.started_at.isoformat() if finished.started_at else None
                ),
                'ends_at': scheduled_end(finished).isoformat(),
                'duration_minutes': finished.duration_minutes,
                'status': finished.status,
                'is_over': True,
            }
        # Nothing has run yet: the room is waiting, not finished.
        return {
            'id': None,
            'title': '',
            'started_at': None,
            'ends_at': None,
            'is_over': False,
        }

    return {
        'id': str(session.id),
        'title': session.title,
        'starts_at': session.starts_at.isoformat(),
        # The clock counts from when it actually went on stage, not from
        # when it was meant to.
        'started_at': session.started_at.isoformat() if session.started_at else None,
        'ends_at': scheduled_end(session).isoformat(),
        'duration_minutes': session.duration_minutes,
        'status': session.status,
        'is_over': session.status in (Session.Status.DONE, Session.Status.SKIPPED),
    }
