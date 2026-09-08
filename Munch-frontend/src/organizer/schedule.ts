import { EventMeeting, Session } from '../types';

/** The least breathing room left between one slot and the next. */
export const GAP_MINUTES = 15;
/** Kept under the old name so existing callers still read well. */
export const MEETING_GAP_MINUTES = GAP_MINUTES;

const MS = 60000;

export interface PlannedSession {
  id: string;
  meetingId: string;
  title: string;
  speaker_name: string;
  hall: string;
  status: Session['status'];
  startsAt: number;
  durationMinutes: number;
  /** What the server currently holds, so a change can be recognised. */
  baseStartsAt: number;
  baseDurationMinutes: number;
  baseHall: string;
  moved: boolean;
}

export interface PlannedMeeting {
  id: string;
  title: string;
  meetingCode: string;
  status: EventMeeting['status'];
  startsAt: number;
  endsAt: number;
  baseStartsAt: number;
  baseEndsAt: number;
  moved: boolean;
  sessions: PlannedSession[];
}

/** A session that has run, or is running, has a real time and keeps it. */
const isSettled = (s: PlannedSession) => s.status !== 'scheduled';
/** Likewise a meeting already under way cannot be moved. */
const isUnderway = (m: PlannedMeeting) => m.status === 'active' || m.status === 'ended';

const endOf = (s: PlannedSession) => s.startsAt + s.durationMinutes * MS;

/** Anything about this session that differs from what the server holds. */
const hasChanged = (s: PlannedSession) =>
  s.startsAt !== s.baseStartsAt ||
  s.durationMinutes !== s.baseDurationMinutes ||
  s.hall !== s.baseHall;

export const toPlan = (meetings: EventMeeting[]): PlannedMeeting[] =>
  [...meetings]
    .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))
    .map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      meetingCode: meeting.meeting_code,
      status: meeting.status,
      startsAt: +new Date(meeting.scheduled_start),
      endsAt: +new Date(meeting.scheduled_end),
      baseStartsAt: +new Date(meeting.scheduled_start),
      baseEndsAt: +new Date(meeting.scheduled_end),
      moved: false,
      sessions: [...meeting.sessions]
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .map((session) => ({
          id: session.id,
          meetingId: meeting.id,
          title: session.title,
          speaker_name: session.speaker_name,
          hall: session.hall ?? '',
          status: session.status,
          startsAt: +new Date(session.starts_at),
          durationMinutes: session.duration_minutes,
          baseStartsAt: +new Date(session.starts_at),
          baseDurationMinutes: session.duration_minutes,
          baseHall: session.hall ?? '',
          moved: false,
        })),
    }));

/** Every session in the day, earliest first, whichever meeting holds it. */
const underwayMeetings = (plan: PlannedMeeting[]) =>
  new Set(plan.filter(isUnderway).map((m) => m.id));

const allSessions = (plan: PlannedMeeting[]): PlannedSession[] =>
  plan.flatMap((m) => m.sessions).sort((a, b) => a.startsAt - b.startsAt);

/** Put the day's sessions back into the meetings that own them. */
const regroup = (plan: PlannedMeeting[], sessions: PlannedSession[]): PlannedMeeting[] => {
  const byMeeting: Record<string, PlannedSession[]> = {};
  sessions.forEach((s) => {
    (byMeeting[s.meetingId] ||= []).push(s);
  });

  return plan
    .map((meeting) => {
      const own = (byMeeting[meeting.id] ?? []).sort((a, b) => a.startsAt - b.startsAt);
      if (own.length === 0) return { ...meeting, sessions: own };

      // A meeting exists to hold its running order, so its window is that span.
      const startsAt = Math.min(...own.map((s) => s.startsAt));
      const endsAt = Math.max(...own.map(endOf));
      return {
        ...meeting,
        sessions: own,
        startsAt,
        endsAt,
        moved: startsAt !== meeting.baseStartsAt || endsAt !== meeting.baseEndsAt,
      };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
};

/**
 * Settle collisions by moving things later, never earlier.
 *
 * Anything already settled - a session that has run, or any session inside
 * a meeting that is under way - is an obstacle rather than a participant:
 * it holds its time and the movable sessions go round it.
 *
 * A session forced to move goes to the earliest point it legally can, which
 * is the nearest free time rather than a shuffle of the whole day. Gaps the
 * organizer left survive as long as nothing collides with them; once
 * something does, the day closes up to the minimum.
 */
const resolve = (
  sessions: PlannedSession[],
  underway: Set<string>,
  anchoredId?: string
): PlannedSession[] => {
  const fixedBy = (s: PlannedSession) => isSettled(s) || underway.has(s.meetingId);

  const fixed = sessions.filter(fixedBy).sort((a, b) => a.startsAt - b.startsAt);
  const movable = sessions.filter((s) => !fixedBy(s)).sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt - b.startsAt;
    // On a tie the session just placed by hand takes the earlier slot.
    if (a.id === anchoredId) return -1;
    if (b.id === anchoredId) return 1;
    return 0;
  });

  const placed: PlannedSession[] = [];
  let previousEnd: number | null = null;

  movable.forEach((session) => {
    const length = session.durationMinutes * MS;
    let startsAt = session.startsAt;

    if (previousEnd !== null) {
      startsAt = Math.max(startsAt, previousEnd + GAP_MINUTES * MS);
    }

    // Step past anything immovable this would land on, and keep stepping:
    // clearing one obstacle can walk it straight into the next.
    let clear = false;
    while (!clear) {
      clear = true;
      for (const block of fixed) {
        const blockEnd = endOf(block);
        const clashes =
          startsAt < blockEnd + GAP_MINUTES * MS &&
          startsAt + length + GAP_MINUTES * MS > block.startsAt;
        if (clashes) {
          startsAt = blockEnd + GAP_MINUTES * MS;
          clear = false;
        }
      }
    }

    placed.push({ ...session, startsAt });
    previousEnd = startsAt + length;
  });

  return [...placed, ...fixed]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((s) => ({
      ...s,
      moved: hasChanged(s),
    }));
};

/** Push meetings apart if a reflow left them touching. */
const separate = (plan: PlannedMeeting[]): PlannedMeeting[] => {
  const out = [...plan];
  for (let i = 1; i < out.length; i += 1) {
    const earliest = out[i - 1].endsAt + GAP_MINUTES * MS;
    if (out[i].startsAt < earliest && !isUnderway(out[i])) {
      const shift = earliest - out[i].startsAt;
      out[i] = {
        ...out[i],
        startsAt: out[i].startsAt + shift,
        endsAt: out[i].endsAt + shift,
        moved: true,
        sessions: out[i].sessions.map((s) =>
          isSettled(s)
            ? s
            : { ...s, startsAt: s.startsAt + shift, moved: true }
        ),
      };
    }
  }
  return out;
};

/**
 * Move a session to a new start, or change how long it runs.
 *
 * Asking for a time another session already starts at is read as swapping
 * the two: the organizer is reordering the day, not stacking it. Any other
 * time places the session there and lets whatever it lands on give way.
 */
export const applyEdit = (
  plan: PlannedMeeting[],
  sessionId: string,
  change: { startsAt?: number; durationMinutes?: number }
): PlannedMeeting[] => {
  const sessions = allSessions(plan);
  const target = sessions.find((s) => s.id === sessionId);
  if (!target || isSettled(target)) return plan;

  const nextStart = change.startsAt ?? target.startsAt;
  const nextDuration = Math.max(5, change.durationMinutes ?? target.durationMinutes);

  // Two sessions trading places: only those two move.
  const occupant =
    change.startsAt !== undefined
      ? sessions.find(
          (s) => s.id !== sessionId && !isSettled(s) && s.startsAt === nextStart
        )
      : undefined;

  if (occupant) {
    const swapped = sessions.map((s) => {
      if (s.id === target.id) return { ...s, startsAt: occupant.startsAt };
      if (s.id === occupant.id) return { ...s, startsAt: target.startsAt };
      return s;
    });
    return separate(regroup(plan, resolve(swapped, underwayMeetings(plan))));
  }

  const edited = sessions.map((s) =>
    s.id === sessionId ? { ...s, startsAt: nextStart, durationMinutes: nextDuration } : s
  );
  return separate(regroup(plan, resolve(edited, underwayMeetings(plan), sessionId)));
};

/** Kept for callers written against the older name. */
export const reflow = applyEdit;

/** Why two sessions cannot change places, or null if they can. */
export type SwapRefusal = 'same' | 'other-meeting' | 'settled' | null;

export const whyNotSwap = (
  plan: PlannedMeeting[],
  aId: string,
  bId: string
): SwapRefusal => {
  const sessions = allSessions(plan);
  const a = sessions.find((s) => s.id === aId);
  const b = sessions.find((s) => s.id === bId);
  if (!a || !b || a.id === b.id) return 'same';
  if (a.meetingId !== b.meetingId) return 'other-meeting';
  // A session that has run, or is running, has a real time and keeps it.
  if (isSettled(a) || isSettled(b)) return 'settled';
  const meeting = plan.find((m) => m.id === a.meetingId);
  if (meeting && isUnderway(meeting)) return 'settled';
  return null;
};

/**
 * Two sessions change places, each taking the other's slot.
 *
 * Which is what dragging one onto the other means: the running order is
 * rearranged, the times stay where they were. Written as a start-time edit
 * because that is already how the schedule recognises a swap - a session
 * given the time another one holds trades with it - so the reflow, the
 * gaps and the pinned first session all keep working without a second set
 * of rules to disagree with the first.
 */
export const swapSessions = (
  plan: PlannedMeeting[],
  aId: string,
  bId: string
): PlannedMeeting[] => {
  if (whyNotSwap(plan, aId, bId) !== null) return plan;
  const target = allSessions(plan).find((s) => s.id === bId)!;
  return applyEdit(plan, aId, { startsAt: target.startsAt });
};

/** Put a session in a different hall. Nothing else about the day changes. */
export const setHall = (
  plan: PlannedMeeting[],
  sessionId: string,
  hall: string
): PlannedMeeting[] =>
  plan.map((meeting) => ({
    ...meeting,
    sessions: meeting.sessions.map((s) =>
      s.id === sessionId ? { ...s, hall, moved: hasChanged({ ...s, hall }) } : s
    ),
  }));

/** Every hall already in use, for suggesting one rather than retyping it. */
export const hallsInUse = (plan: PlannedMeeting[]): string[] => {
  const seen: string[] = [];
  plan.forEach((m) =>
    m.sessions.forEach((s) => {
      const hall = s.hall.trim();
      if (hall && !seen.includes(hall)) seen.push(hall);
    })
  );
  return seen.sort();
};

/** Move a whole meeting, running order and all. */
export const reflowMeeting = (
  plan: PlannedMeeting[],
  meetingId: string,
  startsAt: number
): PlannedMeeting[] => {
  const meeting = plan.find((m) => m.id === meetingId);
  if (!meeting || isUnderway(meeting)) return plan;

  const shift = startsAt - meeting.startsAt;
  if (shift === 0) return plan;

  const sessions = allSessions(plan).map((s) =>
    s.meetingId === meetingId && !isSettled(s) ? { ...s, startsAt: s.startsAt + shift } : s
  );
  return separate(regroup(plan, resolve(sessions, underwayMeetings(plan))));
};

export const pendingChanges = (plan: PlannedMeeting[]) => ({
  sessions: plan.flatMap((m) => m.sessions.filter((s) => s.moved)),
  meetings: plan.filter((m) => m.moved),
});

export const countChanges = (plan: PlannedMeeting[]) => {
  const { sessions, meetings } = pendingChanges(plan);
  return sessions.length + meetings.length;
};
