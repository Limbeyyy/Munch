import { Event, Session } from '../types';

/**
 * The least breathing room left between one slot and the next, where the
 * host has expressed no preference of their own.
 *
 * The number the day is actually spaced by comes from the host's settings
 * and is passed in; this is what to use before it has been read, and what
 * an installation gets if nobody ever changes it.
 */
export const GAP_MINUTES = 15;

const MS = 60000;

export interface PlannedSession {
  id: string;
  eventId: string;
  title: string;
  speaker_name: string;
  status: Session['status'];
  startsAt: number;
  durationMinutes: number;
  /** What the server currently holds, so a change can be recognised. */
  baseStartsAt: number;
  baseDurationMinutes: number;
  moved: boolean;
}

export interface PlannedEvent {
  id: string;
  title: string;
  eventCode: string;
  status: Event['status'];
  startsAt: number;
  endsAt: number;
  baseStartsAt: number;
  baseEndsAt: number;
  moved: boolean;
  sessions: PlannedSession[];
}

/** A session that has run, or is running, has a real time and keeps it. */
const isSettled = (s: PlannedSession) => s.status !== 'scheduled';
/** A event already under way keeps its own window where it is. */
const isUnderway = (m: PlannedEvent) => m.status === 'active' || m.status === 'ended';
/** A finished event is a record, and records do not move. */
const isFinished = (m: PlannedEvent) => m.status === 'ended';

const endOf = (s: PlannedSession) => s.startsAt + s.durationMinutes * MS;

/** Anything about this session that differs from what the server holds. */
const hasChanged = (s: PlannedSession) =>
  s.startsAt !== s.baseStartsAt ||
  s.durationMinutes !== s.baseDurationMinutes;

export const toPlan = (events: Event[]): PlannedEvent[] =>
  [...events]
    .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))
    .map((event) => ({
      id: event.id,
      title: event.title,
      eventCode: event.code,
      status: event.status,
      startsAt: +new Date(event.scheduled_start),
      endsAt: +new Date(event.scheduled_end),
      baseStartsAt: +new Date(event.scheduled_start),
      baseEndsAt: +new Date(event.scheduled_end),
      moved: false,
      sessions: [...(event.sessions ?? [])]
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .map((session) => ({
          id: session.id,
          eventId: event.id,
          title: session.title,
          speaker_name: session.speaker_name,
          status: session.status,
          startsAt: +new Date(session.starts_at),
          durationMinutes: session.duration_minutes,
          baseStartsAt: +new Date(session.starts_at),
          baseDurationMinutes: session.duration_minutes,
          moved: false,
        })),
    }));

/** Every session in the day, earliest first, whichever event holds it. */
/**
 * Events whose sessions hold their times, whatever else moves.
 *
 * A finished one always. A event under way as well - its day should not
 * shift under a room full of people - *unless the edit is coming from
 * inside it*, which is the case the room's own running order is: the host
 * rearranges what is left of the event they are standing in, between one
 * talk and the next, and that is the point of it. What has already run, or
 * is running, stays put either way; those are settled on their own account.
 */
const fixedEvents = (plan: PlannedEvent[], editing?: string) =>
  new Set(
    plan
      .filter((m) => isFinished(m) || (isUnderway(m) && m.id !== editing))
      .map((m) => m.id)
  );

const allSessions = (plan: PlannedEvent[]): PlannedSession[] =>
  plan.flatMap((m) => m.sessions).sort((a, b) => a.startsAt - b.startsAt);

/** Put the day's sessions back into the events that own them. */
const regroup = (plan: PlannedEvent[], sessions: PlannedSession[]): PlannedEvent[] => {
  const byEvent: Record<string, PlannedSession[]> = {};
  sessions.forEach((s) => {
    (byEvent[s.eventId] ||= []).push(s);
  });

  return plan
    .map((event) => {
      const own = (byEvent[event.id] ?? []).sort((a, b) => a.startsAt - b.startsAt);
      if (own.length === 0) return { ...event, sessions: own };

      // A event exists to hold its running order, so its window is that span.
      const startsAt = Math.min(...own.map((s) => s.startsAt));
      const endsAt = Math.max(...own.map(endOf));
      return {
        ...event,
        sessions: own,
        startsAt,
        endsAt,
        moved: startsAt !== event.baseStartsAt || endsAt !== event.baseEndsAt,
      };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
};

/**
 * Settle collisions by moving things later, never earlier.
 *
 * Anything already settled - a session that has run, or any session inside
 * a event that is under way - is an obstacle rather than a participant:
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
  anchoredId?: string,
  gapMinutes: number = GAP_MINUTES
): PlannedSession[] => {
  const fixedBy = (s: PlannedSession) => isSettled(s) || underway.has(s.eventId);

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
      startsAt = Math.max(startsAt, previousEnd + gapMinutes * MS);
    }

    // Step past anything immovable this would land on, and keep stepping:
    // clearing one obstacle can walk it straight into the next.
    let clear = false;
    while (!clear) {
      clear = true;
      for (const block of fixed) {
        const blockEnd = endOf(block);
        const clashes =
          startsAt < blockEnd + gapMinutes * MS &&
          startsAt + length + gapMinutes * MS > block.startsAt;
        if (clashes) {
          startsAt = blockEnd + gapMinutes * MS;
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

/** Push events apart if a reflow left them touching. */
const separate = (
  plan: PlannedEvent[],
  gapMinutes: number = GAP_MINUTES
): PlannedEvent[] => {
  const out = [...plan];
  for (let i = 1; i < out.length; i += 1) {
    const earliest = out[i - 1].endsAt + gapMinutes * MS;
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
  plan: PlannedEvent[],
  sessionId: string,
  change: { startsAt?: number; durationMinutes?: number },
  gapMinutes: number = GAP_MINUTES
): PlannedEvent[] => {
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

  const held = fixedEvents(plan, target.eventId);

  if (occupant) {
    const swapped = sessions.map((s) => {
      if (s.id === target.id) return { ...s, startsAt: occupant.startsAt };
      if (s.id === occupant.id) return { ...s, startsAt: target.startsAt };
      return s;
    });
    return separate(
      regroup(plan, resolve(swapped, held, undefined, gapMinutes)),
      gapMinutes
    );
  }

  const edited = sessions.map((s) =>
    s.id === sessionId ? { ...s, startsAt: nextStart, durationMinutes: nextDuration } : s
  );
  return separate(
    regroup(plan, resolve(edited, held, sessionId, gapMinutes)),
    gapMinutes
  );
};

/** Kept for callers written against the older name. */
export const reflow = applyEdit;

/** Why two sessions cannot change places, or null if they can. */
export type SwapRefusal = 'same' | 'other-event' | 'settled' | null;

export const whyNotSwap = (
  plan: PlannedEvent[],
  aId: string,
  bId: string
): SwapRefusal => {
  const sessions = allSessions(plan);
  const a = sessions.find((s) => s.id === aId);
  const b = sessions.find((s) => s.id === bId);
  if (!a || !b || a.id === b.id) return 'same';
  if (a.eventId !== b.eventId) return 'other-event';
  // A session that has run, or is running, has a real time and keeps it.
  if (isSettled(a) || isSettled(b)) return 'settled';
  const event = plan.find((m) => m.id === a.eventId);
  if (event && isFinished(event)) return 'settled';
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
  plan: PlannedEvent[],
  aId: string,
  bId: string,
  gapMinutes: number = GAP_MINUTES
): PlannedEvent[] => {
  if (whyNotSwap(plan, aId, bId) !== null) return plan;
  const target = allSessions(plan).find((s) => s.id === bId)!;
  return applyEdit(plan, aId, { startsAt: target.startsAt }, gapMinutes);
};

/** Move a whole event, running order and all. */
export const reflowEvent = (
  plan: PlannedEvent[],
  eventId: string,
  startsAt: number,
  gapMinutes: number = GAP_MINUTES
): PlannedEvent[] => {
  const event = plan.find((m) => m.id === eventId);
  if (!event || isUnderway(event)) return plan;

  const shift = startsAt - event.startsAt;
  if (shift === 0) return plan;

  const sessions = allSessions(plan).map((s) =>
    s.eventId === eventId && !isSettled(s) ? { ...s, startsAt: s.startsAt + shift } : s
  );
  return separate(
    regroup(plan, resolve(sessions, fixedEvents(plan, eventId), undefined, gapMinutes)),
    gapMinutes
  );
};

export const pendingChanges = (plan: PlannedEvent[]) => ({
  sessions: plan.flatMap((m) => m.sessions.filter((s) => s.moved)),
  events: plan.filter((m) => m.moved),
});

export const countChanges = (plan: PlannedEvent[]) => {
  const { sessions, events } = pendingChanges(plan);
  return sessions.length + events.length;
};
