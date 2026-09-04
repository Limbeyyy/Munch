import { EventMeeting, Session } from '../types';

/** The least breathing room left between one meeting and the next. */
export const MEETING_GAP_MINUTES = 15;

const MS = 60000;

export interface PlannedSession {
  id: string;
  title: string;
  speaker_name: string;
  status: Session['status'];
  startsAt: number;
  durationMinutes: number;
  /** True once this row differs from what the server holds. */
  moved: boolean;
}

export interface PlannedMeeting {
  id: string;
  title: string;
  meetingCode: string;
  status: EventMeeting['status'];
  startsAt: number;
  endsAt: number;
  moved: boolean;
  sessions: PlannedSession[];
}

/** Read the event's meetings into a plan that can be reflowed. */
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
      moved: false,
      sessions: [...meeting.sessions]
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .map((session) => ({
          id: session.id,
          title: session.title,
          speaker_name: session.speaker_name,
          status: session.status,
          startsAt: +new Date(session.starts_at),
          durationMinutes: session.duration_minutes,
          moved: false,
        })),
    }));

const sessionEnd = (s: PlannedSession) => s.startsAt + s.durationMinutes * MS;

/**
 * Settle a meeting's own window around the sessions it holds.
 *
 * A meeting exists to contain its running order, so its window is the span
 * of that order. A meeting with nothing in it keeps the window it has.
 */
const fitWindow = (meeting: PlannedMeeting): PlannedMeeting => {
  if (meeting.sessions.length === 0) return meeting;

  const startsAt = Math.min(...meeting.sessions.map((s) => s.startsAt));
  const endsAt = Math.max(...meeting.sessions.map(sessionEnd));
  return {
    ...meeting,
    startsAt,
    endsAt,
    moved: meeting.moved || startsAt !== meeting.startsAt || endsAt !== meeting.endsAt,
  };
};

/** A session that has run, or is running, has a real time and keeps it. */
const isSettled = (session: PlannedSession) => session.status !== 'scheduled';

/** Likewise a meeting that has already started cannot be moved. */
const isUnderway = (meeting: PlannedMeeting) =>
  meeting.status === 'active' || meeting.status === 'ended';

const shiftMeeting = (meeting: PlannedMeeting, byMs: number): PlannedMeeting => {
  if (isUnderway(meeting)) return meeting;
  const sessions = meeting.sessions.map((s) =>
    isSettled(s) ? s : { ...s, startsAt: s.startsAt + byMs, moved: true }
  );
  return {
    ...meeting,
    startsAt: meeting.startsAt + byMs,
    endsAt: meeting.endsAt + byMs,
    moved: true,
    sessions,
  };
};

/**
 * Push later meetings out of the way, keeping the gap they already have.
 *
 * A day is usually shaped deliberately - a long break for lunch, a short
 * one between talks - so an existing gap is preserved and only a gap that
 * has become too small is opened back up to the minimum. Meetings are never
 * pulled earlier: running late does not mean the afternoon starts sooner.
 */
const separate = (meetings: PlannedMeeting[]): PlannedMeeting[] => {
  const out = [...meetings];
  for (let i = 1; i < out.length; i += 1) {
    const previousEnd = out[i - 1].endsAt;
    const earliest = previousEnd + MEETING_GAP_MINUTES * MS;
    if (out[i].startsAt < earliest && !isUnderway(out[i])) {
      out[i] = shiftMeeting(out[i], earliest - out[i].startsAt);
    }
  }
  return out;
};

/**
 * Move one session and let the rest of the day follow.
 *
 * Everything after it in the same meeting shifts by the same amount, which
 * keeps the gaps the organizer put between talks. The meeting's window then
 * resettles, and later meetings are pushed only as far as they must be.
 */
export const reflow = (
  plan: PlannedMeeting[],
  sessionId: string,
  change: { startsAt?: number; durationMinutes?: number }
): PlannedMeeting[] => {
  const meetingIndex = plan.findIndex((m) => m.sessions.some((s) => s.id === sessionId));
  if (meetingIndex < 0) return plan;

  const meeting = plan[meetingIndex];
  const index = meeting.sessions.findIndex((s) => s.id === sessionId);
  const target = meeting.sessions[index];

  const nextStart = change.startsAt ?? target.startsAt;
  const nextDuration = Math.max(5, change.durationMinutes ?? target.durationMinutes);

  // Moving the start carries the rest along; stretching only pushes what
  // comes after, because the sessions before it have not moved.
  const shiftMs =
    (nextStart - target.startsAt) + (nextDuration - target.durationMinutes) * MS;

  const sessions = meeting.sessions.map((session, i) => {
    if (i < index) return session;
    if (i === index) {
      const moved =
        session.moved || nextStart !== session.startsAt || nextDuration !== session.durationMinutes;
      return { ...session, startsAt: nextStart, durationMinutes: nextDuration, moved };
    }
    // What has already happened keeps the time it happened at.
    if (shiftMs === 0 || isSettled(session)) return session;
    return { ...session, startsAt: session.startsAt + shiftMs, moved: true };
  });

  const updated = [...plan];
  updated[meetingIndex] = fitWindow({ ...meeting, sessions });
  return separate(updated);
};

/** Move a whole meeting, running order and all. */
export const reflowMeeting = (
  plan: PlannedMeeting[],
  meetingId: string,
  startsAt: number
): PlannedMeeting[] => {
  const index = plan.findIndex((m) => m.id === meetingId);
  if (index < 0) return plan;

  const shiftMs = startsAt - plan[index].startsAt;
  if (shiftMs === 0) return plan;

  const updated = [...plan];
  updated[index] = shiftMeeting(plan[index], shiftMs);
  return separate(updated);
};

/** Everything that now differs from what the server holds. */
export const pendingChanges = (plan: PlannedMeeting[]) => ({
  sessions: plan.flatMap((m) => m.sessions.filter((s) => s.moved)),
  meetings: plan.filter((m) => m.moved),
});

export const countChanges = (plan: PlannedMeeting[]) => {
  const { sessions, meetings } = pendingChanges(plan);
  return sessions.length + meetings.length;
};
