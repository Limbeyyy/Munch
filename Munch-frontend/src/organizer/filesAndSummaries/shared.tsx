import React from 'react';
import { FigmaIcon } from '../../assets/icons';
import { Pair, useOrganizer } from '../i18n';

/**
 * The parts 641-16431 and its siblings draw more than once.
 *
 * Six screens share a search box, a row of filter pills, a card and a
 * pair of buttons. Drawn once each, because a search box that is not the
 * same search box on the next tab is how a section stops looking like
 * one section.
 */

/** The white sheet a screen sits on. */
export const Sheet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white border border-line-soft rounded-[12px] px-8 py-5
    flex flex-col gap-6">
    {children}
  </div>
);

/** The bordered card the lists sit in: agenda groups, summaries, folders. */
export const Slab: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className = '', children }) => (
  <div className={`bg-white border-[0.6px] border-[#ccc] rounded-[12px]
    overflow-hidden
    shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]
    ${className}`}>
    {children}
  </div>
);

export const SearchInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}> = ({ value, onChange, label, className = 'w-full max-w-[381px]' }) => (
  <div className={`bg-white border border-[#ececed] rounded-[8px] h-10 px-2.5
    flex gap-1 items-center shadow-[0px_1.5px_4px_-1px_rgba(10,9,11,0.07)]
    ${className}`}>
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="#7f7d83" strokeWidth="1.3" />
      <path d="M12.5 12.5 L16 16" stroke="#7f7d83" strokeWidth="1.3"
        strokeLinecap="round" />
    </svg>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="flex-1 min-w-0 bg-transparent text-[14px] text-head
        placeholder:text-[#7f7d83] outline-none"
    />
  </div>
);

/**
 * The filter pills, with the chosen one first and carrying a tick.
 *
 * The design puts the selected pill at the head of the row, so the row
 * says what it is showing before it says what else it could show.
 */
export function FilterPills<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: Pair }[];
}) {
  const { t } = useOrganizer();
  const ordered = [
    ...options.filter((one) => one.id === value),
    ...options.filter((one) => one.id !== value),
  ];

  return (
    <div className="flex gap-2.5 items-center flex-wrap">
      {ordered.map((one) => (
        <button
          key={one.id}
          type="button"
          aria-pressed={one.id === value}
          onClick={() => onChange(one.id)}
          className={`rounded-[36px] px-3 py-1.5 flex gap-1 items-center
            text-[12px] leading-5 ${
            one.id === value
              ? 'bg-navy-800 text-white'
              : 'bg-[#e3ecfd] text-[#393939]'
          }`}
        >
          {one.id === value && <FigmaIcon name="checkFill" size={20} />}
          {t(one.label)}
        </button>
      ))}
    </div>
  );
}

/** The navy button at the head of a tab: Add File, New Folder, Upload. */
export const FilledButton: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  children: React.ReactNode;
}> = ({ onClick, disabled, type = 'button', children }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="bg-navy-800 rounded-[12px] px-5 py-2 flex gap-1.5 items-center
      justify-center text-[16px] font-medium text-white leading-6
      hover:bg-navy-900 disabled:opacity-50"
  >
    {children}
  </button>
);

/** The small outlined button on a summary or an agenda: Edit, + Add. */
export const QuietButton: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'grey' | 'navy';
  className?: string;
  children: React.ReactNode;
}> = ({ onClick, disabled, tone = 'grey', className = '', children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`border-[0.6px] rounded-[8px] px-3 py-1.5 text-[12px] leading-4
      text-center disabled:opacity-50 ${
      tone === 'navy'
        ? 'border-navy-600 text-navy-600 hover:bg-navy-600/[.06]'
        : 'border-[#b3b3b3] text-body hover:border-navy-800'
    } ${className}`}
  >
    {children}
  </button>
);

/** One of the three figures over the summaries list. */
export const StatCard: React.FC<{ label: string; value: string }> = ({
  label, value,
}) => (
  <div className="flex-1 bg-white border-[0.6px] border-[#ccc] rounded-[12px]
    px-4 py-4 flex flex-col
    shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]">
    <span className="text-[12px] text-subtle leading-4">{label}</span>
    <span className="pt-1 text-[30px] font-semibold text-head leading-9
      tabular-nums">
      {value}
    </span>
  </div>
);

/** The three tabs of one event: summaries, files, photographs. */
export function UnderlineTabs<T extends string>({ value, onChange, tabs }: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: Pair }[];
}) {
  const { t } = useOrganizer();
  return (
    <div role="tablist" className="border-b-[0.6px] border-[#f3f4f6]
      flex gap-4 items-start">
      {tabs.map((one) => (
        <button
          key={one.id}
          role="tab"
          aria-selected={value === one.id}
          onClick={() => onChange(one.id)}
          className={`px-3 py-2 text-[14px] font-medium leading-5 border-b-2 ${
            value === one.id
              ? 'border-head text-head'
              : 'border-transparent text-subtle'
          }`}
        >
          {t(one.label)}
        </button>
      ))}
    </div>
  );
}

/** Nothing here yet, in the bordered box the design gives it. */
export const NothingYet: React.FC<{ title: string; lede?: string }> = ({
  title, lede,
}) => (
  <div className="border-[0.6px] border-line rounded-[12px] py-10
    flex flex-col items-center gap-1">
    <p className="text-[14px] text-subtle">{title}</p>
    {lede && <p className="text-[12px] text-faint">{lede}</p>}
  </div>
);

export const formatSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
};

/** What kind of file this is, by the name it was saved under. */
export const kindOf = (name: string): string => {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLSX';
  if (['doc', 'docx'].includes(ext)) return 'DOCX';
  if (['ppt', 'pptx'].includes(ext)) return 'PPTX';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'IMG';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'VID';
  return 'FILE';
};

/** The tinted square a file's kind sits in, in that kind's colour. */
const KIND_TINT: Record<string, { bg: string; ink: string }> = {
  PDF: { bg: '#fef2f2', ink: '#ef4444' },
  XLSX: { bg: '#f0fdf4', ink: '#22c55e' },
  DOCX: { bg: '#eff6ff', ink: '#3b82f6' },
  PPTX: { bg: '#fff7ed', ink: '#f97316' },
  IMG: { bg: '#faf5ff', ink: '#a855f7' },
  VID: { bg: '#f0f9ff', ink: '#0ea5e9' },
  FILE: { bg: '#f3f4f6', ink: '#6a7282' },
};

export const KindChip: React.FC<{ kind: string }> = ({ kind }) => {
  const tint = KIND_TINT[kind] ?? KIND_TINT.FILE;
  return (
    <span
      className="rounded-[8px] size-8 flex items-center justify-center
        shrink-0 text-[10px] font-bold leading-[15px]"
      style={{ backgroundColor: tint.bg, color: tint.ink }}
    >
      {kind}
    </span>
  );
};

/** The clock, and the day said the way a list of files says it. */
export const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const dayOf = (iso: string, t: (pair: Pair) => string) => {
  // Counted between the two midnights, not between the two moments: a
  // file shared at eleven last night is a day old at one this morning by
  // the clock, and "Yesterday" by the calendar, which is what a reader
  // means.
  const then = new Date(iso);
  const thenMidnight = new Date(then).setHours(0, 0, 0, 0);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const days = Math.round((midnight - thenMidnight) / 86400000);
  if (days <= 0) return t({ ne: 'आज', en: 'Today' });
  if (days === 1) return t({ ne: 'हिजो', en: 'Yesterday' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** The day, the hours and the room, as the event header writes them. */
export const whenAndWhere = (event: {
  scheduled_start: string; scheduled_end: string; venue?: string | null;
}) => {
  const start = new Date(event.scheduled_start);
  return [
    start.toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    }),
    `${clockOf(event.scheduled_start)} – ${clockOf(event.scheduled_end)}`,
    event.venue,
  ].filter(Boolean).join(' · ');
};
