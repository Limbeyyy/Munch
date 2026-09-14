import { deskSession, startableNow } from '../sessionState';

const at = (hhmm: string) => `2026-09-08T${hhmm}:00.000Z`;
const NOW = (hhmm: string) => +new Date(at(hhmm));

const session = (title: string, start: string, minutes: number, status = 'scheduled') =>
  ({ id: title, title, starts_at: at(start), duration_minutes: minutes, status });

/** Ten sessions, as the case describes them. */
const day = () => [
  session('A', '11:00', 60),
  session('B', '13:00', 60),
  session('C', '21:00', 60),
];

describe('which session a live desk holds', () => {
  it('holds the first while its slot is still ahead', () => {
    const desk = deskSession(day(), NOW('09:00'));

    expect(desk.session?.title).toBe('A');
    expect(desk.state).toBe('upcoming');
  });

  it('reads as due once its own hour comes', () => {
    const desk = deskSession(day(), NOW('11:00'));

    expect(desk.session?.title).toBe('A');
    expect(desk.state).toBe('due');
  });

  it('is still due partway through the slot, for a host running late', () => {
    expect(deskSession(day(), NOW('11:30')).state).toBe('due');
  });

  it('keeps holding one whose slot has slipped by', () => {
    // A was never started and its hour has gone. The timetable follows the
    // room now: the thing to do about that is to start A, so A is what the
    // desk holds - moving on would leave the host nothing to press.
    const desk = deskSession(day(), NOW('12:30'));

    expect(desk.session?.title).toBe('A');
    expect(desk.state).toBe('due');
  });

  it('moves on once that one has actually been run', () => {
    const sessions = [
      session('A', '11:00', 60, 'done'),
      session('B', '13:00', 60),
      session('C', '21:00', 60),
    ];

    const desk = deskSession(sessions, NOW('12:30'));

    expect(desk.session?.title).toBe('B');
    expect(desk.state).toBe('upcoming');
  });

  it('reads as due at exactly the hour the one it holds starts', () => {
    const sessions = [
      session('A', '11:00', 60, 'done'),
      session('B', '13:00', 60, 'done'),
      session('C', '21:00', 60),
    ];

    const desk = deskSession(sessions, NOW('21:00'));

    expect(desk.session?.title).toBe('C');
    expect(desk.state).toBe('due');
  });

  it('holds nothing once the running order is spent', () => {
    const spent = day().map((s) => ({ ...s, status: 'done' }));

    expect(deskSession(spent, NOW('23:30'))).toEqual({ session: null, state: null });
  });

  it('lets whatever is on stage win, whatever the clock says', () => {
    const sessions = [
      session('A', '11:00', 60, 'live'),
      session('B', '13:00', 60),
    ];

    const desk = deskSession(sessions, NOW('13:10'));

    expect(desk.session?.title).toBe('A');
    expect(desk.state).toBe('live');
  });

  it('skips a session that has been run', () => {
    const sessions = [
      session('A', '11:00', 60, 'done'),
      session('B', '13:00', 60),
    ];

    expect(deskSession(sessions, NOW('11:30')).session?.title).toBe('B');
  });

  it('holds nothing at all when there are no sessions', () => {
    expect(deskSession([], NOW('11:00')).session).toBeNull();
  });
});

/**
 * Whether the host may put a talk on stage yet.
 *
 * Its hour need not have come. Starting early is not refused any more - it
 * brings the talk, and the rest of the day behind it, forward to now,
 * which is what the host means by pressing it. What is refused is opening
 * something set for another day by mistake.
 */
describe('starting before the hour', () => {
  const inMinutes = (n: number) => Date.now() + n * 60000;

  it('is allowed an hour early, which is the host being ready', () => {
    expect(startableNow(inMinutes(60))).toBe(true);
  });

  it('is allowed once its hour has come, and after', () => {
    expect(startableNow(inMinutes(0))).toBe(true);
    expect(startableNow(inMinutes(-90))).toBe(true);
  });

  it('is refused for something set for another day', () => {
    expect(startableNow(inMinutes(60 * 24))).toBe(false);
  });

  it('has nothing to say about a session that is not there', () => {
    expect(startableNow(null)).toBe(false);
  });
});
