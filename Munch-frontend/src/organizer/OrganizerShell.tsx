import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Pair, useOrganizer } from './i18n';
import { Btn, Ic } from './ui';

export interface NavItem {
  id: string;
  group: 1 | 2 | 3;
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

  { id: 'setup', group: 2, label: { ne: 'सेटअप', en: 'Setup' },
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.7 15H3.4a2 2 0 110-4h.2a1.6 1.6 0 001.1-2.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V4a2 2 0 114 0v.2a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.3a2 2 0 110 4h-.2z' },
  { id: 'agenda', group: 2, label: { ne: 'एजेन्डा', en: 'Agenda' },
    icon: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
  { id: 'content', group: 2, label: { ne: 'सामग्री र सारांश', en: 'Files and summaries' },
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h6' },
  { id: 'people', group: 2, label: { ne: 'वक्ता र टोली', en: 'Speakers and team' },
    icon: 'M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8' },

  { id: 'reports', group: 3, label: { ne: 'रिपोर्ट', en: 'Reports' },
    icon: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
  { id: 'settings', group: 3, label: { ne: 'सेटिङ', en: 'Settings' },
    icon: 'M4 6h16M4 12h16M4 18h16' },
];

const GROUP_LABELS: Record<number, Pair> = {
  1: { ne: 'कार्यक्रम चलाउने', en: 'Run the event' },
  2: { ne: 'तयारी', en: 'Prepare' },
  3: { ne: 'पछि', en: 'After' },
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

export const OrganizerShell: React.FC<Props> = ({
  view, onNavigate, badges = {}, eventName, onOpenA11y, children,
}) => {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const { lang, setLang, t, a11y } = useOrganizer();
  const [railOpen, setRailOpen] = useState(false);

  const go = (id: string) => {
    onNavigate(id);
    setRailOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div
      className={`min-h-screen bg-cream text-ink font-sans ${a11y.big ? 'text-[16.5px]' : 'text-[14.5px]'}
        ${a11y.calm ? '[&_*]:!transition-none [&_*]:!animate-none' : ''}`}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-navy-900 text-white flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => setRailOpen((v) => !v)}
          aria-label={t({ ne: 'मेनु', en: 'Menu' })}
          className="lg:hidden w-[34px] h-[34px] rounded-lg grid place-items-center border border-white/20 text-[#C7D8F0]"
        >
          <Ic d="M3 6h18M3 12h18M3 18h18" />
        </button>

        <div className="flex items-center gap-2.5 flex-none">
          <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <rect x="18" y="18" width="28" height="28" rx="4" stroke="#fff" strokeWidth="2.6" />
            <rect x="26" y="26" width="12" height="12" rx="2" fill="#F0A22B" />
            <g stroke="#8FB0DC" strokeWidth="2"><path d="M32 8v8M32 48v8M8 32h8M48 32h8" /></g>
          </svg>
          <div className="leading-none hidden sm:block">
            <b className="text-[17px]">मञ्च</b>
            <span className="block text-[10.5px] text-[#9FB8DC] mt-0.5">
              {t({ ne: 'आयोजक प्यानल', en: 'Organizer' })}
            </span>
          </div>
        </div>

        {eventName && (
          <div className="flex items-center gap-2 min-w-0 bg-white/[.09] border border-white/[.16] rounded-[10px] px-3 py-1 text-[13px] text-[#E4ECF9]">
            <Ic d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" size={14} />
            <b className="font-medium truncate max-w-[36vw]">{eventName}</b>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 flex-none">
          <div className="inline-flex bg-white/10 rounded-lg p-0.5 gap-0.5" role="group"
               aria-label={t({ ne: 'भाषा', en: 'Language' })}>
            {(['ne', 'en'] as const).map((l) => (
              <button
                key={l}
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 rounded-md text-[12.5px] ${
                  lang === l ? 'bg-white text-navy-900 font-semibold' : 'text-[#C7D8F0]'
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
            className={`w-[34px] h-[34px] rounded-lg grid place-items-center border ${
              a11y.big || a11y.contrast || a11y.calm
                ? 'border-amber text-amber'
                : 'border-white/20 text-[#C7D8F0] hover:bg-white/10'
            }`}
          >
            <Ic d="M12 4.5v.01M4 8h16M12 8v6M12 14l-3 6M12 14l3 6" />
          </button>

          <button
            onClick={() => navigate('/dashboard')}
            className="hidden md:inline-flex px-3 py-1.5 rounded-lg border border-white/35 text-[13px] hover:bg-white/10"
          >
            {t({ ne: 'सहभागीले देख्ने रूप', en: 'Attendee view' })}
          </button>
          <button
            onClick={logout}
            className="px-3 py-1.5 rounded-lg border border-white/25 text-[13px] hover:bg-white/10"
          >
            {t({ ne: 'बाहिरिनुहोस्', en: 'Logout' })}
          </button>
        </div>
      </header>

      <div className="lg:grid" style={{ gridTemplateColumns: '230px minmax(0,1fr)' }}>
        {/* Rail */}
        {railOpen && (
          <div className="fixed inset-0 z-40 bg-navy-900/45 lg:hidden" onClick={() => setRailOpen(false)} />
        )}
        <aside
          className={`bg-white border-r border-navy-800/15 px-2.5 pt-3 pb-5 overflow-y-auto
            lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:translate-x-0
            fixed top-[52px] bottom-0 left-0 w-[250px] z-45 transition-transform ${
              railOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
            }`}
        >
          {[1, 2, 3].map((group) => (
            <div key={group}>
              <div className="text-[11px] text-[#6E7C8E] px-2.5 pt-3 pb-1.5 tracking-wide">
                {t(GROUP_LABELS[group])}
              </div>
              <nav className="flex flex-col gap-0.5">
                {NAV.filter((n) => n.group === group).map((item) => {
                  const badge = badges[item.id] ?? item.badge;
                  const current = view === item.id;
                  return (
                    <button
                      key={item.id}
                      aria-current={current}
                      onClick={() => go(item.id)}
                      className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[9px] text-left text-[14px] ${
                        current
                          ? 'bg-navy-800 text-white font-medium'
                          : 'text-ink-2 hover:bg-cream'
                      }`}
                    >
                      <span className={current ? 'text-amber' : ''}>
                        <Ic d={item.icon} />
                      </span>
                      <span className="truncate">{t(item.label)}</span>
                      {badge && (
                        <span
                          className={`ml-auto text-[11px] rounded-full px-2 leading-[18px] ${
                            current
                              ? 'bg-white/20 text-white'
                              : badge.hot
                              ? 'bg-live/[.12] text-live'
                              : 'bg-cream-200 text-ink-2'
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
        </aside>

        <main className="px-4 sm:px-6 py-5 pb-24 min-w-0">{children}</main>
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
      className="fixed inset-0 z-[70] grid place-items-center p-4 bg-navy-900/45"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className={`bg-white rounded-[18px] w-full ${wide ? 'max-w-[720px]' : 'max-w-[460px]'} max-h-[88vh] overflow-auto p-5 shadow-2xl`}>
        <h3 className="text-[19px] font-semibold mb-1">{title}</h3>
        {lede && <p className="text-[13.5px] text-[#6E7C8E]">{lede}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="flex gap-2 mt-4 justify-end">{footer}</div>}
      </div>
    </div>
  );
};

export { Btn };
