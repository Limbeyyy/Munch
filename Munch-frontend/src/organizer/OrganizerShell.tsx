import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Pair, useOrganizer } from './i18n';
import { Btn, Ic } from './ui';
import manchMark from '../assets/icons/manch-mark.svg';

export interface NavItem {
  id: string;
  group: 1 | 2 | 3 | 4;
  label: Pair;
  icon: string;
  /** Small count or live marker beside the name. */
  badge?: { text: string; hot?: boolean };
}

export const NAV: NavItem[] = [
  { id: 'live', group: 1, label: { ne: 'लाइभ नियन्त्रण', en: 'Live control' },
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM10 8l6 4-6 4z' },
  { id: 'attendance', group: 1, label: { ne: 'उपस्थिति', en: 'Attendance' },
    icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-2a5 5 0 015-5h4a5 5 0 015 5v2M17 11l2 2 4-4' },
  { id: 'moderation', group: 1, label: { ne: 'मडेरेसन', en: 'Moderation' },
    icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },

  { id: 'events', group: 2, label: { ne: 'कार्यक्रम', en: 'Events' },
    icon: 'M4 5h16M4 5v14a2 2 0 002 2h12a2 2 0 002-2V5M9 10h6M9 14h6M7 3v4M17 3v4' },
  { id: 'content', group: 2, label: { ne: 'सामग्री र सारांश', en: 'Files and Summaries' },
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h6' },
  { id: 'people', group: 2, label: { ne: 'वक्ता र टोली', en: 'Speaker and teams' },
    icon: 'M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8' },

  { id: 'setup', group: 3, label: { ne: 'सेटअप', en: 'Setup' },
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.7 15H3.4a2 2 0 110-4h.2a1.6 1.6 0 001.1-2.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V4a2 2 0 114 0v.2a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.3a2 2 0 110 4h-.2z' },
  { id: 'reminders', group: 3, label: { ne: 'सूचना र सम्झना', en: 'Notifications' },
    icon: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0' },
  { id: 'profile', group: 3, label: { ne: 'प्रोफाइल', en: 'Profile' },
    icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z' },

  // Kept reachable, below the three groups the design names.
  { id: 'reports', group: 4, label: { ne: 'रिपोर्ट', en: 'Reports' },
    icon: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
  { id: 'settings', group: 4, label: { ne: 'सेटिङ', en: 'Settings' },
    icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'subscription', group: 4, label: { ne: 'योजना', en: 'Subscription' },
    icon: 'M2 7h20v12a2 2 0 01-2 2H4a2 2 0 01-2-2zM2 7l2.5-4h15L22 7M2 11h20' },
];

const GROUP_LABELS: Record<number, Pair> = {
  1: { ne: 'ड्यासबोर्ड', en: 'Dashboards' },
  2: { ne: 'कार्यक्रम', en: 'Event' },
  3: { ne: 'सेटिङ', en: 'Settings' },
  4: { ne: 'अन्य', en: 'More' },
};

/** Where the crumb trail says you are. */
const CRUMB: Record<string, Pair> = {
  live: { ne: 'लाइभ नियन्त्रण', en: 'Live control' },
  attendance: { ne: 'उपस्थिति', en: 'Attendance' },
  moderation: { ne: 'मडेरेसन', en: 'Moderation' },
  events: { ne: 'कार्यक्रम', en: 'Events' },
  content: { ne: 'सामग्री र सारांश', en: 'Files and Summaries' },
  people: { ne: 'वक्ता र टोली', en: 'Speaker and teams' },
  setup: { ne: 'सेटअप', en: 'Setup' },
  reminders: { ne: 'सूचना', en: 'Notifications' },
  profile: { ne: 'प्रोफाइल', en: 'Profile' },
};

interface Props {
  view: string;
  onNavigate: (id: string) => void;
  /** Live counts shown against the rail entries. */
  badges?: Record<string, { text: string; hot?: boolean }>;
  eventName?: string;
  onOpenA11y: () => void;
  children: React.ReactNode;
}

/**
 * The organizer's frame: a white rail down the left and a white header
 * across the top of a pale page.
 *
 * The rail carries the whole product in three named groups, the header
 * carries only where you are and the few controls that belong to the
 * account rather than to any one screen.
 */
export const OrganizerShell: React.FC<Props> = ({
  view, onNavigate, badges = {}, eventName, onOpenA11y, children,
}) => {
  const { user, logout } = useAuthStore();
  const { lang, setLang, t, a11y } = useOrganizer();
  const [railOpen, setRailOpen] = useState(false);

  const who = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
    || user?.email || '';

  const go = (id: string) => {
    onNavigate(id);
    setRailOpen(false);
    window.scrollTo({ top: 0 });
  };

  const rail = (
    <>
      {/* Whose desk this is. */}
      <div className="pb-3">
        <div className="flex items-center gap-2 p-2 rounded-[8px]">
          <span
            className="w-6 h-6 rounded-full bg-black/[.04] text-head grid place-items-center
              text-[11px] font-semibold flex-none"
            aria-hidden
          >
            {(who || '?').charAt(0).toUpperCase()}
          </span>
          <span className="text-[14px] text-black truncate">{who}</span>
        </div>
      </div>

      {[1, 2, 3, 4].map((group) => (
        <div key={group} className="pb-3">
          <div className="px-3 py-1 text-[14px] text-black/40">{t(GROUP_LABELS[group])}</div>
          <nav className="flex flex-col gap-1">
            {NAV.filter((n) => n.group === group).map((item) => {
              const badge = badges[item.id] ?? item.badge;
              const current = view === item.id;
              return (
                <button
                  key={item.id}
                  aria-current={current}
                  onClick={() => go(item.id)}
                  className={`flex items-center gap-2 w-full p-2 rounded-[12px] text-left text-[14px] ${
                    current ? 'bg-black/[.04] text-black font-medium' : 'text-black hover:bg-black/[.02]'
                  }`}
                >
                  <span className={current ? 'text-navy-800' : 'text-black/45'}>
                    <Ic d={item.icon} size={20} />
                  </span>
                  <span className="truncate">{t(item.label)}</span>
                  {badge && (
                    <span
                      className={`ml-auto text-[12px] font-medium rounded-full px-2 leading-[18px] ${
                        badge.hot ? 'bg-live text-white' : 'bg-[#F3F4F6] text-[#364153]'
                      }`}
                    >
                      {badge.text}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      ))}

      {/* The mark sits at the foot of the rail, as the design has it. */}
      <div className="mt-auto pt-4 flex items-center justify-center gap-5">
        <span className="border border-navy-800/15 rounded-[10px] p-0.5 flex items-center">
          <img src={manchMark} alt="" width={30} height={30} />
        </span>
        <span className="text-navy-800 text-[16px] tracking-[7px] font-semibold">MANCH</span>
      </div>
    </>
  );

  return (
    <div
      // Accessibility is applied at the document root now, so the shell
      // only has to state its own base size.
      className="min-h-screen bg-page text-ink font-sans text-[14.5px]"
    >
      <div className="lg:grid min-h-screen" style={{ gridTemplateColumns: '258px minmax(0,1fr)' }}>
        {railOpen && (
          <div className="fixed inset-0 z-40 bg-navy-900/45 lg:hidden" onClick={() => setRailOpen(false)} />
        )}
        <aside
          className={`bg-white border-r-[0.5px] border-black/10 p-4 flex flex-col overflow-y-auto
            lg:sticky lg:top-0 lg:h-screen lg:translate-x-0
            fixed top-0 bottom-0 left-0 w-[258px] z-45 transition-transform ${
              railOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
            }`}
        >
          {rail}
        </aside>

        <div className="min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 bg-white border-b-[0.5px] border-black/10
            flex items-center justify-between gap-4 px-5 sm:px-7 py-4">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setRailOpen((v) => !v)}
                aria-label={t({ ne: 'मेनु', en: 'Menu' })}
                className="lg:hidden w-8 h-8 rounded-lg grid place-items-center border border-line text-subtle"
              >
                <Ic d="M3 6h18M3 12h18M3 18h18" />
              </button>

              {/* Where you are: the section, then the screen. */}
              <nav aria-label={t({ ne: 'बाटो', en: 'Breadcrumb' })} className="flex items-center gap-1 min-w-0">
                <span className="px-3 py-1 text-[14px] text-black/40">
                  {t({ ne: 'कार्यक्रम', en: 'Event' })}
                </span>
                <span className="text-[14px] text-black/10">/</span>
                <span className="px-3 py-1 text-[14px] text-black truncate">
                  {t(CRUMB[view] ?? { ne: 'मञ्च', en: 'Manch' })}
                </span>
              </nav>

              {eventName && (
                <span className="hidden md:flex items-center gap-1.5 min-w-0 bg-[#F9FAFB]
                  border border-line rounded-[10px] px-3 py-1 text-[13px] text-body">
                  <Ic d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" size={14} />
                  <b className="font-medium truncate max-w-[26vw]">{eventName}</b>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-none">
              <div className="inline-flex bg-[#F9FAFB] border border-line rounded-[10px] p-0.5 gap-0.5"
                   role="group" aria-label={t({ ne: 'भाषा', en: 'Language' })}>
                {(['ne', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={`px-2.5 py-1 rounded-[8px] text-[12.5px] ${
                      lang === l ? 'bg-navy-800 text-white font-medium' : 'text-subtle'
                    }`}
                  >
                    {l === 'ne' ? 'नेपाली' : 'English'}
                  </button>
                ))}
              </div>

              <button
                onClick={onOpenA11y}
                aria-pressed={a11y.big || a11y.contrast || a11y.calm}
                title={t({ ne: 'पहुँच', en: 'Accessibility' })}
                className={`w-8 h-8 rounded-[10px] grid place-items-center ${
                  a11y.big || a11y.contrast || a11y.calm
                    ? 'bg-navy-800 text-white'
                    : 'text-subtle hover:bg-black/[.04]'
                }`}
              >
                <Ic d="M12 4.5v.01M4 8h16M12 8v6M12 14l-3 6M12 14l3 6" size={16} />
              </button>

              <Btn sm onClick={logout}>{t({ ne: 'बाहिरिनुहोस्', en: 'Logout' })}</Btn>
            </div>
          </header>

          <main className="px-4 sm:px-7 py-6 pb-24 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
};

/** Small modal shell used by the organizer's dialogs. */
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  lede?: string;
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, onClose, title, lede, wide, children, footer }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center p-4 bg-[#0b1220]/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className={`bg-white rounded-[12px] w-full ${wide ? 'max-w-[720px]' : 'max-w-[520px]'} max-h-[88vh] overflow-auto shadow-2xl`}>
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-[17px] font-medium text-head">{title}</h3>
            {lede && <p className="text-[13.5px] text-subtle mt-1">{lede}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex-none w-7 h-7 rounded-lg grid place-items-center text-faint hover:bg-black/[.04]"
          >
            <Ic d="M18 6L6 18M6 6l12 12" size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex gap-3 px-6 pb-5 justify-end">{footer}</div>}
      </div>
    </div>
  );
};

export { Btn };
