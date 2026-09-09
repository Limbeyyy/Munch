import { applyEdit, swapSessions, toPlan, GAP_MINUTES } from '../schedule';
import { spaceOut, tooCloseTogether } from '../MeetingDraftFields';
import { confirmSpacing } from '../confirmSpacing';
import { EventMeeting, MeetingDraft } from '../../types';

const at = (hhmm: string) => `2026-09-08T${hhmm}:00Z`;

const session = (id: string, title: string, start: string, minutes = 60) => ({
  id, title, starts_at: at(start), duration_minutes: minutes,
  status: 'scheduled', speaker_name: '', hall: '',
} as any);

const day = () =>
  toPlan([
    {
      id: 'm1', title: 'Morning', meeting_code: 'M1', status: 'scheduled',
      scheduled_start: at('09:00'), scheduled_end: at('15:00'),
      sessions: [session('a', 'A', '09:00'), session('b', 'B', '11:00')],
    } as unknown as EventMeeting,
  ]);

const startsOf = (plan: any[]) =>
  plan[0].sessions.map((s: any) => new Date(s.startsAt).toISOString().slice(11, 16));

describe('the interval the host chose is the one the day is spaced by', () => {
  it('falls back to fifteen when nothing has been read yet', () => {
    expect(GAP_MINUTES).toBe(15);
  });

  it('pushes a collision clear by the chosen interval', () => {
    // B dragged onto A's heels: with forty-five it lands at 10:45, not 10:15.
    const after = applyEdit(day(), 'b', { startsAt: +new Date(at('09:30')) }, 45);

    expect(startsOf(after)).toEqual(['09:00', '10:45']);
  });

  it('does the same by a shorter interval', () => {
    const after = applyEdit(day(), 'b', { startsAt: +new Date(at('09:30')) }, 5);

    expect(startsOf(after)).toEqual(['09:00', '10:05']);
  });

  it('lets sessions run back to back at zero', () => {
    const after = applyEdit(day(), 'b', { startsAt: +new Date(at('09:30')) }, 0);

    expect(startsOf(after)).toEqual(['09:00', '10:00']);
  });

  it('keeps a swap legal by the chosen interval', () => {
    const plan = toPlan([
      {
        id: 'm1', title: 'Morning', meeting_code: 'M1', status: 'scheduled',
        scheduled_start: at('09:00'), scheduled_end: at('15:00'),
        sessions: [session('a', 'A', '09:00', 30), session('b', 'B', '10:00', 120)],
      } as unknown as EventMeeting,
    ]);

    const after = swapSessions(plan, 'a', 'b', 40);
    const [first, second] = after[0].sessions;

    expect(second.startsAt - (first.startsAt + first.durationMinutes * 60000))
      .toBeGreaterThanOrEqual(40 * 60000);
  });
});

describe('what a draft is warned about', () => {
  const draft = (): MeetingDraft => ({
    title: 'Morning',
    scheduled_start: '2026-09-08T09:00',
    duration_minutes: 300,
    sessions: [
      { title: 'A', starts_at: '2026-09-08T09:00', duration_minutes: 60 } as any,
      { title: 'B', starts_at: '2026-09-08T10:20', duration_minutes: 60 } as any,
    ],
  } as MeetingDraft);

  it('is happy with twenty minutes when fifteen is the rule', () => {
    expect(tooCloseTogether(draft(), 15)).toEqual([]);
  });

  it('is not when the host asked for thirty', () => {
    expect(tooCloseTogether(draft(), 30)).toEqual(['B']);
  });

  it("spaces it out by the host's own interval when they agree", () => {
    const spaced = spaceOut(draft(), 30);

    expect(spaced.sessions[1].starts_at).toContain('10:30');
  });

  it("quotes the host's own number when it asks", () => {
    let asked = '';
    confirmSpacing([draft()], (message) => { asked = message; return false; }, 30);

    expect(asked).toContain('30 minutes');
  });

  it('does not ask at all when the running order already obeys it', () => {
    let asked = false;
    const kept = confirmSpacing([draft()], () => { asked = true; return true; }, 15);

    expect(asked).toBe(false);
    expect(kept).not.toBeNull();
  });
});
