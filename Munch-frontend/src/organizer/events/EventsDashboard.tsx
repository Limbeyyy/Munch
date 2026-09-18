import React, { useEffect, useState } from 'react';
import { Event } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { EVENT_STATE_LABEL, EventState, eventState } from '../sessionState';
import { Btn } from '../ui';
import { DeckTabs, PenGlyph, PlusGlyph, Sheet } from './chrome';

/** Which of the three decks an event belongs on. */
export const deckOf = (event: Event): 'upcoming' | 'draft' | 'done' =>
  event.status === 'draft'
    ? 'draft'
    : event.status === 'ended' || event.status === 'cancelled'
    ? 'done'
    : 'upcoming';

const DECK_TAG = {
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
  draft: { ne: 'मस्यौदा', en: 'Draft' },
  done: { ne: 'सकियो', en: 'Completed' },
};

/**
 * What a card says about itself.
 *
 * Which deck an event is filed under and what state it is in are two
 * different questions, and the card used to answer the first while
 * appearing to answer the second: an event whose hour had come and gone
 * unopened sat under Upcoming, so its tag read "Upcoming" while every
 * other screen called it "Not started".
 *
 * A draft has no state to read - it has never been scheduled for
 * anything - so it keeps the deck's own word. Everything else says what
 * `eventState` says, which is what the agenda and the room say too.
 */
export type CardTag = 'draft' | EventState;

export const tagOf = (event: Event): CardTag =>
  event.status === 'draft' ? 'draft' : eventState(event);

const TAG_LABEL: Record<CardTag, Pair> = {
  ...EVENT_STATE_LABEL,
  draft: DECK_TAG.draft,
  // The same state the rest of the product calls "Finished", under the
  // word this screen's own deck uses for it.
  finished: DECK_TAG.done,
};

/**
 * The colour a card is washed in, which is the colour of its state.
 *
 * The tag and the card are the same hue at two strengths, so how an event
 * stands can be read from across the page without stopping for the word.
 */
const TAG_PAINT: Record<CardTag, { card: string; tag: string; ink: string }> = {
  upcoming: { card: 'bg-[#eff6ff]', tag: 'bg-[#dbeafe]', ink: 'text-[#1447e6]' },
  draft: { card: 'bg-[#f5f5f5]', tag: 'bg-[#e1e1e1]', ink: 'text-[#656565]' },
  // Its hour has come and nobody has opened it, which is the one state
  // on this page worth catching an eye.
  'not-started': { card: 'bg-[#fefbf0]', tag: 'bg-[#fdf0d5]', ink: 'text-[#b26a00]' },
  live: { card: 'bg-[#fdecea]', tag: 'bg-[#fbd9d5]', ink: 'text-[#ce3a2b]' },
  finished: { card: 'bg-[#e1faea]', tag: 'bg-[#ebfbf1]', ink: 'text-[#019939]' },
  'never-started': { card: 'bg-[#f5f5f5]', tag: 'bg-[#e1e1e1]', ink: 'text-[#656565]' },
};

/**
 * Whether an event is ready to be run rather than still being written.
 *
 * Two things make the difference between a page of notes and an event:
 * something to run, and somebody to run it for. Until both are there the
 * card offers to carry on setting it up rather than to edit it.
 */
export const isSetUp = (event: Event, head?: EventHeadcount): boolean =>
  (event.session_count ?? 0) > 0 && (head?.attendees ?? 0) > 0;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "15 September 2026 · 10:00 AM – 12:00 PM", from the day's events. */
export const whenLine = (event: Event): string => {
  const day = new Date(event.event_date ?? event.scheduled_start)
    .toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  if (!event.scheduled_start) return day;
  return `${day} · ${clock(event.scheduled_start)} – ${clock(event.scheduled_end)}`;
};

/** How many people stand beside the host, and how many were asked along. */
export interface EventHeadcount {
  coHosts: number;
  attendees: number;
}

interface Props {
  events: Event[];
  counts: Record<string, EventHeadcount>;
  loading: boolean;
  onOpen: (event: Event) => void;
  onEdit: (event: Event) => void;
  onCreate: () => void;
  /** Kept from the old screen: a whole programme out of a spreadsheet. */
  onImport: () => void;
}

/**
 * Every event this host runs, on three decks.
 *
 * An event is one card: what it is called, when and where it happens, and
 * the three numbers that say whether it is ready. The card opens the
 * event; the button on it goes straight to changing it.
 */
export const EventsDashboard: React.FC<Props> = ({
  events, counts, loading, onOpen, onEdit, onCreate, onImport,
}) => {
  const { t, num } = useOrganizer();
  const [deck, setDeck] = useState<'upcoming' | 'draft' | 'done'>('upcoming');

  const on = (which: 'upcoming' | 'draft' | 'done') =>
    events.filter((e) => deckOf(e) === which);

  // Land on a deck that has something on it, so a host whose events are
  // all still drafts is not shown an empty page.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled || loading || events.length === 0) return;
    const first = (['upcoming', 'draft', 'done'] as const).find((d) => on(d).length > 0);
    if (first) setDeck(first);
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, events, settled]);

  const showing = on(deck);

  return (
    <Sheet>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium text-head leading-[1.2]">
            {t({ ne: 'कार्यक्रम', en: 'Events' })}
          </h1>
          <p className="text-[14px] text-body leading-[1.5] mt-2">
            {t({ ne: 'बैठकका लागि कार्यक्रम तयार गर्नुहोस्', en: 'setup event for events' })}
          </p>
        </div>
        <div className="flex gap-3 flex-none">
          <Btn onClick={onImport}>{t({ ne: 'पानाबाट ल्याउने', en: 'Import from a sheet' })}</Btn>
          <Btn tone="solid" className="px-5 py-3 text-[16px]" onClick={onCreate}>
            <PlusGlyph />
            {t({ ne: 'नयाँ कार्यक्रम बनाउनुहोस्', en: 'Create New Event' })}
          </Btn>
        </div>
      </div>

      <DeckTabs
        active={deck}
        onChange={(id) => setDeck(id as typeof deck)}
        tabs={[
          { id: 'upcoming', label: DECK_TAG.upcoming, count: on('upcoming').length },
          { id: 'draft', label: DECK_TAG.draft, count: on('draft').length },
          { id: 'done', label: DECK_TAG.done, count: on('done').length },
        ]}
      />

      <div className="flex flex-col gap-5">
        {loading ? (
          <p className="text-[14px] text-subtle">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
        ) : showing.length === 0 ? (
          <p className="text-[14px] text-subtle">
            {deck === 'upcoming'
              ? t({ ne: 'आउँदो कार्यक्रम छैन।', en: 'Nothing coming up.' })
              : deck === 'draft'
              ? t({ ne: 'मस्यौदा छैन।', en: 'No drafts.' })
              : t({ ne: 'सकिएको कार्यक्रम छैन।', en: 'Nothing finished yet.' })}
          </p>
        ) : (
          showing.map((event) => {
            const head = counts[event.id];
            const tag = tagOf(event);
            const paint = TAG_PAINT[tag];
            const ready = isSetUp(event, head);
            return (
              <div
                key={event.id}
                className={`${paint.card} border-[0.6px] border-line rounded-[12px] p-5
                  hover:border-navy-800/40 transition-colors`}
              >
                <div className="flex gap-4 items-start">
                  <button
                    onClick={() => onOpen(event)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <h3 className="text-[15px] font-medium text-head leading-[22.5px] pt-1 truncate">
                      {event.title}
                    </h3>
                    <p className="text-[14px] text-subtle leading-5 pt-1">{whenLine(event)}</p>
                    {event.venue && (
                      <p className="text-[14px] text-subtle leading-5 pt-0.5 truncate">
                        {event.venue}
                      </p>
                    )}
                    <div className="flex gap-4 items-center pt-3 text-[12px] text-faint leading-4 flex-wrap">
                      <span>
                        {num(event.session_count ?? 0)} {t({ ne: 'सत्र', en: 'sessions' })}
                      </span>
                      <span>
                        {num(head?.coHosts ?? 0)} {t({ ne: 'सह-आयोजक', en: 'co-hosts' })}
                      </span>
                      <span>
                        {num(head?.attendees ?? 0)} {t({ ne: 'सहभागी', en: 'attendees' })}
                      </span>
                    </div>
                  </button>

                  <div className="flex flex-col gap-8 items-end flex-none">
                    <span className={`${paint.tag} ${paint.ink} rounded-[4px] px-2 py-0.5
                      text-[12px] font-medium leading-4`}>
                      {t(TAG_LABEL[tag])}
                    </span>
                    <Btn
                      onClick={() => onEdit(event)}
                      className="border-navy-800 bg-transparent hover:bg-white/60"
                    >
                      <PenGlyph />
                      {ready
                        ? t({ ne: 'सम्पादन', en: 'Edit' })
                        : t({ ne: 'सेटअप जारी राख्नुहोस्', en: 'Continue Setup' })}
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Sheet>
  );
};
