import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { GAP_MINUTES } from './schedule';

/**
 * The interval this host keeps between sessions.
 *
 * Read once and kept, because every screen that spaces a day needs the
 * same answer and none of them should each ask for it. The cached value is
 * what the pure schedule helpers are handed, so the planner in the browser
 * and the scheduler on the server space a day by the same number.
 */
let cached = GAP_MINUTES;
let asked: Promise<number> | null = null;

/** The interval as last read. The default until the first answer arrives. */
export const sessionGap = (): number => cached;

const fetchOnce = (): Promise<number> => {
  if (!asked) {
    asked = apiClient
      .getSchedulingPrefs()
      .then((prefs) => {
        cached = prefs.session_gap_minutes;
        return cached;
      })
      .catch(() => cached);
  }
  return asked;
};

/** Forget the cached answer, so the next screen reads the new one. */
export const forgetSessionGap = (minutes?: number) => {
  if (typeof minutes === 'number') cached = minutes;
  asked = null;
};

export const useSessionGap = (): number => {
  const [minutes, setMinutes] = useState(cached);

  useEffect(() => {
    let gone = false;
    fetchOnce().then((found) => { if (!gone) setMinutes(found); });
    return () => { gone = true; };
  }, []);

  return minutes;
};
