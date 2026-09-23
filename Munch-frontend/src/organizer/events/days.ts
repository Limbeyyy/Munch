/**
 * The days an event runs over.
 *
 * Most events are an afternoon and have one. Some run over two or three,
 * and the running order for those is not one list: a talk at nine
 * belongs to the morning of a particular day, and a form that only knows
 * a time cannot say which.
 *
 * Counted by calendar day rather than by elapsed hours, because that is
 * what somebody means by "day two" - an event that opens at nine on
 * Monday and closes at nine on Wednesday runs over three days, not two.
 */

/** A local date as YYYY-MM-DD, which is what a date input reads. */
export const dayKey = (at: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

export const daysOf = (event: {
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  event_date?: string | null;
}): string[] => {
  const from = event.scheduled_start ? new Date(event.scheduled_start) : null;
  if (!from || Number.isNaN(+from)) {
    return event.event_date ? [event.event_date] : [];
  }

  const to = event.scheduled_end ? new Date(event.scheduled_end) : from;
  const last = Number.isNaN(+to) || +to < +from ? from : to;

  const days: string[] = [];
  const walk = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const stop = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  // Guarded rather than trusted: a bad end date should not spin here.
  while (+walk <= +stop && days.length < 60) {
    days.push(dayKey(walk));
    walk.setDate(walk.getDate() + 1);
  }
  return days.length > 0 ? days : [dayKey(from)];
};

/** Which day a session sits on, as the same key. */
export const dayOfSession = (session: { starts_at: string }): string =>
  dayKey(new Date(session.starts_at));
