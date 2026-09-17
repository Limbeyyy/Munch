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

/** Just enough of the event to know whether the day is done with it. */
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
 * the event is still going: a session whose slot has slipped can still
 * be put on stage, and saying otherwise while the host is in the room
 * contradicts the event's own state. Pass the event and an overrun
 * session reads as overdue until the event itself is over.
 */
export const sessionState = (
  session: Timed,
  now: number = Date.now(),
  event?: Holder
): SessionState => {
  if (session.status === 'live') return 'live';
  if (session.status === 'done') return 'finished';
  if (session.status === 'skipped') return 'skipped';

  // The event is over and this was never put on stage, so it never
  // happened - whatever its own slot says. Its slot may well still be
  // ahead: the running order slides forward as the day runs late, so a
  // talk nobody reached is often left sitting in the future, and reading
  // that as "upcoming" after the event has ended promises a talk that
  // is not going to happen.
  if (event && event.status === 'ended') return 'never-started';


  const endsAt = +new Date(session.starts_at) + session.duration_minutes * 60000;
  if (now <= endsAt) return 'upcoming';

  // Its slot has passed. Whether that is the end of the story depends on
  // whether the event holding it has finished.
  if (event) return 'overdue';
  return 'never-started';
};

export type EventState = 'upcoming' | 'live' | 'finished' | 'never-started';

interface TimedEvent {
  status: string;
  scheduled_end: string;
  started_at?: string | null;
}

/**
 * What a event's state reads as.
 *
 * Six screens worked this out for themselves and none of them knew that a
 * event can end without ever having run - closed automatically when its
 * time ran out, with nobody having opened it. That reads as "Finished",
 * which claims something happened. It did not.
 */
export const eventState = (
  event: TimedEvent,
  now: number = Date.now()
): EventState => {
  if (event.status === 'active') return 'live';
  if (event.status === 'ended') {
    return event.started_at ? 'finished' : 'never-started';
  }
  // Still scheduled: yet to come, or its window went by without it.
  return now > +new Date(event.scheduled_end) ? 'never-started' : 'upcoming';
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

export const EVENT_STATE_LABEL: Record<EventState, Pair> = {
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
  live: { ne: 'चलिरहेको', en: 'Live' },
  finished: { ne: 'सकियो', en: 'Finished' },
  'never-started': { ne: 'सुरु नै भएन', en: 'Never started' },
};

export const EVENT_STATE_TONE: Record<
  EventState,
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

/**
 * How far ahead of its hour a talk may be put on stage.
 *
 * Starting early is not refused any more: it brings the talk, and the rest
 * of the day, forward to now, which is what the host means by pressing it.
 * Half a day early they do not mean it - that is next week's event being
 * opened by mistake - and the server says the same, so the button is off
 * rather than producing a refusal.
 */
export const EARLY_START_LIMIT_MINUTES = 12 * 60;

/** Whether this talk is close enough to its hour to be started. */
export const startableNow = (
  startsAt: string | number | null | undefined,
  now: number = Date.now()
): boolean => {
  const starts = startsAt ? +new Date(startsAt) : NaN;
  if (!Number.isFinite(starts)) return false;
  return starts - now <= EARLY_START_LIMIT_MINUTES * 60000;
};

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
 * A session on stage always wins: the host started it, and that is the
 * thing that is happening - it holds the desk until they end it, however
 * far past its hour that is. Otherwise the desk holds the first talk still
 * to run, which is the one the host would start next.
 *
 * That one reads as *due* once its time has come and *upcoming* before
 * then, which is all the difference amounts to: whether the start button
 * does anything yet.
 *
 * A slot that slipped by while the host was running behind is still shown.
 * It used to be skipped, on the reasoning that a session whose time had
 * passed was never going to run - but the timetable follows the room now,
 * so the thing to do about a slot that has slipped is to start it, and a
 * desk holding nothing offers no way to.
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

  const next = ahead[0];
  if (!next) return { session: null, state: null };

  return {
    session: next,
    state: +new Date(next.starts_at) <= now ? 'due' : 'upcoming',
  };
};
