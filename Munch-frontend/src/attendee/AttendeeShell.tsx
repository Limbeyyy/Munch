import React from 'react';
import { Pair, useOrganizer } from '../organizer/i18n';
import { Ic } from '../organizer/ui';

export interface AttendeeNav {
  id: string;
  label: Pair;
  short: Pair;
  icon: string;
  count?: string;
}

export const ATTENDEE_NAV: AttendeeNav[] = [
  { id: 'dash', label: { ne: 'ड्यासबोर्ड', en: 'Dashboard' }, short: { ne: 'ड्यास', en: 'Home' },
    icon: 'M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2z' },
  { id: 'agenda', label: { ne: 'एजेन्डा', en: 'Agenda' }, short: { ne: 'एजेन्डा', en: 'Agenda' },
    icon: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
  { id: 'sessions', label: { ne: 'सत्रहरू', en: 'Sessions' }, short: { ne: 'सत्र', en: 'Sessions' },
    icon: 'M4 5h16v11H4zM2 20h20M9 9l5 2.5L9 14z' },
  { id: 'hub', label: { ne: 'सहभागी हब', en: 'Attendee hub' }, short: { ne: 'हब', en: 'Hub' },
    icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  { id: 'connect', label: { ne: 'वक्ता', en: 'Speakers' }, short: { ne: 'वक्ता', en: 'Speakers' },
    icon: 'M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
];

interface Props {
  view: string;
  onNavigate: (id: string) => void;
  counts?: Record<string, string>;
  /** Who is looking, shown at the foot of the rail. */
  who: { name: string; detail: string; isGuest?: boolean };
  eventTitle?: string;
  eventDetail?: string;
  /** Only offered to people who actually run something. */
  onSwitchToOrganizer?: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}

/**
 * The attendee's frame: a navy rail on the left of a cream page, and the
 * same destinations along the bottom on a phone.
 */
export const AttendeeShell: React.FC<Props> = ({
  view, onNavigate, counts = {}, who, eventTitle, eventDetail,
  onSwitchToOrganizer, onLeave, children,
}) => {
  const { t, lang, setLang, a11y } = useOrganizer();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  const initials = who.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className={`min-h-screen bg-cream text-ink font-sans ${a11y.big ? 'text-[16.5px]' : 'text-[15px]'}
        ${a11y.calm ? '[&_*]:!transition-none [&_*]:!animate-none' : ''}`}
    >
      <div className="lg:grid min-h-screen" style={{ gridTemplateColumns: '246px minmax(0,1fr)' }}>
        {/* Rail */}
        <aside className="hidden lg:flex sticky top-0 h-screen overflow-y-auto bg-navy-800 text-[#E4ECF9] flex-col px-3.5 pt-4 pb-4">
          <div className="flex items-center gap-2.5 px-1.5 pb-5">
            <svg width="34" height="34" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <g stroke="#8FB0DC" strokeWidth="2"><path d="M32 8v8M32 48v8M8 32h8M48 32h8" /></g>
              <rect x="18" y="18" width="28" height="28" rx="4" stroke="#fff" strokeWidth="2.4" />
              <rect x="26" y="26" width="12" height="12" rx="2" fill="#F0A22B" />
            </svg>
            <div>
              <div className="text-[21px] font-bold text-white leading-none">मञ्च</div>
              <div className="text-[10.5px] text-[#9FB8DC] tracking-[.06em]">MANCH</div>
            </div>
          </div>

          <nav className="flex flex-col gap-0.5" aria-label={t({ ne: 'मुख्य मेनु', en: 'Main menu' })}>
            {ATTENDEE_NAV.map((item) => {
              const current = view === item.id;
              return (
                <button
                  key={item.id}
                  aria-current={current}
                  onClick={() => onNavigate(item.id)}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-[10px] text-left text-[14.5px] ${
                    current
                      ? 'bg-white text-navy-800 font-semibold'
                      : 'text-[#CBDAF0] hover:bg-white/[.07] hover:text-white'
                  }`}
                >
                  <span className={current ? 'text-amber-700' : ''}><Ic d={item.icon} size={19} /></span>
                  <span className="truncate">{t(item.label)}</span>
                  {counts[item.id] && (
                    <span
                      className={`ml-auto text-[11.5px] px-2 rounded-full ${
                        current ? 'bg-cream-200 text-navy-800' : 'bg-white/[.14]'
                      }`}
                    >
                      {counts[item.id]}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-white/[.14] pt-3.5 flex gap-2.5 items-center">
            <span className="w-9 h-9 rounded-full bg-amber text-[#20160A] grid place-items-center font-bold text-sm flex-none">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-white font-medium leading-tight truncate">{who.name}</div>
              <small className="block text-[11.5px] text-[#9FB8DC] truncate">{who.detail}</small>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 bg-cream/[.92] backdrop-blur border-b border-navy-800/15 px-4 sm:px-6 py-3 flex gap-4 items-center">
            <div className="min-w-0">
              <h2 className="text-[16.5px] font-semibold truncate">
                {eventTitle ?? t({ ne: 'मञ्च', en: 'Manch' })}
              </h2>
              {eventDetail && <p className="text-[12.5px] text-[#6E7C8E] truncate">{eventDetail}</p>}
            </div>

            <div className="ml-auto flex gap-2 items-center">
              <span
                className={`hidden sm:inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-full border ${
                  online
                    ? 'border-ok/35 text-ok bg-ok/[.07]'
                    : 'border-live/35 text-live bg-live/[.07]'
                }`}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-current" />
                {online ? t({ ne: 'अनलाइन', en: 'Online' }) : t({ ne: 'अफलाइन', en: 'Offline' })}
              </span>

              <div className="inline-flex bg-cream-200 rounded-lg p-0.5 gap-0.5">
                {(['ne', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={`px-2 py-1 rounded-md text-[12px] ${
                      lang === l ? 'bg-white text-navy-800 font-semibold' : 'text-ink-2'
                    }`}
                  >
                    {l === 'ne' ? 'नेपाली' : 'EN'}
                  </button>
                ))}
              </div>

              {onSwitchToOrganizer && (
                <button
                  onClick={onSwitchToOrganizer}
                  className="hidden sm:inline-flex px-3 py-1.5 rounded-lg border border-navy-800 text-navy-800 text-[13px] font-medium hover:bg-white"
                >
                  {t({ ne: 'आयोजक प्यानल', en: 'Organizer panel' })}
                </button>
              )}

              <button
                onClick={onLeave}
                className="px-3 py-1.5 rounded-lg border border-navy-800/20 text-ink-2 text-[13px] hover:bg-white"
              >
                {who.isGuest
                  ? t({ ne: 'बाहिरिने', en: 'Leave' })
                  : t({ ne: 'लगआउट', en: 'Logout' })}
              </button>
            </div>
          </header>

          <main className="px-4 sm:px-6 py-6 pb-28 lg:pb-16 min-w-0">{children}</main>
        </div>
      </div>

      {/* Bottom bar on a phone */}
      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-navy-800/15 grid"
        style={{
          gridTemplateColumns: `repeat(${ATTENDEE_NAV.length},1fr)`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        aria-label={t({ ne: 'मुख्य मेनु', en: 'Main menu' })}
      >
        {ATTENDEE_NAV.map((item) => {
          const current = view === item.id;
          return (
            <button
              key={item.id}
              aria-current={current}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center gap-1 py-2 text-[10.5px] ${
                current ? 'text-navy-800 font-semibold' : 'text-[#6E7C8E]'
              }`}
            >
              <span className={current ? 'text-amber-700' : ''}><Ic d={item.icon} size={19} /></span>
              {t(item.short)}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
