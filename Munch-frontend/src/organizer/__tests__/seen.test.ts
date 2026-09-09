import {
  markSectionSeen, sectionSeenAt, unseenSince,
} from '../seen';

beforeEach(() => window.localStorage.clear());

const arrived = (minutesAgo: number) => ({
  created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
});

describe('what counts as news', () => {
  it('counts everything before a section has ever been opened', () => {
    const rows = [arrived(30), arrived(10), arrived(1)];

    expect(unseenSince(rows, sectionSeenAt('moderation'), (r) => r.created_at)).toBe(3);
  });

  it('counts nothing that was there when the reader looked', () => {
    const rows = [arrived(30), arrived(10)];
    markSectionSeen('moderation');

    expect(unseenSince(rows, sectionSeenAt('moderation'), (r) => r.created_at)).toBe(0);
  });

  it('counts what has come in since', () => {
    markSectionSeen('moderation', Date.now() - 20 * 60000);
    const rows = [arrived(30), arrived(10), arrived(1)];

    expect(unseenSince(rows, sectionSeenAt('moderation'), (r) => r.created_at)).toBe(2);
  });

  it('does not empty the queue it was counting', () => {
    // The whole point: a badge going quiet is not work disappearing.
    const rows = [arrived(30), arrived(10)];
    markSectionSeen('moderation');

    expect(unseenSince(rows, sectionSeenAt('moderation'), (r) => r.created_at)).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it("keeps each section's own moment", () => {
    markSectionSeen('moderation', 1000);
    markSectionSeen('reminders', 5000);

    expect(sectionSeenAt('moderation')).toBe(1000);
    expect(sectionSeenAt('reminders')).toBe(5000);
    expect(sectionSeenAt('agenda')).toBe(0);
  });

  it('treats a browser that remembers nothing as having seen nothing', () => {
    const real = window.localStorage.getItem;
    (window.localStorage as any).getItem = () => { throw new Error('blocked'); };

    expect(sectionSeenAt('moderation')).toBe(0);

    (window.localStorage as any).getItem = real;
  });
});
