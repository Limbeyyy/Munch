import { sessionState, meetingState, isPast } from '../sessionState';

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

describe('an overrun session, and whether that is final', () => {
  const overrun = s('scheduled', 9);   // 09:00-10:00, and it is now 12:00

  it('reads as never started when nothing says otherwise', () => {
    expect(sessionState(overrun, NOW)).toBe('never-started');
  });

  it('is only overdue while its meeting is still running', () => {
    // The host is in the room; this can still go on stage. Calling it
    // "never started" here contradicts the meeting's own state, which is
    // exactly the inconsistency this guards against.
    expect(sessionState(overrun, NOW, { status: 'active' })).toBe('overdue');
  });

  it('is overdue while its meeting has not begun either', () => {
    expect(sessionState(overrun, NOW, { status: 'scheduled' })).toBe('overdue');
  });

  it('becomes never started once the meeting is over', () => {
    expect(sessionState(overrun, NOW, { status: 'ended' })).toBe('never-started');
  });

  it('does not count as past while it can still run', () => {
    expect(isPast(sessionState(overrun, NOW, { status: 'active' }))).toBe(false);
    expect(isPast(sessionState(overrun, NOW, { status: 'ended' }))).toBe(true);
  });

  it('says nothing about a session that already ran', () => {
    expect(sessionState(s('done', 9), NOW, { status: 'active' })).toBe('finished');
    expect(sessionState(s('live', 9), NOW, { status: 'active' })).toBe('live');
  });
});

describe('what a meeting reads as', () => {
  const m = (status: string, endHour: number, started = true) => ({
    status,
    scheduled_end: at(endHour),
    started_at: started ? at(endHour - 1) : null,
  });

  it('is live while it is running', () => {
    expect(meetingState(m('active', 14), NOW)).toBe('live');
  });

  it('is upcoming while its window is still ahead', () => {
    expect(meetingState(m('scheduled', 14, false), NOW)).toBe('upcoming');
  });

  it('is finished when it ran and ended', () => {
    expect(meetingState(m('ended', 10), NOW)).toBe('finished');
  });

  it('never started when it was closed without ever running', () => {
    // Closed automatically once its time ran out, with nobody having
    // opened it. Calling that "Finished" claims something happened.
    expect(meetingState(m('ended', 10, false), NOW)).toBe('never-started');
  });

  it('never started when its window went by while it sat scheduled', () => {
    expect(meetingState(m('scheduled', 10, false), NOW)).toBe('never-started');
  });
});
