import { Pair } from './i18n';

/**
 * What a session's state actually reads as.
 *
 * The stored status says what was done to a session, not what became of
 * it. A session nobody ever put on stage stays 'scheduled' for ever, and
 * calling that "upcoming" a week later is simply wrong: its slot came and
 * went without it happening.
 */
export type SessionState = 'upcoming' | 'live' | 'finished' | 'never-started' | 'skipped';

interface Timed {
  status: string;
  starts_at: string;
  duration_minutes: number;
}

export const sessionState = (session: Timed, now: number = Date.now()): SessionState => {
  if (session.status === 'live') return 'live';
  if (session.status === 'done') return 'finished';
  if (session.status === 'skipped') return 'skipped';

  // Still scheduled. Whether that means "yet to come" or "never happened"
  // depends only on whether its slot has passed.
  const endsAt = +new Date(session.starts_at) + session.duration_minutes * 60000;
  return now > endsAt ? 'never-started' : 'upcoming';
};

export const SESSION_STATE_LABEL: Record<SessionState, Pair> = {
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
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
  live: 'live',
  finished: 'ok',
  'never-started': 'draft',
  skipped: 'draft',
};

/** A session that is over, whether it ran or not. */
export const isPast = (state: SessionState) =>
  state === 'finished' || state === 'never-started' || state === 'skipped';
