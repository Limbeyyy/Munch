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

#: The least breathing room left between one slot and the next.
GAP_MINUTES = 15
GAP = timezone.timedelta(minutes=GAP_MINUTES)

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


def _underway_meeting_ids(sessions):
    meeting_ids = {s.meeting_id for s in sessions}
    return set(
        Meeting.objects.filter(
            id__in=meeting_ids,
            status__in=[Meeting.Status.ACTIVE, Meeting.Status.ENDED],
        ).values_list('id', flat=True)
    )


def resolve(slots, anchored_id=None):
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
            starts_at = max(starts_at, previous_end + GAP)

        # Step past anything immovable this would land on, and keep
        # stepping: clearing one obstacle can walk it into the next.
        clear = False
        while not clear:
            clear = True
            for block in fixed:
                length = timezone.timedelta(minutes=slot.duration_minutes)
                clashes = (
                    starts_at < block.ends_at + GAP
                    and starts_at + length + GAP > block.starts_at
                )
                if clashes:
                    starts_at = block.ends_at + GAP
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

    return latest_end + GAP if latest_end else None


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
    query = day_sessions(meeting)
    if exclude_id is not None:
        query = query.exclude(id=exclude_id)

    for other in query.select_related('meeting'):
        other_end = other.starts_at + timezone.timedelta(minutes=other.duration_minutes)
        if starts_at < other_end + GAP and ends_at + GAP > other.starts_at:
            soonest = earliest_start(meeting, exclude_id=exclude_id)
            when = timezone.localtime(other.starts_at).strftime('%H:%M')
            raise ScheduleConflict(
                f'"{other.title}" runs at {when}, and every session needs '
                f'{GAP_MINUTES} minutes either side of it.',
                earliest=soonest,
            )


def normalise_running_order(sessions, first_start=None):
    """Space a freshly typed running order so it obeys the gap.

    Applied when a meeting is created with its sessions in one go: the
    organizer's order is kept, and each session is pushed to the earliest
    time that leaves fifteen minutes after the one before it.

    ``sessions`` are dicts, in the order they should run. Returns them with
    ``starts_at`` corrected; anything already late enough is left alone.
    """
    ordered = sorted(sessions, key=lambda s: s['starts_at'])
    previous_end = None

    for session in ordered:
        starts_at = session['starts_at']
        if first_start is not None and previous_end is None:
            starts_at = max(starts_at, first_start)
        if previous_end is not None:
            starts_at = max(starts_at, previous_end + GAP)
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
        if 'starts_at' in change:
            session.starts_at = change['starts_at']
        if 'duration_minutes' in change:
            session.duration_minutes = max(
                MIN_DURATION_MINUTES, int(change['duration_minutes'])
            )
        if 'hall' in change:
            session.hall = change['hall']

    underway = _underway_meeting_ids(locked)
    settled = resolve(_slots(locked, underway), anchored_id=anchored_id)

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
