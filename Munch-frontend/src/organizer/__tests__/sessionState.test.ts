import { sessionState, isPast } from '../sessionState';

const NOW = Date.UTC(2026, 8, 20, 12, 0);
const at = (h: number) => new Date(Date.UTC(2026, 8, 20, h, 0)).toISOString();

const s = (status: string, hour: number, mins = 60) => ({
  status, starts_at: at(hour), duration_minutes: mins,
});

describe('what a session reads as', () => {
  it('is upcoming while its slot is still ahead', () => {
    expect(sessionState(s('scheduled', 14), NOW)).toBe('upcoming');
  });

  it('is still upcoming while its slot is running', () => {
    // Started at 11:30, an hour long: its slot has not passed yet.
    expect(sessionState({ status: 'scheduled', starts_at: at(11), duration_minutes: 90 }, NOW))
      .toBe('upcoming');
  });

  it('never started once its slot has gone by untouched', () => {
    expect(sessionState(s('scheduled', 9), NOW)).toBe('never-started');
  });

  it('reads the stored state when there is one', () => {
    expect(sessionState(s('live', 9), NOW)).toBe('live');
    expect(sessionState(s('done', 9), NOW)).toBe('finished');
    expect(sessionState(s('skipped', 9), NOW)).toBe('skipped');
  });

  it('does not call a finished session never-started, however old', () => {
    expect(sessionState(s('done', 1), NOW)).toBe('finished');
  });

  it('keeps a session that is live past its slot as live', () => {
    expect(sessionState(s('live', 8), NOW)).toBe('live');
  });

  it('counts everything over as past, run or not', () => {
    expect(isPast('finished')).toBe(true);
    expect(isPast('never-started')).toBe(true);
    expect(isPast('skipped')).toBe(true);
    expect(isPast('upcoming')).toBe(false);
    expect(isPast('live')).toBe(false);
  });
});
