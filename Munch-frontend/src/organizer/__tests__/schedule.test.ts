import { GAP_MINUTES, applyEdit, reflowMeeting, toPlan, countChanges } from '../schedule';
import { EventMeeting } from '../../types';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 6, h, m)).toISOString();
const ms = (h: number, m = 0) => Date.UTC(2026, 8, 6, h, m);
const hhmm = (v: number) => {
  const d = new Date(v);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const mkSession = (id: string, h: number, m: number, mins: number, status: any = 'scheduled') => ({
  id, meeting: 'day', title: id, description: '', speaker_name: '', hall: '',
  speaker_visibility: 'private' as const,
  starts_at: at(h, m), duration_minutes: mins, ends_at: at(h, m), position: 0,
  status, started_at: null, ended_at: null, attendance_count: 0,
  created_at: at(0), updated_at: at(0),
});

/** The organizer's own day: A 10:00, B 11:15, C 13:00, D 14:15 — all an hour. */
const day = (): EventMeeting[] => [{
  id: 'day', meeting_code: 'DAY', title: 'Day', description: '',
  status: 'scheduled', scheduled_start: at(10), scheduled_end: at(15, 15),
  participant_count: 0, session_count: 4,
  sessions: [
    mkSession('A', 10, 0, 60),
    mkSession('B', 11, 15, 60),
    mkSession('C', 13, 0, 60),
    mkSession('D', 14, 15, 60),
  ],
}];

const times = (plan: ReturnType<typeof toPlan>) => {
  const out: Record<string, string> = {};
  plan.forEach((m) => m.sessions.forEach((s) => { out[s.title] = hhmm(s.startsAt); }));
  return out;
};

describe('case 1 - a session takes a slot another already holds', () => {
  it('trades the two places and leaves the rest alone', () => {
    const plan = applyEdit(toPlan(day()), 'B', { startsAt: ms(10, 0) });
    expect(times(plan)).toEqual({ B: '10:00', A: '11:15', C: '13:00', D: '14:15' });
  });

  it('works in the other direction too', () => {
    const plan = applyEdit(toPlan(day()), 'D', { startsAt: ms(10, 0) });
    expect(times(plan)).toEqual({ D: '10:00', B: '11:15', C: '13:00', A: '14:15' });
  });

  it('swaps two sessions in the middle without touching the ends', () => {
    const plan = applyEdit(toPlan(day()), 'C', { startsAt: ms(11, 15) });
    expect(times(plan)).toEqual({ A: '10:00', C: '11:15', B: '13:00', D: '14:15' });
  });

  it('counts only the two that moved', () => {
    expect(countChanges(applyEdit(toPlan(day()), 'B', { startsAt: ms(10, 0) }))).toBe(2);
  });
});

describe('case 2 - a session moves to a time nobody holds', () => {
  it('sends it to the earliest legal point after the day', () => {
    const plan = applyEdit(toPlan(day()), 'A', { startsAt: ms(15, 0) });
    // D runs 14:15-15:15, so with the gap the earliest A can start is 15:30.
    expect(times(plan)).toEqual({ B: '11:15', C: '13:00', D: '14:15', A: '15:30' });
  });

  it('leaves the others exactly where they were', () => {
    const plan = applyEdit(toPlan(day()), 'A', { startsAt: ms(15, 0) });
    const moved = plan[0].sessions.filter((s) => s.moved).map((s) => s.title);
    expect(moved).toEqual(['A']);
  });

  it('honours a requested time that is already free', () => {
    const plan = applyEdit(toPlan(day()), 'A', { startsAt: ms(17, 0) });
    expect(times(plan).A).toBe('17:00');
  });

  it('pushes what it lands on when dropped into the middle', () => {
    // A asked for 12:00, but B runs to 12:15, so A goes to 12:30 and C gives way.
    const plan = applyEdit(toPlan(day()), 'A', { startsAt: ms(12, 0) });
    expect(times(plan).B).toBe('11:15');
    expect(times(plan).A).toBe('12:30');
    expect(times(plan).C).toBe('13:45');
    expect(times(plan).D).toBe('15:00');
  });
});

describe('durations', () => {
  it('pushes only what follows, each to the nearest free time', () => {
    const plan = applyEdit(toPlan(day()), 'A', { durationMinutes: 120 });
    // A now runs to 12:00, so the rest close up behind it at the minimum gap.
    expect(times(plan)).toEqual({ A: '10:00', B: '12:15', C: '13:30', D: '14:45' });
  });

  it('moves nothing when a session is shortened', () => {
    const plan = applyEdit(toPlan(day()), 'A', { durationMinutes: 30 });
    expect(times(plan)).toEqual({ A: '10:00', B: '11:15', C: '13:00', D: '14:15' });
    expect(countChanges(plan)).toBe(1);
  });

  it('refuses a duration below five minutes', () => {
    const plan = applyEdit(toPlan(day()), 'A', { durationMinutes: 0 });
    expect(plan[0].sessions.find((s) => s.title === 'A')!.durationMinutes).toBe(5);
  });
});

describe('what has already happened', () => {
  it('never moves a finished session', () => {
    const data = day();
    data[0].sessions[1] = mkSession('B', 11, 15, 60, 'done');
    const plan = applyEdit(toPlan(data), 'A', { durationMinutes: 240 });
    expect(times(plan).B).toBe('11:15');
  });

  it('will not place a session onto a finished one', () => {
    const data = day();
    data[0].sessions[2] = mkSession('C', 13, 0, 60, 'done');
    const plan = applyEdit(toPlan(data), 'A', { startsAt: ms(13, 0) });
    // 13:00 is taken by something that already ran, so A goes after it.
    expect(times(plan).C).toBe('13:00');
    expect(times(plan).A).toBe('14:15');
  });
});

describe('meetings', () => {
  const twoMeetings = (): EventMeeting[] => [
    {
      id: 'morning', meeting_code: 'MRN', title: 'Morning', description: '',
      status: 'scheduled', scheduled_start: at(9), scheduled_end: at(12),
      participant_count: 0, session_count: 2,
      sessions: [mkSession('opening', 9, 0, 60), mkSession('budget', 11, 0, 60)],
    },
    {
      id: 'evening', meeting_code: 'EVE', title: 'Evening', description: '',
      status: 'scheduled', scheduled_start: at(14), scheduled_end: at(16),
      participant_count: 0, session_count: 1,
      sessions: [mkSession('closing', 14, 0, 120)],
    },
  ];

  it('keeps a deliberate lunch break rather than closing it', () => {
    const plan = applyEdit(toPlan(twoMeetings()), 'opening', { durationMinutes: 90 });
    expect(hhmm(plan[1].startsAt)).toBe('14:00');
    expect(plan[1].moved).toBe(false);
  });

  it('opens the minimum gap when one meeting overruns the next', () => {
    const plan = applyEdit(toPlan(twoMeetings()), 'budget', { durationMinutes: 240 });
    expect(hhmm(plan[0].endsAt)).toBe('15:00');
    expect(hhmm(plan[1].startsAt)).toBe('15:15');
  });

  it('moves a whole meeting with its running order', () => {
    const plan = reflowMeeting(toPlan(twoMeetings()), 'morning', ms(10, 0));
    expect(hhmm(plan[0].sessions[0].startsAt)).toBe('10:00');
    expect(hhmm(plan[0].sessions[1].startsAt)).toBe('12:00');
  });

  it('will not move a meeting that is already running', () => {
    const data = twoMeetings();
    data[1] = { ...data[1], status: 'active' };
    const plan = applyEdit(toPlan(data), 'budget', { durationMinutes: 240 });
    expect(hhmm(plan[1].startsAt)).toBe('14:00');
  });

  it('holds the gap constant', () => {
    expect(GAP_MINUTES).toBe(15);
  });
});
