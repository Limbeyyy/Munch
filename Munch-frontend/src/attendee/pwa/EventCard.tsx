import React from 'react';
import { Event } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { StateChip, stateOf } from './HomeShell';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** How long until it opens, in the words a card uses for it. */
const until = (iso: string, t: (pair: { ne: string; en: string }) => string) => {
  const days = Math.ceil((+new Date(iso) - Date.now()) / 86400000);
  if (days < 0) return '';
  if (days === 0) return t({ ne: 'आज सुरु', en: 'Starts today' });
  if (days === 1) return t({ ne: 'भोलि सुरु', en: 'Starts tomorrow' });
  return t({ ne: `${days} दिनमा सुरु`, en: `Starts in ${days} days` });
};

const Pin: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

const Cal: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
  </svg>
);

/**
 * One event, as every list of them draws it.
 *
 * What it is, when and where, and the two numbers worth knowing before
 * opening it. The line at the top right changes with the state: a
 * countdown for something coming, nothing for something over.
 */
export const EventCard: React.FC<{
  event: Event;
  /** The second figure: talks given, or questions asked. */
  detail?: string;
  onOpen: () => void;
}> = ({ event, detail, onOpen }) => {
  const { t, num } = useOrganizer();
  const state = stateOf(event);
  const soon = state === 'upcoming' ? until(event.scheduled_start, t) : '';

  return (
    <article className="border border-[#e8eaee] rounded-[14px] p-4">
      <div className="flex items-start gap-3">
        <StateChip state={state} />
        {soon && (
          <span className="ms-auto text-[12px] font-medium text-[#2440c9]">
            {soon}
          </span>
        )}
      </div>

      <h3 className="pt-2.5 text-[17px] font-semibold text-[#111726] leading-snug">
        {event.title}
      </h3>

      <p className="pt-2 flex items-center gap-1.5 text-[13px] text-[#5b6070]">
        <span className="text-[#9ba0ad]"><Cal /></span>
        {day(event.event_date ?? event.scheduled_start)}
        {state === 'upcoming' && ` · ${clock(event.scheduled_start)}`}
      </p>
      {event.venue && (
        <p className="pt-1 flex items-center gap-1.5 text-[13px] text-[#5b6070]">
          <span className="text-[#9ba0ad]"><Pin /></span>
          {event.venue}
        </p>
      )}

      <div className="pt-3 flex items-center gap-3">
        <span className="flex-1 text-[12px] text-[#9ba0ad]">
          {t({
            ne: `${num(event.session_count ?? 0)} सत्र`,
            en: `${event.session_count ?? 0} sessions`,
          })}
          {detail && ` · ${detail}`}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="text-[13px] font-medium text-[#2440c9] flex items-center gap-1"
        >
          {t({ ne: 'हेर्नुहोस्', en: 'View event' })}
          <span aria-hidden>→</span>
        </button>
      </div>
    </article>
  );
};
