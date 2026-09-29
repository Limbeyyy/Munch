import React, { useMemo, useState } from 'react';
import { Event } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { EventCard } from './EventCard';
import { ScreenHead } from './PhoneShell';
import { stateOf } from './HomeShell';

type Deck = 'upcoming' | 'live' | 'completed';

/**
 * Every event this person is part of, on three decks.
 *
 * The design gives two - what is coming and what is over - and one
 * running right now belongs to neither: it is not something to look
 * forward to and not something to look back on, and burying it under
 * "upcoming" is how somebody misses the room they are standing in.
 */
export const EventsScreen: React.FC<{
  events: Event[];
  deck?: Deck;
  onOpen: (event: Event) => void;
}> = ({ events, deck, onOpen }) => {
  const { t, num } = useOrganizer();
  const [at, setAt] = useState<Deck>(deck ?? 'upcoming');

  const decks = useMemo(() => {
    const byStart = (a: Event, b: Event) =>
      +new Date(a.scheduled_start) - +new Date(b.scheduled_start);
    return {
      // Everything still ahead: not started, and anything else that is
      // not over - the design asks for all states but completed.
      upcoming: events.filter((one) => stateOf(one) === 'upcoming').sort(byStart),
      live: events.filter((one) => stateOf(one) === 'live').sort(byStart),
      completed: events
        .filter((one) => stateOf(one) === 'completed')
        .sort((a, b) => -byStart(a, b)),
    };
  }, [events]);

  const shown = decks[at];

  return (
    <div>
      <ScreenHead title={t({ ne: 'मेरा कार्यक्रम', en: 'My Events' })} />

      <div className="mx-4 mt-3 bg-[#dbe6fa] rounded-[10px] p-1 flex">
        {([
          ['upcoming', t({ ne: 'आउँदै', en: 'Upcoming' })],
          ['live', t({ ne: 'प्रत्यक्ष', en: 'Live' })],
          ['completed', t({ ne: 'सकिएका', en: 'Completed' })],
        ] as [Deck, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={at === id}
            onClick={() => setAt(id)}
            className={`flex-1 py-2 rounded-[8px] text-[13px] ${
              at === id
                ? 'bg-white text-[#111726] font-medium shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                : 'text-[#5b6070]'
            }`}
          >
            {label}
            {decks[id].length > 0 && `(${num(decks[id].length)})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {at === 'upcoming'
            ? t({ ne: 'आउँदो कार्यक्रम छैन।', en: 'Nothing coming up.' })
            : at === 'live'
            ? t({ ne: 'अहिले केही चलिरहेको छैन।', en: 'Nothing is running.' })
            : t({ ne: 'सकिएको कार्यक्रम छैन।', en: 'Nothing finished yet.' })}
        </p>
      ) : (
        <div className="px-4 pt-4 flex flex-col gap-3">
          {shown.map((one) => (
            <EventCard key={one.id} event={one} onOpen={() => onOpen(one)} />
          ))}
        </div>
      )}
    </div>
  );
};
