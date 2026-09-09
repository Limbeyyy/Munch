import { Pair } from './i18n';

/**
 * What a session's state actually reads as.
 *
 * The stored status says what was done to a session, not what became of
 * it. A session nobody ever put on stage stays 'scheduled' for ever, and
 * calling that "upcoming" a week later is simply wrong: its slot came and
 * went without it happening.
 */
export type SessionState =
  | 'upcoming' | 'live' | 'finished' | 'never-started' | 'skipped' | 'overdue';

interface Timed {
  status: string;
  starts_at: string;
  duration_minutes: number;
}

/** Just enough of the meeting to know whether the day is done with it. */
interface Holder {
  status: string;
}

/**
 * What a session's state reads as.
 *
 * The stored status says what was done to a session, not what became of
 * it. A session nobody ever put on stage stays 'scheduled' for ever, and
 * calling that "upcoming" a week later is simply wrong.
 *
 * But "never started" is a final judgement, and it cannot be made while
 * the meeting is still going: a session whose slot has slipped can still
 * be put on stage, and saying otherwise while the host is in the room
 * contradicts the meeting's own state. Pass the meeting and an overrun
 * session reads as overdue until the meeting itself is over.
 */
export const sessionState = (
  session: Timed,
  now: number = Date.now(),
  meeting?: Holder
): SessionState => {
  if (session.status === 'live') return 'live';
  if (session.status === 'done') return 'finished';
  if (session.status === 'skipped') return 'skipped';

  const endsAt = +new Date(session.starts_at) + session.duration_minutes * 60000;
  if (now <= endsAt) return 'upcoming';

  // Its slot has passed. Whether that is the end of the story depends on
  // whether the meeting holding it has finished.
  if (meeting && meeting.status !== 'ended') return 'overdue';
  return 'never-started';
};

export type MeetingState = 'upcoming' | 'live' | 'finished' | 'never-started';

interface TimedMeeting {
  status: string;
  scheduled_end: string;
  started_at?: string | null;
}

/**
 * What a meeting's state reads as.
 *
 * Six screens worked this out for themselves and none of them knew that a
 * meeting can end without ever having run - closed automatically when its
 * time ran out, with nobody having opened it. That reads as "Finished",
 * which claims something happened. It did not.
 */
export const meetingState = (
  meeting: TimedMeeting,
  now: number = Date.now()
): MeetingState => {
  if (meeting.status === 'active') return 'live';
  if (meeting.status === 'ended') {
    return meeting.started_at ? 'finished' : 'never-started';
  }
  // Still scheduled: yet to come, or its window went by without it.
  return now > +new Date(meeting.scheduled_end) ? 'never-started' : 'upcoming';
};

export const SESSION_STATE_LABEL: Record<SessionState, Pair> = {
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
  overdue: { ne: 'समय नाघ्यो', en: 'Overdue' },
  live: { ne: 'सुरु भयो', en: 'Started' },
  finished: { ne: 'सकियो', en: 'Finished' },
  'never-started': { ne: 'सुरु नै भएन', en: 'Never started' },
  skipped: { ne: 'छाडियो', en: 'Skipped' },
};

/** The chip tone each state reads best in. */
export const SESSION_STATE_TONE: Record<
  SessionState,
  'default' | 'ok' | 'live' | 'warn' | 'draft' | 'lock'
> = {
  upcoming: 'warn',
  overdue: 'warn',
  live: 'live',
  finished: 'ok',
  'never-started': 'draft',
  skipped: 'draft',
};

/** A session that is over, whether it ran or not. */
export const isPast = (state: SessionState) =>
  state === 'finished' || state === 'never-started' || state === 'skipped';

export const MEETING_STATE_LABEL: Record<MeetingState, Pair> = {
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
  live: { ne: 'चलिरहेको', en: 'Live' },
  finished: { ne: 'सकियो', en: 'Finished' },
  'never-started': { ne: 'सुरु नै भएन', en: 'Never started' },
};

export const MEETING_STATE_TONE: Record<
  MeetingState,
  'default' | 'ok' | 'live' | 'warn' | 'draft' | 'lock'
> = {
  upcoming: 'draft',
  live: 'live',
  finished: 'ok',
  'never-started': 'draft',
};

/**
 * How long before a session begins the room opens.
 *
 * The same quarter of an hour the server keeps, stated here so the buttons
 * on a screen and the rules behind them cannot disagree. Coming early is
 * refused, coming late never is.
 */
export const ENTRY_WINDOW_MINUTES = 15;

const MS = 60000;

/** What a screen may offer for a session, and when. */
export interface Doorway {
  /** When the room opens: a quarter of an hour before it starts. */
  opensAt: number;
  /** Whether anybody may go in yet. */
  canEnter: boolean;
  /** Whether the host may declare it begun - not before its own hour. */
  canStart: boolean;
  /** Minutes until it opens, or 0 once it has. */
  untilOpen: number;
  /** Minutes until it starts, or 0 once it has. */
  untilStart: number;
}

export const doorway = (
  startsAt: string | number | null | undefined,
  now: number = Date.now()
): Doorway => {
  const starts = startsAt ? +new Date(startsAt) : NaN;
  if (!Number.isFinite(starts)) {
    return { opensAt: NaN, canEnter: false, canStart: false, untilOpen: 0, untilStart: 0 };
  }

  const opensAt = starts - ENTRY_WINDOW_MINUTES * MS;
  return {
    opensAt,
    canEnter: now >= opensAt,
    canStart: now >= starts,
    untilOpen: Math.max(0, Math.ceil((opensAt - now) / MS)),
    untilStart: Math.max(0, Math.ceil((starts - now) / MS)),
  };
};

/** "in 9 minutes", "in 3 hours", "in 2 days" - how far off something is. */
export const howFarOff = (
  startsAt: string | number,
  now: number = Date.now()
): { amount: number; unit: 'minute' | 'hour' | 'day' } => {
  const minutes = Math.max(0, Math.ceil((+new Date(startsAt) - now) / MS));
  if (minutes < 60) return { amount: minutes, unit: 'minute' };
  if (minutes < 60 * 24) return { amount: Math.round(minutes / 60), unit: 'hour' };
  return { amount: Math.round(minutes / (60 * 24)), unit: 'day' };
};

/** What the desk is holding, and how it should read. */
export type DeskState = 'live' | 'due' | 'upcoming';

export interface Desk<T> {
  session: T | null;
  state: DeskState | null;
}

/**
 * Which session a live desk should be showing, and in what state.
 *
 * A running order moves on. Session A holds the desk until its slot is
 * spent, then B takes it, then C - so a host looking at the desk sees what
 * is happening or what is next, never a slot that came and went hours ago.
 *
 * A session on stage always wins: the host started it, and that is the
 * thing that is happening. Otherwise the desk shows the one whose slot
 * contains this moment - due, and startable - or failing that the next one
 * still ahead, which is shown but cannot be started yet.
 *
 * A scheduled session whose slot has passed is skipped rather than
 * promoted. It was never started, and the agenda still says so; the desk
 * is about what to do now.
 */
export const deskSession = <
  T extends { status: string; starts_at: string; duration_minutes: number }
>(
  sessions: T[],
  now: number = Date.now()
): Desk<T> => {
  const live = sessions.find((s) => s.status === 'live');
  if (live) return { session: live, state: 'live' };

  const ahead = sessions
    .filter((s) => s.status === 'scheduled')
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));

  const endOf = (s: T) =>
    +new Date(s.starts_at) + s.duration_minutes * 60000;

  const due = ahead.find((s) => +new Date(s.starts_at) <= now && now < endOf(s));
  if (due) return { session: due, state: 'due' };

  const next = ahead.find((s) => +new Date(s.starts_at) > now);
  return next ? { session: next, state: 'upcoming' } : { session: null, state: null };
};
