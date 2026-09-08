import { PlannedMeeting, swapSessions, toPlan, whyNotSwap } from '../schedule';
import { EventMeeting } from '../../types';

const at = (hhmm: string) => `2026-09-08T${hhmm}:00Z`;

const session = (id: string, title: string, start: string, minutes = 60, status = 'scheduled') => ({
  id, title, starts_at: at(start), duration_minutes: minutes, status,
  speaker_name: '', hall: '',
} as any);

const meeting = (id: string, start: string, end: string, sessions: any[], status = 'scheduled') => ({
  id, title: `Meeting ${id}`, meeting_code: id.toUpperCase(), status,
  scheduled_start: at(start), scheduled_end: at(end), sessions,
} as unknown as EventMeeting);

/** Session A nine to ten, session B eleven to twelve. */
const day = (): PlannedMeeting[] =>
  toPlan([
    meeting('m1', '09:00', '13:00', [
      session('a', 'Session A', '09:00'),
      session('b', 'Session B', '11:00'),
    ]),
  ]);

const times = (plan: PlannedMeeting[]) =>
  plan[0].sessions.map((s) => [
    s.title,
    new Date(s.startsAt).toISOString().slice(11, 16),
  ]);

describe('two sessions changing places', () => {
  it('gives each the other slot', () => {
    // A 9–10 and B 11–12 become B 9–10 and A 11–12.
    const after = swapSessions(day(), 'b', 'a');

    expect(times(after)).toEqual([
      ['Session B', '09:00'],
      ['Session A', '11:00'],
    ]);
  });

  it('reads the same whichever of the two was dragged', () => {
    expect(times(swapSessions(day(), 'a', 'b'))).toEqual(times(swapSessions(day(), 'b', 'a')));
  });

  it('leaves the rest of the running order alone', () => {
    const plan = toPlan([
      meeting('m1', '09:00', '15:00', [
        session('a', 'Session A', '09:00'),
        session('b', 'Session B', '11:00'),
        session('c', 'Session C', '13:00'),
      ]),
    ]);

    const after = swapSessions(plan, 'a', 'b');

    expect(times(after)).toEqual([
      ['Session B', '09:00'],
      ['Session A', '11:00'],
      ['Session C', '13:00'],
    ]);
  });

  it('marks both as changed so the save knows to write them', () => {
    const after = swapSessions(day(), 'a', 'b');

    expect(after[0].sessions.every((s) => s.moved)).toBe(true);
  });

  it('is its own inverse', () => {
    const there = swapSessions(day(), 'a', 'b');
    const back = swapSessions(there, 'a', 'b');

    expect(times(back)).toEqual(times(day()));
    expect(back[0].sessions.some((s) => s.moved)).toBe(false);
  });

  it('keeps the day legal when the two are different lengths', () => {
    // Not a raw exchange of clock times: a longer session taking an
    // earlier slot has to leave the gap the next one needs.
    const plan = toPlan([
      meeting('m1', '09:00', '15:00', [
        session('a', 'Session A', '09:00', 30),
        session('b', 'Session B', '10:00', 120),
      ]),
    ]);

    const after = swapSessions(plan, 'a', 'b');
    const [first, second] = after[0].sessions;

    expect(first.title).toBe('Session B');
    expect(second.startsAt - (first.startsAt + first.durationMinutes * 60000))
      .toBeGreaterThanOrEqual(15 * 60000);
  });
});

describe('what cannot change places', () => {
  it('refuses a session that has already run', () => {
    const plan = toPlan([
      meeting('m1', '09:00', '13:00', [
        session('a', 'Session A', '09:00', 60, 'done'),
        session('b', 'Session B', '11:00'),
      ]),
    ]);

    expect(whyNotSwap(plan, 'b', 'a')).toBe('settled');
    expect(times(swapSessions(plan, 'b', 'a'))).toEqual(times(plan));
  });

  it('refuses one that is on stage', () => {
    const plan = toPlan([
      meeting('m1', '09:00', '13:00', [
        session('a', 'Session A', '09:00', 60, 'live'),
        session('b', 'Session B', '11:00'),
      ]),
    ]);

    expect(whyNotSwap(plan, 'b', 'a')).toBe('settled');
  });

  it('refuses across two meetings', () => {
    const plan = toPlan([
      meeting('m1', '09:00', '10:00', [session('a', 'Session A', '09:00')]),
      meeting('m2', '11:00', '12:00', [session('b', 'Session B', '11:00')]),
    ]);

    expect(whyNotSwap(plan, 'a', 'b')).toBe('other-meeting');
    expect(swapSessions(plan, 'a', 'b')).toEqual(plan);
  });

  it('treats a row dropped on itself as nothing to do', () => {
    expect(whyNotSwap(day(), 'a', 'a')).toBe('same');
  });
});
