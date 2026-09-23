import { dayKey, daysOf } from '../days';

const at = (iso: string) => new Date(iso);

/**
 * The days an event runs over.
 *
 * Counted by calendar day rather than by elapsed hours, because that is
 * what somebody means by "day two": an event opening at nine on Monday
 * and closing at nine on Wednesday runs over three days, not two.
 */
describe('the days of an event', () => {
  it('gives one day to an afternoon', () => {
    expect(daysOf({
      scheduled_start: '2026-09-15T10:00:00',
      scheduled_end: '2026-09-15T16:00:00',
    })).toEqual(['2026-09-15']);
  });

  it('gives three to an event that opens Monday and closes Wednesday', () => {
    expect(daysOf({
      scheduled_start: '2026-09-14T09:00:00',
      scheduled_end: '2026-09-16T21:00:00',
    })).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  /** Twenty-six hours is two days when it crosses a midnight. */
  it('counts the midnight, not the hours', () => {
    expect(daysOf({
      scheduled_start: '2026-09-14T22:00:00',
      scheduled_end: '2026-09-16T00:00:00',
    })).toHaveLength(3);
  });

  it('falls back to the day it is set for where there are no hours', () => {
    expect(daysOf({
      scheduled_start: null, scheduled_end: null, event_date: '2026-09-15',
    })).toEqual(['2026-09-15']);
  });

  /** An end before its start is bad data, not an instruction to loop. */
  it('does not run away on an end that precedes the start', () => {
    expect(daysOf({
      scheduled_start: '2026-09-15T10:00:00',
      scheduled_end: '2026-09-01T10:00:00',
    })).toEqual(['2026-09-15']);
  });

  it('writes a key a date input can read', () => {
    expect(dayKey(at('2026-01-05T08:00:00'))).toBe('2026-01-05');
  });
});
