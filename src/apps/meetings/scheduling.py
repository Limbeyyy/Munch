"""The day's timetable, and the rules that keep it from folding in on itself.

This is the server-side counterpart of the organizer's agenda engine
(``Munch-frontend/src/organizer/schedule.ts``) and deliberately follows the
same rules, because the browser cannot be the only thing enforcing them:

* fifteen minutes between one slot and the next, always;
* nothing overlaps;
* the running order is preserved — a session never jumps ahead of one it
  was behind;
* anything already settled (a session that ran, or is running) holds its
  time, and the movable ones go round it.

Two operations, and the difference between them matters:

``check_slot`` is for **new** sessions. A time that breaks the gap is
refused outright, with the earliest legal time named in the error so the
caller can offer it.

``reschedule`` is for **moving** what already exists. Moving one session is
allowed to push the ones after it, which is the behaviour the agenda has
always had; the shift is worked out here and written down in one
transaction so two organizers editing at once cannot leave the day
overlapping.
"""
import logging
from dataclasses import dataclass, replace

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from src.apps.meetings.models import Meeting, Session

logger = logging.getLogger(__name__)

#: The least breathing room left between one slot and the next, where the
#: host has expressed no preference of their own.
GAP_MINUTES = 15
GAP = timezone.timedelta(minutes=GAP_MINUTES)

#: The widest interval worth offering. Beyond a couple of hours the answer
#: is another meeting, not a longer gap.
MAX_GAP_MINUTES = 240


def gap_minutes_for(meeting) -> int:
    """The interval this host keeps between sessions.

    A hall that has to be cleared and re-laid needs longer than a panel
    changing chairs, so the fifteen minutes everybody used to get is now
    only the default. Read from the host rather than the meeting: it is a
    way of working, not a property of one morning.
    """
    account = getattr(getattr(meeting, 'host', None), 'host_account', None)
    if account is None:
        return GAP_MINUTES
    return int(account.session_gap_minutes)


def gap_for(meeting):
    """The same interval, as something to add to a time."""
    return timezone.timedelta(minutes=gap_minutes_for(meeting))

#: No session is worth scheduling for less than this.
MIN_DURATION_MINUTES = 5


@dataclass
class Slot:
    """One session reduced to what scheduling cares about."""
    id: object
    meeting_id: object
    starts_at: object
    duration_minutes: int
    settled: bool
    underway: bool

    @property
    def ends_at(self):
        return self.starts_at + timezone.timedelta(minutes=self.duration_minutes)

    @property
    def fixed(self):
        """Whether this holds its time while everything else moves round it."""
        return self.settled or self.underway


class ScheduleConflict(serializers.ValidationError):
    """Raised where DRF turns it into a 400 the frontend can act on."""

    def __init__(self, message, earliest=None, field='starts_at'):
        body = {
            field: [message],
            'detail': message,
            'code': 'schedule_conflict',
        }
        if earliest is not None:
            body['earliest_start'] = earliest.isoformat()
        super().__init__(body)


def day_sessions(meeting):
    """Every session the timetable has to fit around this one.

    A meeting inside a programme shares its day with the programme's other
    meetings, so the gap has to hold across all of them. A standalone
    meeting only has to answer to itself.
    """
    if meeting.event_id:
        return Session.objects.filter(meeting__event_id=meeting.event_id)
    return Session.objects.filter(meeting_id=meeting.id)


def _slots(sessions, underway_meeting_ids):
    return [
        Slot(
            id=s.id,
            meeting_id=s.meeting_id,
            starts_at=s.starts_at,
            duration_minutes=s.duration_minutes,
            settled=s.status != Session.Status.SCHEDULED,
            underway=s.meeting_id in underway_meeting_ids,
        )
        for s in sessions
    ]


def _underway_meeting_ids(sessions, editing=None):
    """Meetings whose sessions hold their times whatever else moves.

    A finished one always. A meeting under way as well - its day should not
    be moved out from under a room full of people - unless the edit is
    coming from inside it, which is what the room's own running order is:
    the host rearranges what is left of the meeting they are standing in,
    between one talk and the next, and that is the point of it.

    What has actually run, or is running, is fixed either way: those are
    sessions, and they are settled on their own account.
    """
    meeting_ids = {s.meeting_id for s in sessions}
    held = set(
        Meeting.objects.filter(
            id__in=meeting_ids,
            status__in=[Meeting.Status.ACTIVE, Meeting.Status.ENDED],
        ).values_list('id', flat=True)
    )
    if editing is not None:
        ended = set(
            Meeting.objects.filter(
                id__in=meeting_ids, status=Meeting.Status.ENDED
            ).values_list('id', flat=True)
        )
        held = {m for m in held if m != editing or m in ended}
    return held


def resolve(slots, anchored_id=None, gap=GAP):
    """Settle collisions by moving things later, never earlier.

    The mirror of ``resolve`` in the agenda engine. A slot forced to move
    goes to the earliest point it legally can; gaps the organizer left
    survive until something actually collides with them.
    """
    fixed = sorted((s for s in slots if s.fixed), key=lambda s: s.starts_at)

    def order(slot):
        # On a tie the slot just placed by hand takes the earlier position.
        return (slot.starts_at, 0 if slot.id == anchored_id else 1)

    movable = sorted((s for s in slots if not s.fixed), key=order)

    placed = []
    previous_end = None

    for slot in movable:
        starts_at = slot.starts_at
        if previous_end is not None:
            starts_at = max(starts_at, previous_end + gap)

        # Step past anything immovable this would land on, and keep
        # stepping: clearing one obstacle can walk it into the next.
        clear = False
        while not clear:
            clear = True
            for block in fixed:
                length = timezone.timedelta(minutes=slot.duration_minutes)
                clashes = (
                    starts_at < block.ends_at + gap
                    and starts_at + length + gap > block.starts_at
                )
                if clashes:
                    starts_at = block.ends_at + gap
                    clear = False

        placed.append(replace(slot, starts_at=starts_at))
        previous_end = placed[-1].ends_at

    return sorted(placed + fixed, key=lambda s: s.starts_at)


def earliest_start(meeting, before=None, exclude_id=None):
    """The soonest a new session may begin: the last one's end, plus the gap.

    ``before`` limits the question to what runs earlier than a given time,
    which is what a session being slotted into the middle of a day needs.
    Returns ``None`` when nothing runs before it and any time will do.
    """
    query = day_sessions(meeting)
    if exclude_id is not None:
        query = query.exclude(id=exclude_id)

    latest_end = None
    for session in query:
        end = session.starts_at + timezone.timedelta(minutes=session.duration_minutes)
        if before is not None and session.starts_at >= before:
            continue
        if latest_end is None or end > latest_end:
            latest_end = end

    return latest_end + gap_for(meeting) if latest_end else None


def check_slot(meeting, starts_at, duration_minutes, exclude_id=None):
    """Refuse a new slot that breaks the gap or lands on something else.

    Used when a session is being **added**. Moving one that already exists
    goes through :func:`reschedule`, which shifts the rest instead.
    """
    if duration_minutes < MIN_DURATION_MINUTES:
        raise ScheduleConflict(
            f'A session runs for at least {MIN_DURATION_MINUTES} minutes.',
            field='duration_minutes',
        )

    ends_at = starts_at + timezone.timedelta(minutes=duration_minutes)
    gap = gap_for(meeting)
    query = day_sessions(meeting)
    if exclude_id is not None:
        query = query.exclude(id=exclude_id)

    for other in query.select_related('meeting'):
        other_end = other.starts_at + timezone.timedelta(minutes=other.duration_minutes)
        if starts_at < other_end + gap and ends_at + gap > other.starts_at:
            soonest = earliest_start(meeting, exclude_id=exclude_id)
            when = timezone.localtime(other.starts_at).strftime('%H:%M')
            raise ScheduleConflict(
                f'"{other.title}" runs at {when}, and every session needs '
                f'{gap_minutes_for(meeting)} minutes either side of it.',
                earliest=soonest,
            )


def normalise_running_order(sessions, first_start=None, gap=GAP):
    """Space a freshly typed running order so it obeys the gap.

    Applied when a meeting is created with its sessions in one go: the
    organizer's order is kept, and each session is pushed to the earliest
    time that leaves fifteen minutes after the one before it.

    The first session begins exactly when the meeting does. A meeting that
    opens at nine with nothing happening until half past is not a meeting
    that opens at nine - the empty half hour is either a mistake or belongs
    to the meeting's own start time. Putting a different talk first is a
    matter of reordering them, not of leaving a hole at the front.

    ``sessions`` are dicts, in the order they should run. Returns them with
    ``starts_at`` corrected.
    """
    ordered = sorted(sessions, key=lambda s: s['starts_at'])
    previous_end = None

    for session in ordered:
        starts_at = session['starts_at']
        if previous_end is None:
            # The first one opens the meeting, whatever was typed.
            if first_start is not None:
                starts_at = first_start
        else:
            starts_at = max(starts_at, previous_end + gap)
        session['starts_at'] = starts_at
        previous_end = starts_at + timezone.timedelta(
            minutes=session.get('duration_minutes', 30)
        )

    return ordered


@transaction.atomic
def reschedule(meeting, changes, anchored_id=None):
    """Apply timing changes and shift whatever they displace.

    ``changes`` maps a session id to the fields being changed
    (``starts_at``, ``duration_minutes``). Everything scheduled after the
    change moves along to keep the gap; sessions that have run, are
    running, or sit in a meeting already under way hold their times.

    The whole day is locked for the duration, so two organizers saving at
    the same moment cannot interleave into an overlap.

    Returns the sessions whose stored times actually changed.
    """
    locked = list(
        day_sessions(meeting)
        .select_for_update()
        .select_related('meeting')
        .order_by('starts_at', 'position')
    )
    by_id = {s.id: s for s in locked}
    # What the database holds right now, to tell a real move from a no-op
    # once the changes have been folded in.
    before = {
        s.id: (s.starts_at, s.duration_minutes, s.hall) for s in locked
    }

    for session_id, change in changes.items():
        session = by_id.get(session_id)
        if session is None:
            continue
        # A talk that has run, or is on stage, has a real time and keeps
        # it. The agenda already refuses to move one; this is the same rule
        # where it cannot be got round, now that the running order is
        # edited from inside a room with a speaker standing in it.
        if session.status != Session.Status.SCHEDULED:
            if 'hall' in change:
                session.hall = change['hall']
            logger.info(
                f"Left {session.id} where it is: it has already run or is running"
            )
            continue
        if 'starts_at' in change:
            session.starts_at = change['starts_at']
        if 'duration_minutes' in change:
            session.duration_minutes = max(
                MIN_DURATION_MINUTES, int(change['duration_minutes'])
            )
        if 'hall' in change:
            session.hall = change['hall']

    underway = _underway_meeting_ids(locked, editing=meeting.id)
    settled = resolve(
        _slots(locked, underway), anchored_id=anchored_id, gap=gap_for(meeting)
    )

    moved = []
    for slot in settled:
        session = by_id[slot.id]
        session.starts_at = slot.starts_at
        session.duration_minutes = slot.duration_minutes
        if before[slot.id] != (session.starts_at, session.duration_minutes, session.hall):
            session.save(
                update_fields=['starts_at', 'duration_minutes', 'hall', 'updated_at']
            )
            moved.append(session)

    _restretch_meetings(locked)
    return moved


def _restretch_meetings(sessions):
    """A meeting exists to hold its running order, so its window is that span.

    A meeting under way is left alone: moving the window out from under a
    room full of people would be worse than a window that no longer matches.

    An ended one is not left alone. Moving its sessions into the future is
    how somebody says the meeting is going to happen after all, and a
    window still sitting in the past would keep the door shut against the
    very schedule that was just corrected. It is put back to scheduled, and
    the clock from the old sitting is cleared so the room does not count
    from a meeting that finished hours ago.
    """
    by_meeting = {}
    for session in sessions:
        by_meeting.setdefault(session.meeting_id, []).append(session)

    now = timezone.now()
    for meeting_id, own in by_meeting.items():
        meeting = own[0].meeting
        if meeting.status == Meeting.Status.ACTIVE:
            # A room full of people. Its window may grow to hold a running
            # order the host has just lengthened - that is the live
            # tracking the desk shows - but its start is where the day
            # actually began and is not moved out from under anybody.
            stretch_meeting(meeting)
            continue

        starts_at = min(s.starts_at for s in own)
        ends_at = max(
            s.starts_at + timezone.timedelta(minutes=s.duration_minutes) for s in own
        )

        changed = []
        if meeting.scheduled_start != starts_at or meeting.scheduled_end != ends_at:
            meeting.scheduled_start = starts_at
            meeting.scheduled_end = ends_at
            changed += ['scheduled_start', 'scheduled_end']

        # Only a window that has genuinely moved into the future reopens a
        # meeting; touching an old one should not bring it back to life.
        if meeting.status == Meeting.Status.ENDED and ends_at > now:
            meeting.status = Meeting.Status.SCHEDULED
            meeting.started_at = None
            meeting.ended_at = None
            changed += ['status', 'started_at', 'ended_at']

        if changed:
            meeting.save(update_fields=changed + ['updated_at'])


# ---------------------------------------------------------------------------
# The timetable as it actually runs
#
# Everything above this line is about the timetable as it is *planned*: an
# organizer typing times into a form, and the rules that stop the day
# folding in on itself.
#
# What follows is about the day as it *happens*, which is a different
# thing. A session ends when the host says it ends, not when the clock it
# was given runs out, and once that is true the times underneath it can no
# longer be fixed. A talk that runs half an hour long pushes the rest of
# the morning half an hour later; one that finishes early pulls it earlier.
# The running order and the length of each remaining slot are preserved -
# only the whole block slides - because nobody agreed to have their talk
# shortened by somebody else's overrun.
# ---------------------------------------------------------------------------

#: Movements smaller than this are rounding, not a change of plan. Ending a
#: session eleven seconds late should not rewrite the afternoon.
SLIP_TOLERANCE = timezone.timedelta(seconds=30)

#: How far ahead of its hour a meeting or a talk may be opened.
#:
#: Starting early moves the day to now, which is what the host means by it.
#: Half a day early they do not: that is a misclick on next week's meeting,
#: and dragging a programme forward by a week is not something to do
#: quietly. Past this the answer is to move it in the agenda first.
EARLY_START_LIMIT = timezone.timedelta(hours=12)


def _later_sessions(session):
    """The sessions still to come after this one, in order.

    Only ones nobody has run: a session already done or on stage has a
    place in the record and is not moved out from under it.
    """
    from src.apps.meetings.models import Session as _Session

    return list(
        session.meeting.sessions.filter(
            status=_Session.Status.SCHEDULED, starts_at__gt=session.starts_at
        )
        .exclude(id=session.id)
        .order_by('starts_at')
    )


def _slide(sessions, delta):
    """Move a block of sessions by the same amount, keeping their spacing."""
    moved = []
    for session in sessions:
        session.starts_at = session.starts_at + delta
        session.save(update_fields=['starts_at', 'updated_at'])
        moved.append(session)
    return moved


def stretch_meeting(meeting):
    """Grow a meeting's window to hold its running order.

    Only ever outwards. A meeting is a room, and the room stays open for
    the time it was advertised for even if the last talk finished early -
    the host may yet start another. Shrinking the window on an early finish
    would shut the door on the very thing the host is about to do.
    """
    last = None
    for session in meeting.sessions.all():
        end = session.starts_at + timezone.timedelta(minutes=session.duration_minutes)
        if last is None or end > last:
            last = end

    if last is None or not meeting.scheduled_end or last <= meeting.scheduled_end:
        return False

    meeting.scheduled_end = last
    meeting.save(update_fields=['scheduled_end', 'updated_at'])
    return True


def _push_later_meetings(meeting):
    """Move the day's remaining meetings clear of one that has run long.

    Each meeting is its own room, and they run one after another. A morning
    that overran cannot be allowed to sit on top of the afternoon, so the
    meetings behind it are pushed only as far as they have to be: one with
    an hour of slack in front of it does not move at all.

    Meetings that have started, or finished, keep their times - they are
    part of the record now.
    """
    if not meeting.event_id:
        return []

    gap = gap_for(meeting)
    later = list(
        Meeting.objects.filter(
            event_id=meeting.event_id,
            status=Meeting.Status.SCHEDULED,
            scheduled_start__gte=meeting.scheduled_start,
        )
        .exclude(id=meeting.id)
        .order_by('scheduled_start')
    )

    moved = []
    previous_end = meeting.scheduled_end
    for other in later:
        push = (previous_end + gap) - other.scheduled_start
        if push > timezone.timedelta(0):
            _slide(list(other.sessions.order_by('starts_at')), push)
            other.scheduled_start = other.scheduled_start + push
            other.scheduled_end = other.scheduled_end + push
            other.save(
                update_fields=['scheduled_start', 'scheduled_end', 'updated_at']
            )
            moved.append(other)
        previous_end = other.scheduled_end

    return moved


@transaction.atomic
def absorb_overrun(session, actual_end):
    """Write down how long a session really took, and move the rest of the day.

    The length a session was given is a plan; the length it took is a fact,
    and once the host has ended it the fact is what the timetable should
    say. The difference between the two - late or early - is applied to
    everything still to come, so the running order stays contiguous and the
    next speaker's slot is as long as it always was.

    Returns the sessions whose times changed.
    """
    planned_end = session.starts_at + timezone.timedelta(
        minutes=session.duration_minutes
    )
    if abs(actual_end - planned_end) < SLIP_TOLERANCE:
        return []

    ran_for = max(
        MIN_DURATION_MINUTES,
        round((actual_end - session.starts_at).total_seconds() / 60),
    )
    delta = timezone.timedelta(minutes=ran_for - session.duration_minutes)
    if not delta:
        return []

    following = _later_sessions(session)

    session.duration_minutes = ran_for
    session.save(update_fields=['duration_minutes', 'updated_at'])

    moved = _slide(following, delta)
    stretch_meeting(session.meeting)
    _push_later_meetings(session.meeting)
    logger.info(
        f"Session {session.id} ran {delta} against its slot; "
        f"moved {len(moved)} session(s) with it"
    )
    return moved


@transaction.atomic
def begin_now(session, now):
    """Put a talk on stage at this moment, and re-lay what is left after it.

    A session begins when the host starts it. Whatever the timetable said
    is a plan they have just overtaken - early or late - and the rest of
    the running order follows the talk that is actually happening.

    Two things this has to get right, and neither is a simple shift:

    *The wait between talks belongs to nobody.* The host ends one at
    eleven and comes back at twenty-five past; the timetable does not
    quietly eat the half hour by shortening what is left. Everything still
    to run moves down by it, so each speaker keeps the time they were
    given. Nothing moves while the host is away - it moves when they start
    the next talk, because that is the moment the delay is known.

    *The next one need not be the next one.* The host may start C while B
    is still to run - the speaker who is in the hall goes on. Starting a
    talk puts it at the head of what is left; the others queue behind it in
    the order they were in, each keeping the breathing room it was given
    before it.

    Returns every session whose time changed, this one included.
    """
    meeting = session.meeting
    running_order = list(meeting.sessions.order_by('starts_at', 'position'))
    gaps = _lead_gaps(running_order, gap_for(meeting))

    from src.apps.meetings.models import Session as _Session

    others = [
        s for s in running_order
        if s.id != session.id and s.status == _Session.Status.SCHEDULED
    ]

    # Does this one open the meeting? Only then does the meeting's own hour
    # move with it - an early start is the day happening earlier, not just
    # one talk jumping the queue.
    opens_the_day = all(
        s.id == session.id or s.starts_at >= session.starts_at
        for s in running_order
    )
    began_at = session.starts_at

    moved = []
    if abs(now - session.starts_at) >= SLIP_TOLERANCE:
        session.starts_at = now
        session.save(update_fields=['starts_at', 'updated_at'])
        moved.append(session)

    previous_end = now + timezone.timedelta(minutes=session.duration_minutes)
    for other in others:
        target = previous_end + gaps[other.id]
        if abs(target - other.starts_at) >= SLIP_TOLERANCE:
            other.starts_at = target
            other.save(update_fields=['starts_at', 'updated_at'])
            moved.append(other)
        previous_end = target + timezone.timedelta(minutes=other.duration_minutes)

    if opens_the_day and now < began_at:
        # The whole meeting is happening earlier, and lasts as long as it
        # always did: ten to one, started at nine, is nine to twelve.
        shift_meeting_window(meeting, now - meeting.scheduled_start)

    stretch_meeting(meeting)
    _push_later_meetings(meeting)
    if moved:
        logger.info(
            f"Session {session.id} took the stage; "
            f"{len(moved) - 1} other(s) moved behind it"
        )
    return moved


def _lead_gaps(running_order, default_gap):
    """The breathing room each talk was given before it.

    Kept through a rearrangement, so a day with a lunch break in it still
    has one afterwards and a day of back-to-back talks stays back to back.

    The first talk has nothing in front of it, so it has no gap of its own
    to keep. If it ends up behind something else it takes the spacing the
    rest of the day uses - which is the gap to the second talk, and only
    the host's configured interval when there is no second talk to ask.
    """
    gaps = {}
    previous_end = None
    for session in running_order:
        if previous_end is None:
            gaps[session.id] = None  # filled in below
        else:
            gaps[session.id] = max(
                session.starts_at - previous_end, timezone.timedelta(0)
            )
        previous_end = session.starts_at + timezone.timedelta(
            minutes=session.duration_minutes
        )

    if running_order:
        first = running_order[0].id
        second = running_order[1].id if len(running_order) > 1 else None
        gaps[first] = gaps[second] if second is not None else default_gap
    return gaps


def shift_meeting_window(meeting, delta):
    """Move a meeting's own hours, keeping how long it runs for."""
    if not delta:
        return False
    meeting.scheduled_start = meeting.scheduled_start + delta
    if meeting.scheduled_end:
        meeting.scheduled_end = meeting.scheduled_end + delta
    meeting.save(update_fields=['scheduled_start', 'scheduled_end', 'updated_at'])
    return True


@transaction.atomic
def begin_meeting_now(meeting, now):
    """Open a meeting before its hour, and bring its day forward with it.

    Ten to one, started at nine, is nine to twelve: the same three hours,
    an hour earlier. Everything still to run comes with it, keeping its
    length and its place, because a running order that stayed where it was
    would leave the meeting open for an hour with nothing in it.

    Starting *late* moves nothing here. The meeting is simply late, and it
    is the sessions - as each one is started - that say where the day has
    actually got to.
    """
    delta = now - meeting.scheduled_start
    if delta >= -SLIP_TOLERANCE:
        return []

    from src.apps.meetings.models import Session as _Session

    ahead = list(
        meeting.sessions.filter(status=_Session.Status.SCHEDULED).order_by('starts_at')
    )
    moved = _slide(ahead, delta)
    shift_meeting_window(meeting, delta)
    stretch_meeting(meeting)
    logger.info(
        f"Meeting {meeting.meeting_code} opened early; the day moved with it"
    )
    return moved
