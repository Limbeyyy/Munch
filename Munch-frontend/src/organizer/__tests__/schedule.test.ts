import { MEETING_GAP_MINUTES, reflow, reflowMeeting, toPlan, countChanges } from '../schedule';
import { EventMeeting } from '../../types';

const iso = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 8, 6, h, m)).toISOString();

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const session = (id: string, startH: number, startM: number, mins: number) => ({
  id, meeting: 'm', title: id, description: '', speaker_name: '',
  starts_at: iso(startH, startM), duration_minutes: mins,
  ends_at: iso(startH, startM), position: 0, status: 'scheduled' as const,
  started_at: null, ended_at: null, attendance_count: 0,
  created_at: iso(0), updated_at: iso(0),
});

/** Morning 09:00-12:00 (two sessions), Evening 14:00-16:00 (one). */
const build = (): EventMeeting[] => [
  {
    id: 'morning', meeting_code: 'MRN', title: 'Morning', description: '',
    status: 'scheduled', scheduled_start: iso(9), scheduled_end: iso(12),
    participant_count: 0, session_count: 2,
    sessions: [session('opening', 9, 0, 60), session('budget', 11, 0, 60)],
  },
  {
    id: 'evening', meeting_code: 'EVE', title: 'Evening', description: '',
    status: 'scheduled', scheduled_start: iso(14), scheduled_end: iso(16),
    participant_count: 0, session_count: 1,
    sessions: [session('closing', 14, 0, 120)],
  },
];

const shape = (plan: ReturnType<typeof toPlan>) =>
  plan
    .map((m) => `${m.title} ${hhmm(m.startsAt)}-${hhmm(m.endsAt)}[${m.sessions
      .map((s) => `${s.title} ${hhmm(s.startsAt)}+${s.durationMinutes}`)
      .join(', ')}]`)
    .join('  |  ');

describe('reflow', () => {
  it('carries later sessions when a start moves', () => {
    const plan = reflow(toPlan(build()), 'opening', { startsAt: Date.UTC(2026, 8, 6, 10, 0) });
    const morning = plan[0];
    expect(hhmm(morning.sessions[0].startsAt)).toBe('10:00');
    // The hour-long gap the organizer left is preserved, not collapsed.
    expect(hhmm(morning.sessions[1].startsAt)).toBe('12:00');
    expect(hhmm(morning.endsAt)).toBe('13:00');
  });

  it('pushes only what follows when a duration grows', () => {
    const plan = reflow(toPlan(build()), 'opening', { durationMinutes: 90 });
    const morning = plan[0];
    expect(hhmm(morning.sessions[0].startsAt)).toBe('09:00');
    expect(hhmm(morning.sessions[1].startsAt)).toBe('11:30');
    expect(hhmm(morning.endsAt)).toBe('12:30');
  });

  it('leaves earlier sessions alone', () => {
    const plan = reflow(toPlan(build()), 'budget', { durationMinutes: 180 });
    expect(hhmm(plan[0].sessions[0].startsAt)).toBe('09:00');
    expect(plan[0].sessions[0].moved).toBe(false);
  });

  it('keeps a wide gap between meetings rather than closing it', () => {
    const plan = reflow(toPlan(build()), 'opening', { durationMinutes: 90 });
    // Morning now ends 12:30; Evening had a long lunch break and keeps it.
    expect(hhmm(plan[1].startsAt)).toBe('14:00');
    expect(plan[1].moved).toBe(false);
  });

  it('opens the minimum gap when a meeting would overrun the next', () => {
    const plan = reflow(toPlan(build()), 'budget', { durationMinutes: 240 });
    // Morning runs to 15:00, so Evening is pushed to 15:15.
    expect(hhmm(plan[0].endsAt)).toBe('15:00');
    expect(hhmm(plan[1].startsAt)).toBe('15:15');
    expect(hhmm(plan[1].sessions[0].startsAt)).toBe('15:15');
    expect(plan[1].moved).toBe(true);
  });

  it('never pulls a later meeting earlier', () => {
    const plan = reflow(toPlan(build()), 'budget', { durationMinutes: 5 });
    expect(hhmm(plan[1].startsAt)).toBe('14:00');
  });

  it('moves a whole meeting with its running order', () => {
    const plan = reflowMeeting(toPlan(build()), 'morning', Date.UTC(2026, 8, 6, 10, 0));
    expect(hhmm(plan[0].sessions[0].startsAt)).toBe('10:00');
    expect(hhmm(plan[0].sessions[1].startsAt)).toBe('12:00');
    expect(hhmm(plan[0].endsAt)).toBe('13:00');
  });

  it('cascades through a chain of meetings', () => {
    const three = build();
    three.push({
      ...three[1], id: 'night', meeting_code: 'NGT', title: 'Night',
      scheduled_start: iso(16, 30), scheduled_end: iso(17, 30),
      sessions: [session('wrap', 16, 30, 60)],
    });
    const plan = reflow(toPlan(three), 'budget', { durationMinutes: 240 });
    // Morning -> 15:00, Evening -> 15:15-17:15, Night -> 17:30.
    expect(hhmm(plan[1].startsAt)).toBe('15:15');
    expect(hhmm(plan[2].startsAt)).toBe('17:30');
  });

  it('refuses a duration below five minutes', () => {
    const plan = reflow(toPlan(build()), 'opening', { durationMinutes: 0 });
    expect(plan[0].sessions[0].durationMinutes).toBe(5);
  });

  it('reports nothing pending until something actually moves', () => {
    expect(countChanges(toPlan(build()))).toBe(0);
    expect(countChanges(reflow(toPlan(build()), 'opening', { durationMinutes: 60 }))).toBe(0);
    expect(countChanges(reflow(toPlan(build()), 'opening', { durationMinutes: 90 }))).toBeGreaterThan(0);
  });

  it('leaves a finished session where it happened', () => {
    const data = build();
    data[0].sessions[1] = { ...data[0].sessions[1], status: 'done' };
    const plan = reflow(toPlan(data), 'opening', { durationMinutes: 240 });
    // Opening now runs to 13:00, but Budget already happened at 11:00.
    expect(hhmm(plan[0].sessions[1].startsAt)).toBe('11:00');
    expect(plan[0].sessions[1].moved).toBe(false);
  });

  it('will not move a meeting that is already running', () => {
    const data = build();
    data[1] = { ...data[1], status: 'active' };
    const plan = reflow(toPlan(data), 'budget', { durationMinutes: 240 });
    expect(hhmm(plan[1].startsAt)).toBe('14:00');
    expect(plan[1].moved).toBe(false);
  });

  it('holds the minimum gap constant', () => {
    expect(MEETING_GAP_MINUTES).toBe(15);
  });

  it('shows the whole day reflowing', () => {
    const before = shape(toPlan(build()));
    const after = shape(reflow(toPlan(build()), 'opening', { durationMinutes: 150 }));
    expect(before).not.toBe(after);
    // eslint-disable-next-line no-console
    console.log('\n  before:', before, '\n  after: ', after);
  });
});
