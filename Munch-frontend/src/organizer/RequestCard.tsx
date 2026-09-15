import React, { useState } from 'react';
import { Pair, useOrganizer } from './i18n';
import { FigmaIcon } from '../assets/icons';

interface Props {
  title: Pair;
  /** How many are waiting. Nothing is shown when none are. */
  count: number;
  /** Shut to begin with, unless something is already waiting. */
  children: React.ReactNode;
  empty: Pair;
}

/**
 * A queue the host works through, folded away until it has something in it.
 *
 * Two of these sit beside the day: who is asking to come in, and what has
 * been written to the front of the room. Both are usually empty and
 * occasionally urgent, so they say how many are waiting on the outside and
 * open to show them.
 */
export const RequestCard: React.FC<Props> = ({ title, count, children, empty }) => {
  const { t, num } = useOrganizer();
  const [open, setOpen] = useState(false);
  const showing = open || count > 0;

  return (
    <div className="bg-white border border-[#e3e8ef] rounded-[12px] overflow-hidden py-1">
      <button
        type="button"
        aria-expanded={showing}
        onClick={() => setOpen(!showing)}
        className="w-full bg-white border-b border-[#e3e8ef] flex items-center gap-2
          px-4 py-2 hover:bg-[#fcfcfc]"
      >
        <span className="flex-1 flex items-center justify-center gap-1.5">
          <span className="text-[20px] font-medium text-black leading-[1.2]">
            {t(title)}
          </span>
          {count > 0 && (
            <span className="bg-live text-white rounded-full min-w-[19px] h-[19px] px-1
              grid place-items-center text-[12px] font-medium leading-none -mt-3">
              {num(count)}
            </span>
          )}
        </span>
        <FigmaIcon
          name="chevronDown"
          size={22}
          className={showing ? 'rotate-180' : ''}
        />
      </button>

      {showing && (
        <div className="max-h-[320px] overflow-y-auto">
          {count === 0 ? (
            <p className="text-[12px] text-[#656565] px-4 py-3">{t(empty)}</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
};

/** One line in such a queue: who or what, and what may be done about it. */
export const RequestRow: React.FC<{
  name: string;
  under: string;
  actions: React.ReactNode;
}> = ({ name, under, actions }) => (
  <div className="flex items-center gap-2 p-2">
    <span
      className="bg-[#fbecd1] rounded-full w-10 h-10 grid place-items-center flex-none
        text-navy-900 font-semibold text-[15px]"
      aria-hidden
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
    <div className="min-w-0 flex-1 px-1">
      <p className="text-[12px] font-medium text-black leading-[1.2] truncate">{name}</p>
      <p className="text-[12px] text-[#656565] leading-[1.5] truncate">{under}</p>
    </div>
    <div className="flex gap-3 items-center flex-none">{actions}</div>
  </div>
);

/** The buttons those rows carry, in the two weights the design gives them. */
export const RequestButton: React.FC<{
  tone: 'accept' | 'decline' | 'quiet';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ tone, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-[8px] px-3 py-1 text-[12px] font-medium leading-5 disabled:opacity-50 ${
      tone === 'accept'
        ? 'bg-navy-800 hover:bg-navy-700 text-white'
        : tone === 'decline'
        ? 'bg-[#c70036] hover:brightness-110 text-white'
        : 'bg-[#f9fafb] border border-[#e5e7eb] text-[#4a5565] hover:bg-white'
    }`}
  >
    {children}
  </button>
);
