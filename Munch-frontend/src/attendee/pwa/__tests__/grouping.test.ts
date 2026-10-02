import { groupSessions } from '../grouping';

const session = (over: any = {}) => ({
  id: 's1', event: 'e1', title: 'Opening', description: '',
  speaker_name: '', speaker_visibility: 'private',
  starts_at: '2026-09-15T04:00:00Z', duration_minutes: 30,
  ends_at: '2026-09-15T04:30:00Z', position: 0, status: 'scheduled',
  started_at: null, ended_at: null, attendance_count: 0,
  sub_event: null,
  ...over,
}) as any;

const group = (over: any = {}) => ({
  id: 'g1', event: 'e1', title: 'Emergency', description: '',
  position: 0, sessions: [], created_at: '2026-09-01T00:00:00Z',
  ...over,
}) as any;

/**
 * A programme read in its named parts.
 *
 * Four screens draw the same headings, so the grouping is worked out
 * once rather than four times slightly differently.
 */
describe('grouping a day by its named parts', () => {
  it('puts each talk under its own heading', () => {
    const got = groupSessions(
      [session({ id: 's1', sub_event: 'g1' }),
       session({ id: 's2', sub_event: 'g2', title: 'Rescue' })],
      [group(), group({ id: 'g2', title: 'SOS', position: 1 })],
      'Other'
    );

    expect(got.map((one) => one.title)).toEqual(['Emergency', 'SOS']);
    expect(got[0].sessions.map((one) => one.id)).toEqual(['s1']);
  });

  it('keeps the headings in the order the host put them in', () => {
    const got = groupSessions(
      [session({ id: 's1', sub_event: 'g1' }),
       session({ id: 's2', sub_event: 'g2' })],
      [group({ id: 'g2', title: 'SOS', position: 0 }),
       group({ id: 'g1', title: 'Emergency', position: 1 })],
      'Other'
    );

    expect(got.map((one) => one.title)).toEqual(['SOS', 'Emergency']);
  });

  it('orders the talks inside one by when they run', () => {
    const got = groupSessions(
      [session({ id: 'late', sub_event: 'g1', starts_at: '2026-09-15T06:00:00Z' }),
       session({ id: 'early', sub_event: 'g1', starts_at: '2026-09-15T04:00:00Z' })],
      [group()],
      'Other'
    );

    expect(got[0].sessions.map((one) => one.id)).toEqual(['early', 'late']);
  });

  /**
   * The gap this would otherwise leave.
   *
   * A heading is a way of reading the day. A talk nobody has filed is
   * still on the programme, and dropping it would lose it from every
   * screen at once.
   */
  it('still shows a talk in no named part', () => {
    const got = groupSessions(
      [session({ id: 's1', sub_event: 'g1' }), session({ id: 's2' })],
      [group()],
      'Everything else'
    );

    expect(got.map((one) => one.title)).toEqual(['Emergency', 'Everything else']);
    expect(got[1].sessions.map((one) => one.id)).toEqual(['s2']);
  });

  it('leaves out a heading with nothing under it', () => {
    const got = groupSessions(
      [session({ id: 's1', sub_event: 'g1' })],
      [group(), group({ id: 'g2', title: 'Empty', position: 1 })],
      'Other'
    );

    expect(got.map((one) => one.title)).toEqual(['Emergency']);
  });

  it('is one plain list where nothing has been grouped', () => {
    const got = groupSessions([session()], [], 'Everything else');

    expect(got).toHaveLength(1);
    expect(got[0].sessions).toHaveLength(1);
  });
});

/**
 * The host's side of the same reading.
 *
 * A heading with nothing under it is a gap in the day to somebody
 * reading the programme, and the thing they just made to the host
 * writing it. The one helper answers both, because the day underneath
 * is the same day.
 */
describe('a heading nothing has been filed under', () => {
  it('is left out of the programme as it is read', () => {
    const parts = groupSessions([], [group({ title: 'Climate Change' })], 'Other');

    expect(parts).toEqual([]);
  });

  it('is kept for the host, who wrote it and is about to fill it', () => {
    const parts = groupSessions(
      [], [group({ title: 'Climate Change' })], 'Other', true
    );

    expect(parts.map((p) => p.title)).toEqual(['Climate Change']);
    expect(parts[0].sessions).toEqual([]);
  });

  it('still puts what is filed under it under it', () => {
    const under = session({ id: 's2', sub_event: 'g1' });

    const parts = groupSessions(
      [under], [group()], 'Other', true
    );

    expect(parts.map((p) => p.sessions.map((s: any) => s.id))).toEqual([['s2']]);
  });

  it('does not swallow a talk filed under nothing', () => {
    const loose = session({ id: 's3', sub_event: null });

    const parts = groupSessions(
      [loose], [group({ title: 'Climate Change' })], 'Other agendas', true
    );

    expect(parts.map((p) => p.title)).toEqual(['Climate Change', 'Other agendas']);
    expect(parts[1].sessions.map((s: any) => s.id)).toEqual(['s3']);
  });
});
