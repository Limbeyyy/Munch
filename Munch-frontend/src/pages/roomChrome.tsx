import React from 'react';
import { FigmaIcon, FigmaIconName } from '../assets/icons';

/**
 * The pieces every room is drawn from.
 *
 * There are two rooms - the one account holders sit in and the one guests
 * are let into - and they are the same room to look at, because they are
 * the same event. What differs is what each person may do in it, not
 * what it is made of. These lived inside the account holders' page until
 * the guests' one needed them too; nothing about them changed on the way
 * out, only where they live.
 */

/**
 * The head of a side panel: its name centred, and the cross that sends
 * it away again.
 */
export const SidePanelHead: React.FC<{
  title: string;
  badge?: number;
  onClose: () => void;
}> = ({ title, badge = 0, onClose }) => (
  <div className="bg-[#fcfcfc] flex items-center gap-2 px-4 pt-2 pb-1">
    <span className="w-6 flex-none" aria-hidden />
    <h2 className="flex-1 text-[18px] text-black text-center tracking-[-0.09px]">
      {title}
      {badge > 0 && (
        <span className="ms-2 inline-grid place-items-center min-w-[20px] h-5 px-1 align-middle
          text-[11px] font-bold bg-live text-white rounded-full">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </h2>
    <button
      onClick={onClose}
      aria-label={`Close ${title.toLowerCase()}`}
      className="w-6 flex-none text-[#9ea8b7] hover:text-navy-800 text-[20px] leading-none"
    >
      &#10005;
    </button>
  </div>
);

/** A white card, the way every panel in this room is drawn. */
export const RoomCard: React.FC<{
  id?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ id, className = '', children }) => (
  <div
    id={id}
    className={`bg-white border border-[#e3e8ef] rounded-[12px] overflow-hidden ${className}`}
  >
    {children}
  </div>
);

/**
 * A round portrait.
 *
 * The mock uses a stock photograph for everybody; nobody here has one, so
 * the initial stands on the same warm disc rather than a grey box where a
 * face should be.
 */
export const RoomPortrait: React.FC<{ name: string; size: number }> = ({ name, size }) => (
  <span
    className="bg-[#fbecd1] rounded-full grid place-items-center flex-none text-navy-900
      font-semibold overflow-hidden"
    style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    aria-hidden
  >
    {(name || '?').trim().charAt(0).toUpperCase()}
  </span>
);

/** One control on the bar along the foot of the room. */
export const RoomBarButton: React.FC<{
  icon: FigmaIconName;
  label: string;
  onClick: () => void;
  badge?: number;
  tone?: 'default' | 'leave';
  /** Whether the panel this opens is currently beside the room. */
  open?: boolean;
}> = ({ icon, label, onClick, badge = 0, tone = 'default', open }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={open}
    className={`relative flex flex-col items-center gap-[9px] px-3 py-2 rounded-[12px] w-[92px]
      flex-none transition-colors ${open ? 'bg-white/[.16]' : 'hover:bg-white/[.08]'}`}
  >
    <FigmaIcon name={icon} size={24} />
    <span
      className={`text-[14px] tracking-[-0.07px] whitespace-nowrap ${
        tone === 'leave' ? 'text-[#f75656]' : 'text-white'
      }`}
    >
      {label}
    </span>
    {badge > 0 && (
      <span className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 grid place-items-center
        text-[10px] font-bold bg-live text-white rounded-full">
        {badge > 9 ? '9+' : badge}
      </span>
    )}
  </button>
);
