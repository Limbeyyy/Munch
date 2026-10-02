import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../services/api';
import { Reminder } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { ScreenHead } from './PhoneShell';

/** When it arrived, in the words a feed uses for it. */
const when = (iso: string, t: (pair: { ne: string; en: string }) => string) => {
  const then = new Date(iso);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const thenMidnight = new Date(then).setHours(0, 0, 0, 0);
  const days = Math.round((midnight - thenMidnight) / 86400000);

  if (days <= 0) {
    return `${t({ ne: 'आज', en: 'Today' })} · ${
      then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (days === 1) return t({ ne: 'हिजो', en: 'Yesterday' });
  if (days < 7) return t({ ne: `${days} दिन अघि`, en: `${days} days ago` });
  return then.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
};

/** The tinted square each kind of nudge sits behind. */
const Mark: React.FC<{ kind: 'event' | 'session' }> = ({ kind }) => {
  const paint = kind === 'event'
    ? { bg: '#e6efff', ink: '#2440c9' }
    : { bg: '#e3f8ec', ink: '#0b7a41' };
  return (
    <span
      className="size-9 rounded-[9px] grid place-items-center flex-none"
      style={{ backgroundColor: paint.bg, color: paint.ink }}
      aria-hidden
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        strokeLinejoin="round">
        {kind === 'event' ? (
          <>
            <rect x="3.5" y="5" width="17" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M3.5 10h17" />
          </>
        ) : (
          <path d="M4 7h16M4 12h16M4 17h10" />
        )}
      </svg>
    </span>
  );
};

/**
 * What this person has been told.
 *
 * Read on arrival: opening the page is reading it, so the count on the
 * tab is spent the moment the list is on screen rather than waiting
 * for each line to be pressed.
 */
export const NotificationsScreen: React.FC<{
  onRead: () => void;
}> = ({ onRead }) => {
  const { t } = useOrganizer();
  const [rows, setRows] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    try {
      const page = await apiClient.getReminders('attendee');
      setRows(page.reminders ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { read(); }, [read]);

  useEffect(() => {
    apiClient.markRemindersRead(undefined, 'attendee').then(onRead).catch(() => undefined);
    // Once, on opening. Marking again on every refresh would fight the
    // count rather than settle it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <ScreenHead title={t({ ne: 'सूचना', en: 'Notifications' })} />

      {loading ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {t({ ne: 'केही छैन।', en: 'Nothing here yet.' })}
        </p>
      ) : (
        <ul className="divide-y divide-[#eceef2]">
          {rows.map((one) => (
            <li key={one.id} className="px-4 py-4 flex gap-3">
              <Mark kind={one.kind} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#111726]">
                  {one.kind === 'event'
                    ? t({ ne: 'आउँदो कार्यक्रम', en: 'Upcoming event' })
                    : t({ ne: 'आउँदो सत्र', en: 'Upcoming session' })}
                </p>
                <p className="pt-0.5 text-[13px] leading-5 text-[#5b6070]">
                  {one.kind === 'event'
                    ? t({
                        ne: `${one.event_title} सुरु हुँदैछ।`,
                        en: `${one.event_title} is about to begin.`,
                      })
                    : t({
                        ne: `“${one.session_title}” ${one.event_title} मा सुरु हुँदैछ।`,
                        en: `“${one.session_title}” is about to begin at ${one.event_title}.`,
                      })}
                </p>
                <p className="pt-1 text-[12px] text-[#9ba0ad]">
                  {when(one.due_at, t)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
