import React from 'react';
import { Pair, useOrganizer } from '../../organizer/i18n';

/**
 * The frame for everything outside a live room.
 *
 * Four along the bottom rather than the room's five: out here somebody
 * is looking things up - what is coming, what they missed, what they
 * have been told - and none of it belongs to a talk that is running.
 */
export type HomeSection = 'home' | 'events' | 'notifications' | 'profile';

const LABEL: Record<HomeSection, Pair> = {
  home: { ne: 'गृह', en: 'Home' },
  events: { ne: 'कार्यक्रम', en: 'Events' },
  notifications: { ne: 'सूचना', en: 'Notifications' },
  profile: { ne: 'प्रोफाइल', en: 'Profile' },
};

const GLYPH: Record<HomeSection, React.ReactNode> = {
  home: <path d="M3.5 10.5L12 4l8.5 6.5V19a1 1 0 01-1 1h-15a1 1 0 01-1-1z" />,
  events: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20a7 7 0 0114 0" />
    </>
  ),
};

/** A count nobody has looked at yet. Red here, because it is news. */
const Pip: React.FC<{ n: number }> = ({ n }) => {
  const { num } = useOrganizer();
  if (n <= 0) return null;
  return (
    <span className="absolute -top-1.5 left-1/2 ml-1 bg-[#e12121] text-white
      rounded-full min-w-[17px] h-[17px] px-1 grid place-items-center
      text-[10px] font-semibold leading-none">
      {num(n > 99 ? 99 : n)}
    </span>
  );
};

export const HomeShell: React.FC<{
  at: HomeSection;
  onGo: (to: HomeSection) => void;
  unread?: number;
  children: React.ReactNode;
}> = ({ at, onGo, unread = 0, children }) => {
  const { t } = useOrganizer();

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col">
      <main className="flex-1 pb-[76px]">{children}</main>

      <nav
        aria-label={t({ ne: 'मुख्य', en: 'Sections' })}
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#e8eaee]
          flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {(Object.keys(LABEL) as HomeSection[]).map((one) => {
          const on = one === at;
          return (
            <button
              key={one}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onGo(one)}
              className={`flex-1 pt-2.5 pb-2 flex flex-col items-center gap-1
                ${on ? 'text-[#2440c9]' : 'text-[#8b90a0]'}`}
            >
              <span className="relative">
                <svg
                  width="24" height="24" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  {GLYPH[one]}
                </svg>
                {one === 'notifications' && <Pip n={unread} />}
              </span>
              <span className={`text-[11px] leading-none ${on ? 'font-medium' : ''}`}>
                {t(LABEL[one])}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

/** What an event is doing now, as the cards label it. */
export type EventState = 'upcoming' | 'live' | 'completed';

export const stateOf = (event: {
  status: string; started_at?: string | null;
}): EventState => {
  if (event.status === 'active') return 'live';
  if (event.status === 'ended' || event.status === 'cancelled') return 'completed';
  return 'upcoming';
};

export const StateChip: React.FC<{ state: EventState }> = ({ state }) => {
  const { t } = useOrganizer();
  const paint = {
    upcoming: { bg: '#dbe6fa', ink: '#2440c9', label: t({ ne: 'आउँदै', en: 'UPCOMING' }) },
    live: { bg: '#fde8e8', ink: '#e12121', label: t({ ne: 'प्रत्यक्ष', en: 'LIVE' }) },
    completed: { bg: '#d9f7e6', ink: '#0b7a41', label: t({ ne: 'सकियो', en: 'COMPLETED' }) },
  }[state];

  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.02em]"
      style={{ backgroundColor: paint.bg, color: paint.ink }}
    >
      {paint.label}
    </span>
  );
};
