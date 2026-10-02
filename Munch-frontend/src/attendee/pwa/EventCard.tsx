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
  if (days === 0) return t({ ne: 'आज सुरु', en: 'Starts Today' });
  if (days === 1) return t({ ne: 'भोलि सुरु', en: 'Starts Tomorrow' });
  return t({ ne: `${days} दिनमा सुरु`, en: `Starts in ${days} days` });
};

const Pin: React.FC<{ size?: number }> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

const Cal: React.FC<{ size?: number }> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
        <div className="flex-1 flex items-center gap-2 text-[12px] text-[#9ba0ad]">
          <span>
            {t({
              ne: `${num(event.session_count ?? 0)} सत्र`,
              en: `${event.session_count ?? 0} session${(event.session_count ?? 0) === 1 ? '' : 's'}`,
            })}
          </span>
          <span>·</span>
          <span>
            {t({
              ne: `${num(new Set((event.sessions ?? []).map((session) => session.speaker_name?.trim()).filter(Boolean)).size)} वक्ता`,
              en: `${new Set((event.sessions ?? []).map((session) => session.speaker_name?.trim()).filter(Boolean)).size} speaker${new Set((event.sessions ?? []).map((session) => session.speaker_name?.trim()).filter(Boolean)).size === 1 ? '' : 's'}`,
            })}
          </span>
          {detail && <span>· {detail}</span>}
        </div>
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


/* ------------------------------------------------------------------
   The three cards home draws.

   The events list uses the one above, which says the same things in
   one shape. Home says them in three, because the three states are
   asking for different actions: step in, look forward to, look back
   at. A card that offers "View event" for something happening in the
   next room is the wrong card.
   ------------------------------------------------------------------ */

/** What is on the card's bottom line. Sessions, and nothing invented. */
const Counts: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const n = event.session_count ?? 0;
  return (
    <span className="text-[12px] leading-[18px] text-[#64748b]">
      {t({
        ne: `${num(n)} सत्र`,
        en: `${n} session${n === 1 ? '' : 's'}`,
      })}
    </span>
  );
};

const SpeakerCounts: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const speakers = Array.from(
    new Set(
      (event.sessions ?? [])
        .map((session) => session.speaker_name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const n = speakers.length;

  return (
    <span className="text-[12px] leading-[18px] text-[#64748b]">
      {t({
        ne: `${num(n)} वक्ता`,
        en: `${n} speaker${n === 1 ? '' : 's'}`,
      })}
    </span>
  );
};

const Go: React.FC<{ onOpen: () => void; small?: boolean }> = ({
  onOpen, small,
}) => {
  const { t } = useOrganizer();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-center gap-1 font-semibold text-[#2563eb] ${
        small ? 'text-[12px] leading-[18px]' : 'text-[13px] leading-[19.5px]'
      }`}
    >
      {t({ ne: 'हेर्नुहोस्', en: 'View event' })}
      <svg width={small ? 11 : 12} height={small ? 11 : 12} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden>
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    </button>
  );
};

/** Happening now. The only thing worth offering is the way in. */
export const LiveEventCard: React.FC<{
  event: Event;
  onJoin: () => void;
}> = ({ event, onJoin }) => {
  const { t } = useOrganizer();

  return (
    <article className="bg-white border-[0.711px] border-[#f53535] rounded-[16px]
      px-4 pt-4 pb-3
      shadow-[0px_1px_3px_rgba(189,37,40,0.06),0px_1px_2px_rgba(143,2,31,0.04)]">
      <span className="bg-[#efefef] rounded-full px-2.5 py-1 inline-flex
        items-center gap-1.5 text-[11px] font-semibold leading-[16.5px]
        text-[#bc1c1c]">
        <span className="rounded-full size-[8px] bg-[#bc1c1c]" aria-hidden />
        {t({ ne: 'प्रत्यक्ष', en: 'Live' })}
      </span>

      <h3 className="pt-2 text-[17px] font-bold leading-[22.1px] text-[#0f172a]">
        {event.title}
      </h3>

      <div className="pt-2 flex items-center gap-2 text-[12px] leading-[18px] text-[#64748b]">
        <Counts event={event} />
        <span>·</span>
        <SpeakerCounts event={event} />
      </div>

      <div className="pt-2 flex justify-center">
        <button
          type="button"
          onClick={onJoin}
          className="w-[231px] max-w-full bg-[#12386e] text-white rounded-[12px]
            px-6 py-3 text-[16px] leading-6"
        >
          {t({ ne: 'प्रत्यक्षमा सामेल हुनुहोस्', en: 'Join Live' })}
        </button>
      </div>
    </article>
  );
};

/** Still to come. When, where, and how long the wait is. */
export const UpcomingEventCard: React.FC<{
  event: Event;
  onOpen: () => void;
}> = ({ event, onOpen }) => {
  const { t } = useOrganizer();
  const soon = until(event.scheduled_start, t);

  return (
    <article className="bg-white border-[0.711px] border-[#ccc] rounded-[16px] p-4
      drop-shadow-[0px_1px_1.5px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <span className="bg-[#dbeafe] text-[#1d4ed8] rounded-full px-2.5 py-1
          text-[12px] font-semibold leading-4">
          {t({ ne: 'आउँदै', en: 'UPCOMING' })}
        </span>
        {soon && (
          <span className="text-[12px] font-semibold leading-[18px] text-[#2563eb]">
            {soon}
          </span>
        )}
      </div>

      <h3 className="pt-3 text-[17px] font-bold leading-[22.1px] text-[#0f172a]">
        {event.title}
      </h3>

      <p className="pt-2 flex items-center gap-1.5 text-[13px] leading-[19.5px]
        text-[#475569]">
        <span className="text-[#94a3b8]"><Cal /></span>
        {day(event.scheduled_start)} · {clock(event.scheduled_start)}
      </p>
      {event.venue && (
        <p className="pt-1 flex items-center gap-1.5 text-[13px] leading-[19.5px]
          text-[#475569]">
          <span className="text-[#94a3b8]"><Pin /></span>
          {event.venue}
        </p>
      )}

      <div className="pt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] leading-[18px] text-[#64748b]">
          <Counts event={event} />
          <span aria-hidden>·</span>
          <SpeakerCounts event={event} />
        </div>
        <Go onOpen={onOpen} />
      </div>
    </article>
  );
};

/** Over. The title leads, because it is being recognised, not read. */
export const CompletedEventCard: React.FC<{
  event: Event;
  questionCount?: number;
  onOpen: () => void;
}> = ({ event, questionCount, onOpen }) => {
  const { t, num } = useOrganizer();

  return (
    <article className="bg-white border-[0.711px] border-[#ccc] rounded-[16px] p-4
      drop-shadow-[0px_1px_1.5px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-3">
        <h3 className="flex-1 min-w-0 text-[15px] font-bold leading-[19.5px]
          text-[#0f172a]">
          {event.title}
        </h3>
        <span className="bg-[#d0fae5] text-[#15803d] rounded-full px-2.5 py-1
          flex-none text-[12px] font-semibold leading-4">
          {t({ ne: 'सकियो', en: 'COMPLETED' })}
        </span>
      </div>

      <div className="pt-2 flex flex-col gap-1 text-[12px] leading-[18px]
        text-[#64748b]">
        <p className="grid grid-cols-[13px_minmax(0,1fr)] items-start gap-x-1.5">
          <span className="text-[#94a3b8] pt-[2px]"><Cal /></span>
          <span className="min-w-0">
            {day(event.event_date ?? event.scheduled_start)}
          </span>
        </p>
        {event.venue && (
          <p className="grid grid-cols-[13px_minmax(0,1fr)] items-start gap-x-1.5">
            <span className="text-[#94a3b8] pt-[2px]"><Pin /></span>
            <span className="min-w-0 break-words">{event.venue}</span>
          </p>
        )}
      </div>

      <div className="pt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px]
          leading-[18px] text-[#64748b]">
          <Counts event={event} />
          {questionCount !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>
                {t({
                  ne: `${num(questionCount)} प्रश्न`,
                  en: `${questionCount} question${questionCount === 1 ? '' : 's'}`,
                })}
              </span>
            </>
          )}
        </div>
        <Go onOpen={onOpen} small />
      </div>
    </article>
  );
};

/** Completed event in My Events, with the denser details from its list design. */
export const MyEventsCompletedCard: React.FC<{
  event: Event;
  questionCount: number;
  summariesAvailable: boolean;
  onOpen: () => void;
}> = ({ event, questionCount, summariesAvailable, onOpen }) => {
  const { t, num } = useOrganizer();
  const date = new Date(event.event_date ?? event.scheduled_start)
    .toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <article className="bg-white border border-[#e8eaee] rounded-[24px] p-6
      shadow-[0px_1px_3px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[18px] font-semibold leading-[27px]
          text-[#111827]">
          {event.title}
        </h3>
        <span className="flex-none rounded-full bg-[#d1fae5] px-4 py-2
          text-[10px] font-medium leading-[18px] text-[#15803d]">
          {t({ ne: 'सकियो', en: 'COMPLETED' })}
        </span>
      </div>

      <div className="pt-2 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-2
        items-center gap-x-3 gap-y-1 text-[12px] leading-[18px] text-[#64748b]">
        <p className="flex min-w-0 items-center gap-2">
          <span className="flex-none text-[#94a3b8]"><Cal size={16} /></span>
          <span className="min-w-0">{date}</span>
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="row-span-2 flex items-center gap-1 self-center text-[14px]
            font-semibold leading-6 text-[#2563eb]"
        >
          {t({ ne: 'हेर्नुहोस्', en: 'View' })}
          <span aria-hidden>→</span>
        </button>
        {event.venue && (
          <p className="flex min-w-0 items-end gap-2">
            <span className="flex-none pt-1 text-[#94a3b8]"><Pin size={16} /></span>
            <span className="min-w-0 break-words">{event.venue}</span>
          </p>
        )}
      </div>

      <div className="pt-4 flex flex-wrap gap-2.5 text-[12px] leading-[18px]
        text-[#64748b]">
        <span className="rounded-full border border-[#e2e8f0] px-3 py-1">
          {t({
            ne: `${num(event.session_count ?? 0)} सत्र`,
            en: `${event.session_count ?? 0} session${event.session_count === 1 ? '' : 's'}`,
          })}
        </span>
        <span className="rounded-full border border-[#e2e8f0] px-3 py-1">
          {t({
            ne: `${num(questionCount)} प्रश्न`,
            en: `${questionCount} question${questionCount === 1 ? '' : 's'}`,
          })}
        </span>
      </div>

      {summariesAvailable && (
        <div className="pt-3">
          <span className="inline-flex rounded-full bg-[#ecfdf3] px-3 py-1.5
            text-[12px] leading-[18px] text-[#15803d]">
            {t({ ne: 'सारांश उपलब्ध', en: 'Summaries available' })}
          </span>
        </div>
      )}
    </article>
  );
};
