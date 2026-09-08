import {
  earliestStart, openingAt, opensTheMeeting, spaceOut, tooCloseTogether, toLocalInput,
} from '../MeetingDraftFields';
import { confirmSpacing } from '../confirmSpacing';
import { MeetingDraft, SessionDraft } from '../../types';

const NINE = new Date('2026-09-06T09:00:00');

const session = (start: Date, minutes: number, title = 'S'): SessionDraft => ({
  title,
  speaker_name: 'A',
  speaker_email: 'a@example.com',
  speaker_phone: '9800000000',
  speaker_visibility: 'private',
  hall: '',
  starts_at: toLocalInput(start),
  duration_minutes: minutes,
});

const after = (minutes: number) => new Date(NINE.getTime() + minutes * 60000);

const draft = (sessions: SessionDraft[]): MeetingDraft => ({
  title: 'Morning',
  scheduled_start: toLocalInput(NINE),
  duration_minutes: 240,
  sessions,
});

describe('earliestStart', () => {
  it('leaves the first session free to start whenever', () => {
    expect(earliestStart(draft([session(NINE, 60)]), 0)).toBeNull();
  });

  it('is the previous end plus fifteen minutes', () => {
    const plan = draft([session(NINE, 60), session(after(75), 60)]);
    expect(earliestStart(plan, 1)).toEqual(after(75));
  });

  it('answers to the latest end, not the last one typed', () => {
    const plan = draft([
      session(NINE, 180, 'long'),
      session(after(30), 30, 'short'),
      session(after(300), 30, 'new'),
    ]);
    // The three-hour session ends at 12:00, so nothing starts before 12:15.
    expect(earliestStart(plan, 2)).toEqual(after(195));
  });
});

describe('tooCloseTogether', () => {
  it('accepts a running order that keeps the gap', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(75), 60, 'B')]);
    expect(tooCloseTogether(plan)).toEqual([]);
  });

  it('names a session that starts inside the gap', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(70), 60, 'B')]);
    expect(tooCloseTogether(plan)).toEqual(['B']);
  });

  it('names one that overlaps outright', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(30), 60, 'B')]);
    expect(tooCloseTogether(plan)).toEqual(['B']);
  });

  it('ignores a session with no title, which is not being saved', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(30), 60, '')]);
    expect(tooCloseTogether(plan)).toEqual([]);
  });
});

describe('spaceOut', () => {
  it('lays the brief\'s example out at 9:00, 10:15 and 11:30', () => {
    const plan = spaceOut(
      draft([
        session(NINE, 60, 'one'),
        session(NINE, 60, 'two'),
        session(NINE, 60, 'three'),
      ])
    );
    expect(plan.sessions.map((s) => s.starts_at)).toEqual([
      toLocalInput(NINE),
      toLocalInput(after(75)),
      toLocalInput(after(150)),
    ]);
  });

  it('leaves a wider gap the organizer chose alone', () => {
    const plan = spaceOut(draft([session(NINE, 60, 'A'), session(after(180), 60, 'B')]));
    expect(plan.sessions[1].starts_at).toEqual(toLocalInput(after(180)));
  });

  it('moves nothing earlier but the session that opens the meeting', () => {
    // The opener is pulled back to the meeting's own start; everything
    // after it only ever moves later.
    const plan = spaceOut(draft([session(after(120), 60, 'A'), session(after(300), 60, 'B')]));
    expect(plan.sessions[0].starts_at).toEqual(toLocalInput(NINE));
    expect(plan.sessions[1].starts_at).toEqual(toLocalInput(after(300)));
  });

  it('leaves a legal running order untouched', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(75), 60, 'B')]);
    expect(spaceOut(plan).sessions.map((s) => s.starts_at)).toEqual(
      plan.sessions.map((s) => s.starts_at)
    );
  });
});

describe('confirmSpacing', () => {
  it('saves a legal plan without asking anything', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(75), 60, 'B')]);
    const ask = jest.fn();
    expect(confirmSpacing([plan], ask)).toEqual([plan]);
    expect(ask).not.toHaveBeenCalled();
  });

  it('explains the conflict and returns the corrected times', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(70), 60, 'B')]);
    const ask = jest.fn().mockReturnValue(true);

    const result = confirmSpacing([plan], ask);

    expect(ask).toHaveBeenCalledWith(expect.stringContaining('15 minutes'));
    expect(result?.[0].sessions[1].starts_at).toEqual(toLocalInput(after(75)));
  });

  it('saves nothing when the organizer would rather go back', () => {
    const plan = draft([session(NINE, 60, 'A'), session(after(70), 60, 'B')]);
    expect(confirmSpacing([plan], () => false)).toBeNull();
  });
});

describe('the session that opens the meeting', () => {
  const meetingAt = (hour: number, sessions: SessionDraft[]): MeetingDraft => ({
    title: 'Wedding Preparation',
    scheduled_start: toLocalInput(new Date(`2026-09-08T${String(hour).padStart(2, '0')}:00:00`)),
    duration_minutes: 120,
    sessions,
  });

  const nine = new Date('2026-09-08T09:00:00');
  const after9 = (mins: number) => new Date(nine.getTime() + mins * 60000);

  it('is flagged when it starts after the meeting', () => {
    // The reported case: meeting at 09:00, first session at 09:30.
    const plan = meetingAt(9, [session(after9(30), 30, 'Haldi')]);
    expect(tooCloseTogether(plan)).toEqual(['Haldi']);
  });

  it('is content when the two agree', () => {
    expect(tooCloseTogether(meetingAt(9, [session(nine, 30, 'Haldi')]))).toEqual([]);
  });

  it('is pulled back to the meeting start when put right', () => {
    const plan = spaceOut(meetingAt(9, [session(after9(30), 30, 'Haldi')]));
    expect(plan.sessions[0].starts_at).toEqual(toLocalInput(nine));
  });

  it('takes the rest of the running order with it', () => {
    const plan = spaceOut(
      meetingAt(9, [session(after9(30), 30, 'Haldi'), session(after9(75), 40, 'Mehendi')])
    );
    expect(plan.sessions.map((s) => s.starts_at)).toEqual([
      toLocalInput(nine),
      // Typed at 10:15, and a gap the organizer left is left alone.
      toLocalInput(after9(75)),
    ]);
  });

  it('closes the running order up when the opener would collide', () => {
    const plan = spaceOut(
      meetingAt(9, [session(after9(30), 60, 'Haldi'), session(after9(45), 40, 'Mehendi')])
    );
    // Haldi opens at 09:00 and runs an hour, so Mehendi steps to 10:15.
    expect(plan.sessions.map((s) => s.starts_at)).toEqual([
      toLocalInput(nine),
      toLocalInput(after9(75)),
    ]);
  });

  it('moves with the meeting when the meeting moves', () => {
    const plan = meetingAt(9, [session(nine, 30, 'Haldi'), session(after9(45), 40, 'Mehendi')]);
    const later = toLocalInput(after9(60));

    const moved = openingAt(plan, later);

    expect(moved.scheduled_start).toEqual(later);
    expect(moved.sessions[0].starts_at).toEqual(later);
    // Only the opener is pinned; the rest are settled by spacing.
    expect(moved.sessions[1].starts_at).toEqual(toLocalInput(after9(45)));
  });

  it('knows which session opens the meeting whatever order they were typed in', () => {
    const plan = meetingAt(9, [session(after9(45), 40, 'Mehendi'), session(nine, 30, 'Haldi')]);
    expect(opensTheMeeting(plan, 1)).toBe(true);
    expect(opensTheMeeting(plan, 0)).toBe(false);
  });
});
