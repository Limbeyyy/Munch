import React from 'react';
import { Pair, useOrganizer } from '../i18n';
import { Ic } from '../ui';
import plusIcon from '../../assets/icons/plus.svg';
import penNib from '../../assets/icons/pen-nib.svg';

/** The design's two small button glyphs, exported from the file itself. */
export const PlusGlyph: React.FC = () => (
  <span className="size-[16px] overflow-clip flex-none" aria-hidden>
    <img src={plusIcon} alt="" width={16} height={16} />
  </span>
);

export const PenGlyph: React.FC = () => (
  <span className="size-[16px] overflow-clip flex-none" aria-hidden>
    <img src={penNib} alt="" width={16} height={16} />
  </span>
);

/**
 * The sheet every event screen is drawn on: one white card holding the
 * whole screen, rather than a page of loose panels.
 */
export const Sheet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white border border-line-soft rounded-[12px] px-5 sm:px-8 py-5
    flex flex-col gap-8 overflow-hidden">
    {children}
  </div>
);

/** A row of tabs with a count against each, underlined where selected. */
export const DeckTabs: React.FC<{
  tabs: { id: string; label: Pair; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => {
  const { t, num } = useOrganizer();
  return (
    // Wrapping rather than scrolling. `overflow-x-auto` made a scroll
    // container of a row three tabs wide, which clipped the one-pixel
    // overhang the active tab's underline needs and put a pair of
    // stepper arrows in the corner doing nothing.
    <div className="flex gap-1 border-b border-line flex-wrap" role="tablist">
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-[14px]
              font-medium whitespace-nowrap ${
                on ? 'border-head text-head' : 'border-transparent text-subtle hover:text-body'
              }`}
          >
            {t(tab.label)}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-[12px] font-medium leading-[19px] ${
                  on ? 'bg-[#F3F4F6] text-[#364153]' : 'bg-[#F3F4F6] text-faint'
                }`}
              >
                {num(tab.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

/** The way back out of a screen that was opened from a list. */
export const BackLink: React.FC<{ label: Pair; onClick: () => void }> = ({ label, onClick }) => {
  const { t } = useOrganizer();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 text-[14px] text-head hover:text-navy-800"
    >
      <Ic d="M15 18l-6-6 6-6" size={18} />
      {t(label)}
    </button>
  );
};

/** Title, the one line that says when and where, and an action. */
export const EventHeading: React.FC<{
  title: string;
  under: string;
  action?: React.ReactNode;
}> = ({ title, under, action }) => (
  <div className="flex items-start gap-4 flex-wrap">
    <div className="min-w-0">
      <h1 className="text-[26px] font-medium text-head leading-[1.2]">{title}</h1>
      <p className="text-[14px] text-body leading-[1.5] mt-1.5">{under}</p>
    </div>
    {action && <div className="ml-auto flex-none">{action}</div>}
  </div>
);

/**
 * How far through making an event you are.
 *
 * A step behind you is a tick, the one you are on is its own number in
 * navy, and the ones ahead are grey. The rule between two steps is navy
 * as far as you have gone.
 */
export const Stepper: React.FC<{
  steps: Pair[];
  /** Zero-based. */
  at: number;
  onGo?: (index: number) => void;
}> = ({ steps, at, onGo }) => {
  const { t, num } = useOrganizer();
  return (
    <ol className="flex items-start">
      {steps.map((label, i) => {
        const done = i < at;
        const here = i === at;
        const dot = (
          <span
            className={`w-[26px] h-[26px] rounded-full grid place-items-center text-[13px]
              font-medium flex-none ${
                done || here ? 'bg-navy-800 text-white' : 'bg-[#E5E7EB] text-faint'
              } ${here ? 'ring-4 ring-navy-800/15' : ''}`}
          >
            {done ? <Ic d="M4 12l5 5L20 6" size={14} /> : num(i + 1)}
          </span>
        );
        return (
          <li key={i} className={`flex items-start ${i === steps.length - 1 ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center gap-2 flex-none">
              {onGo && done ? (
                <button onClick={() => onGo(i)} aria-label={t(label)}>{dot}</button>
              ) : dot}
              <span className={`text-[13px] whitespace-nowrap ${
                here ? 'text-navy-800 font-medium' : done ? 'text-body' : 'text-faint'
              }`}>
                {t(label)}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={`flex-1 h-[2px] mt-[12px] mx-2 rounded-full ${
                  done ? 'bg-navy-800' : 'bg-[#E5E7EB]'
                }`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
};

/** A card inside the sheet, with its label in small caps and a link. */
export const Block: React.FC<{
  label: Pair;
  link?: { label: Pair; onClick: () => void };
  children: React.ReactNode;
}> = ({ label, link, children }) => {
  const { t } = useOrganizer();
  return (
    <section className="bg-white border border-line rounded-[12px] p-5">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-[12px] font-medium tracking-[.06em] uppercase text-subtle">
          {t(label)}
        </h2>
        {link && (
          <button
            onClick={link.onClick}
            className="ml-auto text-[13px] text-tagink hover:underline"
          >
            {t(link.label)}
          </button>
        )}
      </div>
      {children}
    </section>
  );
};

/** One line of the readiness list: done, or still to do. */
export const ReadyRow: React.FC<{ done: boolean; children: React.ReactNode }> = ({
  done, children,
}) => (
  <li className="flex items-center gap-2.5 text-[14px] text-head">
    <span
      className={`w-[18px] h-[18px] rounded-full grid place-items-center flex-none text-white ${
        done ? 'bg-ok' : 'bg-[#E5E7EB]'
      }`}
      aria-hidden
    >
      <Ic d="M4 12l5 5L20 6" size={11} />
    </span>
    <span className={done ? '' : 'text-faint'}>{children}</span>
  </li>
);

/** The amber note the design puts under a list that is not quite right. */
export const Caution: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-center gap-2 bg-[#FEFBF0] border border-[#F6E6BE] rounded-[8px]
    px-3 py-2 text-[13px] text-[#8A6100]">
    <span className="flex-none text-[#C99A16]"><Ic d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" size={15} /></span>
    {children}
  </p>
);
