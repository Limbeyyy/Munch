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
        'id', 'full_name'
    )
    for guest_id, guest_name in admitted_guests:
        # The name goes down with the seat. The guest's own row is
        # forgotten when the meeting ends, and the register has to still
        # say who was there.
        _, created = SessionAttendance.objects.get_or_create(
            session=session, guest_id=guest_id,
            defaults={'guest_name': guest_name},
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

    forget_guests(meeting)
    return left + sent_home


def record_guest_attendance(meeting, name, when=None):
    """Write a guest's name on the meeting's own register.

    Called the moment the host admits somebody, because that is when they
    were in the hall - and because their row will not be here later to ask.
    The register belongs to the meeting: it says who attended this
    afternoon, and it is not a list of people that anything else can join
    to. Idempotent, so a guest who drops out and comes back is one name.
    """
    now = when or timezone.now()
    register = list(meeting.guest_attendance or [])
    if any((entry.get('name') or '').casefold() == name.casefold() for entry in register):
        return False
    register.append({'name': name, 'at': now.isoformat()})
    meeting.guest_attendance = register
    meeting.save(update_fields=['guest_attendance', 'updated_at'])
    return True


def guests_who_attended(meeting):
    """The guests this meeting had, whether or not their rows are still here.

    While it is running they are the admitted rows; afterwards they are the
    register, which is all that is kept. One reader for both so a report
    written during the meeting and the same report a week later do not
    disagree about who was there.
    """
    register = [
        {'name': entry.get('name') or 'Guest', 'at': entry.get('at')}
        for entry in (meeting.guest_attendance or [])
        if (entry.get('name') or '').strip()
    ]
    if register:
        return register

    # Nothing written down: a meeting from before the register existed, or
    # one whose guests are still in the room.
    return [
        {'name': guest.full_name, 'at': (guest.decided_at or guest.created_at).isoformat()}
        for guest in meeting.guests.filter(
            status__in=[GuestAttendee.Status.ADMITTED, GuestAttendee.Status.LEFT]
        ).order_by('created_at')
    ]


def forget_guests(meeting):
    """Delete the guest rows once the meeting they belonged to is over.

    A guest gave a name at a door to sit in a hall for an afternoon. That
    is not a relationship with this platform, and a row about them sitting
    in the database for years afterwards would quietly make it one - so
    they are kept for exactly as long as the meeting and then forgotten.

    What survives is the register: their name against the sessions they
    were actually present for, which is attendance and nothing else. It
    was written when each session closed, which is why this can only be
    called after that has happened.

    The meeting's own list of who attended is topped up here before
    anything is deleted. It is normally written the moment the host admits
    somebody, but this is the last point at which the rows exist to be
    asked, so it is also the place that cannot miss one.
    """
    for guest in meeting.guests.filter(
        status__in=[GuestAttendee.Status.ADMITTED, GuestAttendee.Status.LEFT]
    ).order_by('created_at'):
        record_guest_attendance(meeting, guest.full_name, guest.decided_at)

    # What they wrote outlives them, so it keeps their name rather than a
    # pointer to a row that is about to go. A question asked from the floor
    # belongs to the meeting - it may be on the board already - and the
    # host should still be able to put it up, or read who asked it.
    from src.apps.meetings.models import ChatMessage

    for guest in meeting.guests.all():
        ChatMessage.objects.filter(guest_sender=guest).update(
            guest_sender_name=guest.full_name
        )
        ChatMessage.objects.filter(guest_recipient=guest).update(
            guest_recipient_name=guest.full_name
        )

    gone, _ = GuestAttendee.objects.filter(meeting=meeting).delete()
    if gone:
        logger.info(
            f"Forgot {gone} guest row(s) from {meeting.meeting_code}; "
            f"their names stay in the register"
        )
    return gone


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


# Nor does anything here end a meeting by the clock.
#
# There was a rule for that too: a meeting whose window had passed with
# nothing left to run closed itself, and every read of the meeting checked
# it. It went the same way as the session rule and for the same reason - a
# closing time is a plan, and a room with people in it is not a plan. The
# host ends the meeting. Until they do, it is happening.


# Nothing here ends a session by the clock, and nothing anywhere else
# does either.
#
# There used to be a sweep: anything still on stage past the slot it was
# given was closed, first at the stroke of its hour and later after half a
# day's grace. Both were wrong for the same reason. A session's end time
# is a plan - a prefix, a formality, something to print on a programme -
# and the timetable already corrects itself against what actually happens.
# The talk itself ends when the host ends it. A speaker still speaking is
# still speaking whatever the clock says, and taking the stage out from
# under them because a number passed is not a rule, it is a bug with a
# schedule attached.
#
# So a live session stays live until somebody says otherwise. The host
# ends it, or ends the meeting; either way it is a person's decision, and
# there is no longer any code that makes it for them.


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
