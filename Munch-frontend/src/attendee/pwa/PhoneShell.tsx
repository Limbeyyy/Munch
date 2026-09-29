import React from 'react';
import { Pair, useOrganizer } from '../../organizer/i18n';

/**
 * The frame the attendee app lives in, on a phone.
 *
 * A bar of five along the bottom and whatever is open above it. This is
 * a different shape from the host's screens on purpose: a host works at
 * a desk with a rail down the side, and somebody in the hall is holding
 * a phone in one hand.
 */
export type Section = 'transcript' | 'agenda' | 'board' | 'files' | 'profile';

const LABEL: Record<Section, Pair> = {
  transcript: { ne: 'ट्रान्सक्रिप्ट', en: 'Transcript' },
  agenda: { ne: 'कार्यसूची', en: 'Agenda' },
  board: { ne: 'प्रश्न', en: 'Q&A' },
  files: { ne: 'फाइल', en: 'Files' },
  profile: { ne: 'प्रोफाइल', en: 'Profile' },
};

/** The five glyphs, drawn rather than imported: each is a few strokes. */
const GLYPH: Record<Section, React.ReactNode> = {
  transcript: (
    <>
      <path d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-5 4V6a1 1 0 011-1z" />
      <circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  agenda: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </>
  ),
  board: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.8a2.5 2.5 0 114.2 2c-.9.7-1.4 1.2-1.4 2.2" />
      <circle cx="12.4" cy="17" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  files: (
    <path d="M3.5 7a2 2 0 012-2h3.8l2 2.2h7.2a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20a7 7 0 0114 0" />
    </>
  ),
};

/** A count that has not been looked at yet, on its own tab. */
const Pip: React.FC<{ n: number }> = ({ n }) => {
  const { num } = useOrganizer();
  if (n <= 0) return null;
  return (
    <span className="absolute -top-1 left-1/2 ml-1.5 bg-[#2440c9] text-white
      rounded-full min-w-[17px] h-[17px] px-1 grid place-items-center
      text-[10px] font-semibold leading-none">
      {num(n > 99 ? 99 : n)}
    </span>
  );
};

export const PhoneShell: React.FC<{
  at: Section;
  onGo: (to: Section) => void;
  /** Unread counts against the tabs that carry them. */
  pips?: Partial<Record<Section, number>>;
  /** Given when there is somewhere to go back out to. */
  onLeave?: () => void;
  children: React.ReactNode;
}> = ({ at, onGo, pips = {}, onLeave, children }) => {
  const { t } = useOrganizer();

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col">
      {/* The way back out. Somebody who opened the room from their
          events should not have to close the app to get back to them. */}
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-1.5 px-4 pb-1 text-[13px] text-[#5b6070]"
          style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t({ ne: 'कोठाबाट बाहिर', en: 'Leave room' })}
        </button>
      )}

      {/* Padded for the bar, so the last line of anything scrollable is
          readable rather than sitting behind it. */}
      <main className="flex-1 pb-[76px]">{children}</main>

      <nav
        aria-label={t({ ne: 'मुख्य', en: 'Sections' })}
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#e8eaee]
          flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {(Object.keys(LABEL) as Section[]).map((one) => {
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
                <Pip n={pips[one] ?? 0} />
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

/** The plain title block most of the screens open with. */
export const ScreenHead: React.FC<{ title: string; under?: string }> = ({
  title, under,
}) => (
  <header className="px-4 pt-3 pb-3 border-b border-[#eceef2] text-center">
    <h1 className="text-[17px] font-semibold text-[#111726]">{title}</h1>
    {under && <p className="pt-0.5 text-[12px] text-[#8b90a0]">{under}</p>}
  </header>
);

/** The two-way switch several screens put under their title. */
export function Switcher<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="mx-4 mt-3 bg-[#dbe6fa] rounded-[10px] p-1 flex">
      {options.map((one) => (
        <button
          key={one.id}
          type="button"
          aria-pressed={one.id === value}
          onClick={() => onChange(one.id)}
          className={`flex-1 py-2 rounded-[8px] text-[14px] ${
            one.id === value
              ? 'bg-white text-[#111726] font-medium shadow-[0_1px_2px_rgba(0,0,0,.08)]'
              : 'text-[#5b6070]'
          }`}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}
