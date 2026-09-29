import React from 'react';
import { useOrganizer } from '../../../organizer/i18n';

/**
 * The parts every settings screen is built from.
 *
 * One place, because the six screens are the same furniture in a
 * different order, and six copies of a row would drift apart the first
 * time one of them was adjusted.
 */

/** A screen reached from the list, with the way back out. */
export const SubHead: React.FC<{
  title: string;
  onBack: () => void;
}> = ({ title, onBack }) => {
  const { t } = useOrganizer();
  return (
    <header
      className="bg-white px-4 pt-3 pb-2 border-b-[0.72px] border-[#b3b3b3]
        flex items-center"
      style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[14px] font-medium
          text-[#9e9e9e] leading-5 flex-none"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {t({ ne: 'पछाडि', en: 'Back' })}
      </button>
      <h1 className="flex-1 min-w-0 pr-[60px] text-center text-[16px]
        font-semibold text-[#101828] leading-[27px]">
        {title}
      </h1>
    </header>
  );
};

/** A white block of rows under a quiet heading. */
export const Block: React.FC<{
  label?: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <section className="bg-white px-4 pt-5 pb-2 flex flex-col gap-1">
    {label && (
      <h2 className="text-[14px] font-medium uppercase text-[#94a3b8]
        leading-[16.5px]">
        {label}
      </h2>
    )}
    {children}
  </section>
);

/** One line of a settings list. A button where it leads somewhere. */
export const Row: React.FC<{
  lead?: React.ReactNode;
  title: string;
  under?: string;
  value?: string;
  strong?: boolean;
  last?: boolean;
  onGo?: () => void;
  trail?: React.ReactNode;
}> = ({ lead, title, under, value, strong, last, onGo, trail }) => {
  const inside = (
    <>
      {lead}
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className="flex-1 min-w-0 text-left">
          <span className={`block text-[14px] leading-[21px] text-[#0f172a] ${
            strong ? 'font-semibold' : 'font-medium'
          }`}>
            {title}
          </span>
          {under && (
            <span className="block text-[12px] leading-[18px] text-[#94a3b8]">
              {under}
            </span>
          )}
        </span>
        {value && (
          <span className="text-[13px] leading-[19.5px] text-[#94a3b8] flex-none">
            {value}
          </span>
        )}
      </span>
      {trail ?? (onGo && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden className="flex-none">
          <path d="M9 6l6 6-6 6" />
        </svg>
      ))}
    </>
  );

  const shape = `w-full min-h-[56px] flex gap-3 items-center ${
    last ? '' : 'border-b-[0.5px] border-[#ccc]'
  }`;

  return onGo
    ? <button type="button" onClick={onGo} className={shape}>{inside}</button>
    : <div className={shape}>{inside}</div>;
};

/** The grey square a settings row wears on its left. */
export const Tile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="size-8 rounded-[8px] bg-[#f3f4f6] grid place-items-center
    flex-none text-[#64748b]" aria-hidden>
    {children}
  </span>
);

/** An emoji standing in for a picture, at the size the design draws it. */
export const Glyph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="w-8 text-center text-[20px] leading-[30px] flex-none"
    aria-hidden>
    {children}
  </span>
);

export const Toggle: React.FC<{
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}> = ({ on, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={() => onChange(!on)}
    className={`w-11 h-[26px] rounded-full p-[3px] flex-none flex items-center
      ${on ? 'bg-[#194d97] justify-end' : 'bg-[#cbd5e1] justify-start'}`}
  >
    <span className="size-5 rounded-full bg-white
      shadow-[0_1px_3px_rgba(0,0,0,0.2)]" />
  </button>
);

export const Radio: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden
    className={`size-5 rounded-full border-[1.835px] grid place-items-center
      flex-none ${on
        ? 'bg-[#194d97] border-[#194d97]'
        : 'border-[#cbd5e1]'}`}
  >
    {on && <span className="size-2 rounded-full bg-white" />}
  </span>
);

/** One of a set of choices, as every preference screen draws them. */
export const Choice: React.FC<{
  lead?: React.ReactNode;
  title: string;
  under?: string;
  on: boolean;
  last?: boolean;
  onPick: () => void;
}> = ({ lead, title, under, on, last, onPick }) => (
  <button
    type="button"
    role="radio"
    aria-checked={on}
    onClick={onPick}
    className={`w-full min-h-[56px] flex gap-3 items-center text-left ${
      last ? '' : 'border-b-[0.5px] border-[#ccc]'
    }`}
  >
    {lead}
    <span className="flex-1 min-w-0">
      <span className={`block text-[14px] leading-[21px] text-[#0f172a] ${
        on ? 'font-semibold' : 'font-normal'
      }`}>
        {title}
      </span>
      {under && (
        <span className="block text-[12px] leading-[18px] text-[#94a3b8]">
          {under}
        </span>
      )}
    </span>
    <Radio on={on} />
  </button>
);
