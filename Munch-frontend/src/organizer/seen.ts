import { useEffect, useState } from 'react';

/**
 * When each part of the rail was last looked at.
 *
 * A badge is a claim that something has arrived which the reader has not
 * seen. Once they open that section the claim is spent, so the count goes
 * - but the things it was counting do not: a moderation queue with items
 * still waiting is not emptied by having been read, it is simply no longer
 * news. Which is why this records a moment rather than clearing a list.
 *
 * Per browser, like the other conveniences: it is about what this reader
 * has looked at, not about the state of the programme.
 */
const KEY = 'manch.seen';

type Stamps = Record<string, number>;

const read = (): Stamps => {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};

const write = (stamps: Stamps) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stamps));
  } catch {
    /* a private window just means every badge stays news */
  }
};

/** When this section was last opened, or 0 if it never has been. */
export const sectionSeenAt = (section: string): number => read()[section] ?? 0;

export const markSectionSeen = (section: string, at: number = Date.now()) => {
  write({ ...read(), [section]: at });
};

/**
 * Stamp a section as seen while the reader is in it.
 *
 * Stamped on the way in and again on the way out, so anything that lands
 * while they are watching it is not counted as news the moment they
 * navigate away.
 */
export const useSeen = (section: string | null | undefined): Stamps => {
  // The stamps are handed back rather than kept private, so a count
  // worked out from them depends on a value it can be seen to read -
  // there is nothing hidden for a stale count to hide behind.
  const [stamps, setStamps] = useState<Stamps>(read);

  useEffect(() => {
    if (!section) return;
    const stamp = () => {
      markSectionSeen(section);
      setStamps(read());
    };
    stamp();
    return stamp;
  }, [section]);

  return stamps;
};

/** How many of these arrived after the moment the reader last looked. */
export const unseenSince = <T>(
  rows: T[],
  since: number,
  at: (row: T) => string | number
): number => rows.filter((row) => +new Date(at(row)) > since).length;
