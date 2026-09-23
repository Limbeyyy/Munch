import React, { useEffect, useState } from 'react';
import { Event } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { EVENT_STATE_LABEL, EventState, eventState } from '../sessionState';
import { Btn } from '../ui';
import { DeckTabs, PenGlyph, PlusGlyph, Sheet } from './chrome';

/** Which deck an event belongs on. 'all' is every deck at once. */
export type Deck = 'all' | 'draft' | 'upcoming' | 'live' | 'done';

export const deckOf = (event: Event): Exclude<Deck, 'all'> =>
  event.status === 'draft'
    ? 'draft'
    : event.status === 'ended' || event.status === 'cancelled'
    ? 'done'
    : event.status === 'active'
    ? 'live'
    : 'upcoming';

const DECK_TAG: Record<Deck, Pair> = {
  all: { ne: 'सबै', en: 'All' },
  upcoming: { ne: 'आउँदै', en: 'Upcoming' },
  draft: { ne: 'मस्यौदा', en: 'Draft' },
  live: { ne: 'प्रत्यक्ष', en: 'Live' },
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
const longDay = (at: Date) => at.toLocaleDateString(undefined, {
  day: 'numeric', month: 'long', year: 'numeric',
});

/**
 * When an event runs, in one line.
 *
 * One date and two clock times, which is right for the afternoon most
 * events are - and wrong, silently, for one that runs over more than a
 * day: an event opening on the 23rd and closing on the 25th read as
 * "23 September · 06:10 PM – 07:05 PM", an hour on a Wednesday. The
 * second date is the only thing that says otherwise, so it is printed
 * whenever it differs.
 */
export const whenLine = (event: Event): string => {
  if (!event.scheduled_start) {
    return event.event_date ? longDay(new Date(event.event_date)) : '';
  }

  const from = new Date(event.scheduled_start);
  const to = event.scheduled_end ? new Date(event.scheduled_end) : null;

  // Read off the hours themselves rather than `event_date`, which is a
  // separate field and can lag behind them.
  const opens = `${longDay(from)} · ${clock(event.scheduled_start)}`;
  if (!to || Number.isNaN(+to)) return opens;

  const sameDay = from.toDateString() === to.toDateString();
  return sameDay
    ? `${opens} – ${clock(event.scheduled_end)}`
    : `${opens} – ${longDay(to)} · ${clock(event.scheduled_end)}`;
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
  /** Read a finished event back, which is a different screen from editing. */
  onReadBack: (event: Event) => void;
}

/**
 * A finished event, as the Completed deck draws it.
 *
 * Plain white rather than washed: on a deck where everything is finished
 * the wash says nothing the deck has not already said. What it carries
 * instead is what the event came to - how many agendas ran, how many
 * were asked, how many came - and the way into the record.
 */
const CompletedCard: React.FC<{
  event: Event;
  head?: EventHeadcount;
  onReadBack: () => void;
}> = ({ event, head, onReadBack }) => {
  const { t, num } = useOrganizer();
  const invited = head?.attendees ?? 0;
  const came = event.participant_count ?? 0;
  const rate = invited > 0 ? Math.round((came / invited) * 100) : 0;

  return (
    // Washed the colour of its state, like every other card on this
    // screen. The design draws it plain, but on a page where upcoming is
    // blue and live is red a finished event reading as white made it the
    // one state you had to stop and read the word for.
    <div className="bg-[#e1faea] border-[0.6px] border-[#c1f4d4] rounded-[12px] p-5
      shadow-[0px_4px_3px_rgba(0,0,0,0.04),0px_2px_2px_rgba(0,0,0,0.03)]">
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-medium text-head leading-[22.5px] truncate">
            {event.title}
          </h3>
          <p className="text-[14px] text-subtle leading-5 pt-1">{whenLine(event)}</p>
          {event.venue && (
            <p className="text-[14px] text-subtle leading-5 pt-0.5 truncate">
              {event.venue}
            </p>
          )}
          <div className="flex gap-4 items-center pt-3 text-[12px] text-faint
            leading-4 flex-wrap">
            <span>
              {num(event.session_count ?? 0)} {t({ ne: 'कार्यसूची', en: 'Agendas' })}
            </span>
            <span>
              {num(invited)} {t({ ne: 'निम्तो', en: 'invited' })}
            </span>
            <span>
              {num(came)} {t({ ne: 'आए', en: 'attended' })} · {num(rate)}%
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-8 items-end flex-none">
          <span className="text-[12px] font-medium leading-4 text-[#018030]">
            {t({ ne: 'सकियो', en: 'Completed' })}
          </span>
          <button
            type="button"
            onClick={onReadBack}
            className="bg-navy-800 rounded-[8px] px-5 py-2.5 text-[16px]
              font-medium text-white leading-6 hover:bg-navy-900"
          >
            {t({ ne: 'सारांश हेर्नुहोस्', en: 'View Summary' })}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Every event this host runs, on five decks.
 *
 * An event is one card: what it is called, when and where it happens, and
 * the three numbers that say whether it is ready. The card opens the
 * event; the button on it goes straight to changing it.
 */
export const EventsDashboard: React.FC<Props> = ({
  events, counts, loading, onOpen, onEdit, onCreate, onImport, onReadBack,
}) => {
  const { t, num } = useOrganizer();
  const [deck, setDeck] = useState<Deck>('upcoming');
  const [search, setSearch] = useState('');

  const on = (which: Deck) =>
    which === 'all' ? events : events.filter((e) => deckOf(e) === which);

  // Land on a deck that has something on it, so a host whose events are
  // all still drafts is not shown an empty page.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled || loading || events.length === 0) return;
    const first = (['upcoming', 'live', 'draft', 'done'] as const)
      .find((d) => on(d).length > 0);
    if (first) setDeck(first);
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, events, settled]);

  const showing = on(deck).filter((e) =>
    e.title.toLowerCase().includes(search.trim().toLowerCase())
  );

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

      {/* The five decks 626-6477 names, with the search beside them. */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <DeckTabs
          active={deck}
          onChange={(id) => setDeck(id as Deck)}
          tabs={(['all', 'draft', 'upcoming', 'live', 'done'] as Deck[]).map((id) => ({
            id, label: DECK_TAG[id], count: on(id).length,
          }))}
        />
        <div className="bg-white border border-line rounded-[8px] h-10 px-2.5 mb-2
          flex gap-1 items-center w-full max-w-[320px]">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="5.5" stroke="#7f7d83" strokeWidth="1.3" />
            <path d="M12.5 12.5 L16 16" stroke="#7f7d83" strokeWidth="1.3"
              strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t({ ne: 'खोज्नुहोस्', en: 'Search' })}
            aria-label={t({ ne: 'कार्यक्रम खोज्नुहोस्', en: 'Search events' })}
            className="flex-1 min-w-0 bg-transparent text-[14px] text-head
              placeholder:text-[#7f7d83] outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {loading ? (
          <p className="text-[14px] text-subtle">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
        ) : showing.length === 0 ? (
          <p className="text-[14px] text-subtle">
            {deck === 'upcoming'
              ? t({ ne: 'आउँदो कार्यक्रम छैन।', en: 'Nothing coming up.' })
              : deck === 'draft'
              ? t({ ne: 'मस्यौदा छैन।', en: 'No drafts.' })
              : deck === 'live'
              ? t({ ne: 'अहिले केही चलिरहेको छैन।', en: 'Nothing is running.' })
              : deck === 'done'
              ? t({ ne: 'सकिएको कार्यक्रम छैन।', en: 'Nothing finished yet.' })
              : t({ ne: 'कुनै कार्यक्रम छैन।', en: 'No events.' })}
          </p>
        ) : (
          showing.map((event) => {
            const head = counts[event.id];

            // A finished event is read back rather than worked on, so its
            // card is the one 626-6477 draws: what it came to, and the
            // way into the record of it. Every other deck keeps the card
            // it had, which is a card about getting an event ready.
            if (deckOf(event) === 'done') {
              return (
                <CompletedCard
                  key={event.id}
                  event={event}
                  head={head}
                  onReadBack={() => onReadBack(event)}
                />
              );
            }

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
