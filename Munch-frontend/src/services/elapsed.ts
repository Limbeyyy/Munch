import { useEffect, useState } from 'react';

/**
 * How long the event has been running, written the same way everywhere.
 *
 * There were three of these. The room counted seconds from the talk on
 * stage; the host's dashboard counted whole minutes from the event and
 * wrote them "3m"; the attendee's header counted the same minutes and
 * wrote them "00:03". So three screens of one event showed three
 * different numbers, and two of them were not even measuring the same
 * thing.
 *
 * One answer now: seconds since the event started, which is a moment
 * the server owns, so every device agrees without anything being sent
 * between them.
 */

export const formatElapsed = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

/** Seconds since that moment, counted once a second. Nought before it. */
export const useElapsedSeconds = (from: string | null | undefined): number => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!from) { setSeconds(0); return undefined; }
    const origin = new Date(from).getTime();
    if (Number.isNaN(origin)) { setSeconds(0); return undefined; }

    const tick = () => setSeconds(
      Math.max(0, Math.floor((Date.now() - origin) / 1000))
    );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [from]);

  return seconds;
};

/** The same thing, already written out. Empty before it has started. */
export const useElapsed = (from: string | null | undefined): string => {
  const seconds = useElapsedSeconds(from);
  return from ? formatElapsed(seconds) : '';
};
