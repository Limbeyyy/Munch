import { deskSession } from '../sessionState';

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

  it('moves on to the next once the slot has gone', () => {
    // A was never started; the desk is about what to do now, and the
    // agenda still says A never ran.
    const desk = deskSession(day(), NOW('12:30'));

    expect(desk.session?.title).toBe('B');
    expect(desk.state).toBe('upcoming');
  });

  it('moves on again, however far off the next one is', () => {
    const desk = deskSession(day(), NOW('14:30'));

    expect(desk.session?.title).toBe('C');
    expect(desk.state).toBe('upcoming');
  });

  it('reads as due at exactly the hour that one starts', () => {
    const desk = deskSession(day(), NOW('21:00'));

    expect(desk.session?.title).toBe('C');
    expect(desk.state).toBe('due');
  });

  it('holds nothing once the running order is spent', () => {
    expect(deskSession(day(), NOW('23:30'))).toEqual({ session: null, state: null });
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
