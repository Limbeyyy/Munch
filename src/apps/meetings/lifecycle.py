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

from src.apps.meetings.models import (
    GuestAttendee, Meeting, MeetingParticipant, Session, SessionAttendance,
)

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


def clear_room(meeting, now=None):
    """Empty the room: nobody is left sitting in a meeting that is over.

    Called after attendance has been taken, never before - the register is
    a snapshot of who is present when a session closes, so clearing the
    room first would record nobody.

    Every way a meeting can end goes through here, because the way this
    went wrong before was not the rule but the number of places that had
    to remember it.
    """
    now = now or timezone.now()

    left = MeetingParticipant.objects.filter(
        meeting=meeting, is_active=True
    ).update(is_active=False, left_at=now)

    # Guests hold no participant row, so their side is closed separately.
    sent_home = GuestAttendee.objects.filter(
        meeting=meeting, status=GuestAttendee.Status.ADMITTED
    ).update(status=GuestAttendee.Status.LEFT)

    return left + sent_home


def broadcast_meeting_ended(meeting, reason='host_ended'):
    """Tell everyone in the room it is over, and why.

    The consumer hangs up after passing this on, so a client that ignores
    the message still leaves - the room is shut for everybody at the same
    moment rather than one browser at a time. Best effort: a meeting that
    has ended in the database has ended whether or not the news got out.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{meeting.meeting_code}',
            {
                'type': 'meeting_ended',
                'reason': reason,
                'ended_at': meeting.ended_at.isoformat() if meeting.ended_at else None,
            },
        )
    except Exception as e:
        logger.warning(
            f"Could not broadcast end of {meeting.meeting_code}: {e}"
        )


def close_meeting_if_spent(meeting, now=None, wait_for_window=True):
    """Close a meeting once nothing in it is still running.

    A meeting is only ever ended if it was started: one nobody opened keeps
    whatever state it had, so it can still read as never started.

    ``wait_for_window`` is what separates the clock running out from the
    host saying so. Left to itself, a meeting whose last session has
    finished early stays open until its own window closes, because the host
    may yet add something. When the host ends the last session by hand
    there is nothing to wait for: they have said the meeting is over, and
    everybody should be told at once rather than at half past.
    """
    now = now or timezone.now()
    if meeting.status != Meeting.Status.ACTIVE:
        return False
    # A meeting is over when its running order is, not when its own window
    # happens to run out. A session still to come is still to come.
    if has_more_to_run(meeting, now):
        return False
    if wait_for_window and meeting.scheduled_end and now < meeting.scheduled_end:
        return False

    meeting.status = Meeting.Status.ENDED
    meeting.ended_at = now
    meeting.save(update_fields=['status', 'ended_at', 'updated_at'])

    # The books were closed here but the room was not, so whoever was still
    # in it stayed there - counted as present in a meeting that had ended.
    clear_room(meeting, now)
    broadcast_meeting_ended(
        meeting, reason='time_elapsed' if wait_for_window else 'host_ended'
    )

    logger.info(
        f"Meeting {meeting.meeting_code} closed: "
        + ('its time ran out' if wait_for_window else 'the host ended its last session')
    )
    return True


#: How long past its slot a session on stage is taken to be abandoned
#: rather than merely running long. A talk can overrun by an hour; a
#: half-day means nobody is in the room and the host never came back.
ABANDONED_AFTER = timezone.timedelta(hours=12)


def sweep_expired(sessions=None, now=None):
    """Close a session that was left on stage and forgotten.

    Not one that is simply running long. A session ends when the host ends
    it - that is the whole of the rule now, and the slot it was given is a
    plan the timetable corrects itself against afterwards. Closing a talk
    because its hour struck would take the stage out from under a speaker
    who is still speaking, and empty a room that is still full.

    So this is only a backstop, for the hall that emptied out on Friday and
    is still showing a live session on Monday. A session nobody ever
    started is untouched either way: "never started" and "ended" are
    different things.

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
            if session is None or now <= scheduled_end(session) + ABANDONED_AFTER:
                continue
            # Recorded as ending when it was meant to, not half a day
            # later: nobody was in the room for the hours in between, and
            # the day is not stretched to cover them.
            close_session(session, scheduled_end(session))
            closed += 1
            logger.info(f"Session {session.id} closed: left on stage and abandoned")

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


def broadcast_schedule_changed(meeting):
    """Tell the room its running order has been rearranged.

    The host edits the timetable from inside the room now - dragging one
    talk above another between sessions - and everybody else's copy has to
    follow without a reload. Best effort, like every other announcement:
    the times in the database are the times whether or not the news got
    out, and the next poll picks them up anyway.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'meeting_{meeting.meeting_code}',
            {
                'type': 'state_update',
                'user_id': '',
                'user_name': '',
                'state': {'schedule_changed': True},
                'timestamp': timezone.now().isoformat(),
            },
        )
    except Exception as e:
        logger.warning(
            f"Could not announce the new running order for "
            f"{meeting.meeting_code}: {e}"
        )


def current_session(meeting, now=None):
    """The session the room is holding, if one is on stage.

    A room is a **meeting**, not a session. The meeting is the morning; the
    sessions are the talks that happen inside it one after another, and the
    room outlives all of them - it opens before the first and stays until
    the host closes the meeting or its window runs out. Between two talks
    the room is still there, waiting for the host to start the next one.

    So this is only ever what is actually on stage. Not "whatever the
    timetable says should be happening": the timetable is a plan, and since
    a session now runs until the host ends it, the plan is no longer
    entitled to put somebody on stage or take them off it. An overrunning
    session is still the session - it is over when it is ended, not when
    its slot runs out.
    """
    now = now or timezone.now()
    return (
        meeting.sessions.filter(status=Session.Status.LIVE)
        .order_by('starts_at')
        .first()
    )


def next_up(meeting, now=None):
    """The next session the host could put on stage, if any is left."""
    return (
        meeting.sessions.filter(status=Session.Status.SCHEDULED)
        .order_by('starts_at')
        .first()
    )


def session_room_state(meeting, now=None) -> dict:
    """What the room should show about the session it is holding.

    Worked out here rather than in each client so the two rooms - the one
    account holders use and the one guests use - cannot disagree about
    whose clock is running.

    Between sessions there is no clock and no title, but there is still a
    room: ``awaiting_next`` says so, and names what is coming. Nobody is
    shown the door because a talk finished - the door is the meeting's.
    """
    now = now or timezone.now()
    session = current_session(meeting, now)

    if session is None:
        coming = next_up(meeting, now)
        ran = meeting.sessions.filter(
            status__in=[Session.Status.DONE, Session.Status.SKIPPED]
        ).exists()
        return {
            'id': None,
            'title': '',
            'starts_at': None,
            'started_at': None,
            'ends_at': None,
            'duration_minutes': None,
            'status': None,
            # The room is not over. Only the meeting can be over, and if it
            # were, nobody would be reading this.
            'is_over': False,
            'between_sessions': ran,
            'awaiting_next': coming is not None,
            'next_id': str(coming.id) if coming else None,
            'next_title': coming.title if coming else '',
            'next_starts_at': coming.starts_at.isoformat() if coming else None,
        }

    return {
        'id': str(session.id),
        'title': session.title,
        'starts_at': session.starts_at.isoformat(),
        # The clock counts from when it actually went on stage, not from
        # when it was meant to.
        'started_at': session.started_at.isoformat() if session.started_at else None,
        # What it was given. It runs past this if the host lets it, and the
        # timetable is corrected afterwards.
        'ends_at': scheduled_end(session).isoformat(),
        'duration_minutes': session.duration_minutes,
        'status': session.status,
        'is_over': False,
        'between_sessions': False,
        'awaiting_next': False,
        'next_id': None,
        'next_title': '',
        'next_starts_at': None,
    }
