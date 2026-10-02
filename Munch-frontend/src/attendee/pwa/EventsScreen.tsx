import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import { Event } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { EventCard, MyEventsCompletedCard } from './EventCard';
import { ScreenHead } from './PhoneShell';
import { stateOf } from './HomeShell';

type Deck = 'upcoming' | 'completed';

/**
 * Every event this person is part of, split into upcoming and completed.
 */
export const EventsScreen: React.FC<{
  events: Event[];
  deck?: Deck;
  onOpen: (event: Event) => void;
}> = ({ events, deck, onOpen }) => {
  const { t, num } = useOrganizer();
  const [at, setAt] = useState<Deck>(deck ?? 'upcoming');
  const [completedDetails, setCompletedDetails] = useState<Record<string, {
    questionCount: number;
    summariesAvailable: boolean;
  }>>({});

  const decks = useMemo(() => {
    const byStart = (a: Event, b: Event) =>
      +new Date(a.scheduled_start) - +new Date(b.scheduled_start);
    return {
      upcoming: events.filter((one) => stateOf(one) === 'upcoming').sort(byStart),
      completed: events
        .filter((one) => stateOf(one) === 'completed')
        .sort((a, b) => -byStart(a, b)),
    };
  }, [events]);

  useEffect(() => {
    if (at !== 'completed') return;
    let cancelled = false;

    const loadCompletedDetails = async () => {
      const entries = await Promise.all(decks.completed.map(async (event) => {
        const [board, summaries] = await Promise.all([
          apiClient.getHub(event.code).catch(() => null),
          Promise.all((event.sessions ?? []).map((session) =>
            apiClient.getSessionSummary(session.id).catch(() => null)
          )),
        ]);
        return [event.id, {
          questionCount: board?.questions.length ?? 0,
          summariesAvailable: summaries.some(
            (summary) => summary?.is_published && Boolean(summary.body)
          ),
        }] as const;
      }));

      if (!cancelled) setCompletedDetails(Object.fromEntries(entries));
    };

    loadCompletedDetails();
    return () => { cancelled = true; };
  }, [at, decks.completed]);

  const shown = decks[at];

  return (
    <div>
      <ScreenHead title={t({ ne: 'मेरा कार्यक्रम', en: 'My Events' })} />

      <div className="mx-4 mt-3 bg-[#dbe6fa] rounded-[10px] p-1 flex">
        {([
          ['upcoming', t({ ne: 'आउँदै', en: 'Upcoming' })],
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
            : t({ ne: 'सकिएको कार्यक्रम छैन।', en: 'Nothing finished yet.' })}
        </p>
      ) : (
        <div className="px-4 pt-4 flex flex-col gap-3">
          {shown.map((one) => (
            at === 'completed' ? (
              <MyEventsCompletedCard
                key={one.id}
                event={one}
                questionCount={completedDetails[one.id]?.questionCount ?? 0}
                summariesAvailable={completedDetails[one.id]?.summariesAvailable ?? false}
                onOpen={() => onOpen(one)}
              />
            ) : (
              <EventCard key={one.id} event={one} onOpen={() => onOpen(one)} />
            )
          ))}
        </div>
      )}
    </div>
  );
};
