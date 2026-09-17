import React from 'react';
import { Pair, useOrganizer } from './i18n';

/** Inline icon from a path, matching the organizer's line weight. */
export const Ic: React.FC<{ d: string; size?: number }> = ({ d, size = 17 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

type BtnTone = 'plain' | 'solid' | 'amber' | 'danger';

export const Btn: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; sm?: boolean }
> = ({ tone = 'plain', sm, className = '', ...rest }) => {
  // The design draws two weights of button: navy for the action being
  // asked for, and a pale one outlined in the same navy for everything
  // else. `amber` was the old palette's primary, so it is now the new
  // primary - every call site asking for the loudest button still gets it.
  const tones: Record<BtnTone, string> = {
    plain: 'bg-[#F9FAFB] border-line text-body hover:bg-white hover:border-navy-800',
    solid: 'bg-navy-800 border-navy-800 text-white hover:bg-navy-700',
    amber: 'bg-navy-800 border-navy-800 text-white hover:bg-navy-700',
    danger: 'bg-white border-live/35 text-live hover:bg-live/5',
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[12px] border font-medium
        disabled:opacity-50 disabled:cursor-not-allowed transition
        ${sm ? 'px-3 py-1.5 text-[12.5px] rounded-[10px]' : 'px-4 py-2.5 text-[14px]'}
        ${tones[tone]} ${className}`}
    />
  );
};

type ChipTone = 'default' | 'ok' | 'live' | 'warn' | 'draft' | 'lock';

export const Chip: React.FC<{ tone?: ChipTone; children: React.ReactNode }> = ({
  tone = 'default',
  children,
}) => {
  const tones: Record<ChipTone, string> = {
    default: 'bg-tagbg text-tagink',
    ok: 'bg-ok/10 text-ok',
    live: 'bg-live/10 text-live',
    warn: 'bg-[#FEF6E7] text-[#B26A00]',
    draft: 'bg-[#F3F4F6] text-subtle',
    lock: 'bg-[#F3F4F6] text-navy-800',
  };
  return (
    <span
      className={`inline-block text-[12px] font-medium leading-[16px] py-0.5 px-2 rounded-[4px] whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
};

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <div className={`bg-white border border-line-soft rounded-[12px] p-5 ${className}`}>{children}</div>
);

export const Panel: React.FC<{
  title?: React.ReactNode;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, aside, actions, children }) => (
  <div className="bg-white border border-line-soft rounded-[12px] overflow-hidden">
    {(title || actions) && (
      <div className="px-5 py-3.5 border-b border-line flex items-center gap-2.5">
        {title && <h2 className="text-[15px] font-medium text-head">{title}</h2>}
        {aside}
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </div>
);

/** Page heading with an optional action cluster on the right. */
export const Head: React.FC<{ title: Pair; lede?: Pair; actions?: React.ReactNode }> = ({
  title,
  lede,
  actions,
}) => {
  const { t } = useOrganizer();
  return (
    <div className="flex items-start gap-3.5 flex-wrap mb-4">
      <div>
        <h1 className="text-[24px] font-medium text-head leading-[1.2]">{t(title)}</h1>
        {lede && <p className="text-[14px] text-body leading-[1.5] mt-2 max-w-[70ch]">{t(lede)}</p>}
      </div>
      {actions && <div className="ml-auto flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
};

export const Tabs: React.FC<{
  tabs: { id: string; label: Pair }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => {
  const { t } = useOrganizer();
  return (
    // Wrapping rather than scrolling. A scrollable row is a scrollbar,
    // and a scrollbar on a strip two tabs wide is a pair of stepper
    // arrows sitting in the corner of the card doing nothing.
    <div className="flex gap-1 border-b border-navy-800/15 mb-4 flex-wrap" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3.5 py-2 text-[13.5px] whitespace-nowrap -mb-px border-b-2 ${
            active === tab.id
              ? 'text-navy-800 border-amber font-semibold'
              : 'text-[#6E7C8E] border-transparent'
          }`}
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  );
};

/** A labelled on/off control, styled as the organizer's switch. */
export const Switch: React.FC<{
  on: boolean;
  onToggle: () => void;
  label: Pair;
  hint?: Pair;
  disabled?: boolean;
}> = ({ on, onToggle, label, hint, disabled }) => {
  const { t } = useOrganizer();
  return (
    <button
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex items-start gap-2.5 text-left text-[13.5px] text-ink-2 disabled:opacity-50"
    >
      <span
        className={`w-[38px] h-[22px] rounded-full relative flex-none mt-0.5 transition-colors ${
          on ? 'bg-ok' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
            on ? 'translate-x-4' : ''
          }`}
        />
      </span>
      <span>
        <b className="font-medium">{t(label)}</b>
        {hint && <><br /><span className="text-[12.5px] text-[#6E7C8E]">{t(hint)}</span></>}
      </span>
    </button>
  );
};

/** Key figures strip. */
export const Kpi: React.FC<{ items: { value: React.ReactNode; label: Pair }[] }> = ({ items }) => {
  const { t } = useOrganizer();
  return (
    <div className="grid gap-px bg-line border border-line rounded-[12px] overflow-hidden"
         style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
      {items.map((item, i) => (
        <div key={i} className="bg-white px-3.5 py-3">
          <b className="block text-[22px] font-semibold tracking-tight tabular-nums">{item.value}</b>
          <span className="text-[12.5px] text-subtle">{t(item.label)}</span>
        </div>
      ))}
    </div>
  );
};

/** Horizontal proportion bar used by attendance and reports. */
export const BarRow: React.FC<{ label: string; pct: number; right: string }> = ({
  label, pct, right,
}) => (
  <div className="grid items-center gap-3 py-1.5 text-[13px]"
       style={{ gridTemplateColumns: 'minmax(120px,180px) minmax(0,1fr) 54px' }}>
    <span className="truncate">{label}</span>
    <span className="h-2.5 bg-[#F3F4F6] rounded-md overflow-hidden">
      <i
        className={`block h-full rounded-md ${pct < 70 ? 'bg-amber' : 'bg-navy-500'}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </span>
    <span className="tabular-nums text-right">{right}</span>
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[12.5px] text-subtle px-5 py-5">{children}</p>
);
