import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api';
import { Reminder, ReminderPage } from '../types';
import { QUEUE_POLL_MS } from '../services/polling';

const SEEN_KEY = 'manch.nudges.announced';

const seen = (): Set<string> => {
  try {
    const saved: string[] = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(saved);
  } catch {
    return new Set();
  }
};

const remember = (ids: Set<string>) => {
  try {
    // Only the recent ones: this is a "have I said this already" list, not
    // a history, and it should not grow without limit.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    /* a private window just means we may announce one twice */
  }
};

export const canAnnounce = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

export const announcePermission = (): NotificationPermission =>
  canAnnounce() ? Notification.permission : 'denied';

/** Ask once, from a click - browsers refuse to be asked any other way. */
export const askToAnnounce = async (): Promise<NotificationPermission> => {
  if (!canAnnounce()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
};

const wording = (r: Reminder): { title: string; body: string } => {
  const when = new Date(r.starts_at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  if (r.kind === 'session') {
    return {
      title: r.session_title || r.meeting_title,
      body: `Starts at ${when}${r.hall ? ` · ${r.hall}` : ''} — ${r.meeting_title}`,
    };
  }
  return { title: r.meeting_title, body: `Starts at ${when}` };
};

/**
 * The one place the reminders are fetched, for both portals.
 *
 * The list is polled rather than pushed: a nudge is owed at a time the
 * browser already knows, so there is nothing for a socket to tell it that
 * the next poll would not. Anything due while the tab is open is
 * announced once - the browser's own notification if that has been allowed,
 * and the rail's badge either way.
 */
export const useNudges = () => {
  const [page, setPage] = useState<ReminderPage | null>(null);
  const [loading, setLoading] = useState(true);
  const announced = useRef<Set<string>>(seen());

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiClient.getReminders();
      setPage(fresh);

      if (announcePermission() === 'granted') {
        fresh.reminders
          .filter((r) => r.is_due && !r.read && !announced.current.has(r.id))
          .forEach((r) => {
            const { title, body } = wording(r);
            try {
              new Notification(title, { body, tag: r.id });
              announced.current.add(r.id);
            } catch {
              /* some browsers refuse outside a service worker; the badge
                 still carries it */
            }
          });
        remember(announced.current);
      }
    } catch {
      /* a stale count beats a toast on every tick */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, QUEUE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const markRead = useCallback(async (id?: string) => {
    // Tick it off here first: waiting for a round trip to grey out one row
    // reads as a dead button.
    setPage((prev) =>
      prev
        ? {
            ...prev,
            reminders: prev.reminders.map((r) =>
              !id || r.id === id ? { ...r, read: true } : r
            ),
            unread: id ? Math.max(0, prev.unread - 1) : 0,
          }
        : prev
    );
    try {
      await apiClient.markRemindersRead(id);
    } catch {
      refresh();
    }
  }, [refresh]);

  return { page, loading, unread: page?.unread ?? 0, refresh, markRead };
};
