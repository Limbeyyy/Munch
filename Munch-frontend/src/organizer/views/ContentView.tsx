import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import { Artifact, Event, PhotoPage, Session } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { eventState } from '../sessionState';
import {
  FilesTab, PhotosTab, SummariesTab,
} from '../filesAndSummaries';
import {
  FilledButton, NothingYet, SearchInput, Sheet, UnderlineTabs, FilterPills,
  whenAndWhere,
} from '../filesAndSummaries/shared';

interface Props { events: Event[]; }

/** Which tab of one event is open. */
type Tab = 'summaries' | 'files' | 'photos';

/** Which events the grid is showing. */
type Filter = 'all' | 'completed' | 'upcoming';

const TAB_LABEL: Record<Tab, Pair> = {
  summaries: { ne: 'सारांश', en: 'Summaries' },
  files: { ne: 'फाइल', en: 'Files' },
  photos: { ne: 'तस्बिर', en: 'Photos' },
};

/** What one event's card has to count, gathered once per event. */
interface Tally {
  folders: number;
  agendas: number;
  summaries: number;
  files: number;
}

/**
 * Everything an event produced, event by event.
 *
 * Two screens. The first is the events themselves, because a summary or
 * a handout belongs to one of them and there is no useful list across
 * all of them at once. The second is one event's three kinds of output:
 * what was written about it, what was shared at it, and what was
 * photographed.
 */
export const ContentView: React.FC<Props> = ({ events }) => {
  const { t, num } = useOrganizer();

  const [opened, setOpened] = useState('');
  const [tab, setTab] = useState<Tab>('summaries');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tallies, setTallies] = useState<Record<string, Tally>>({});

  /**
   * What each card counts.
   *
   * Four numbers from three places, so they are gathered here rather
   * than by each card: a grid of cards each fetching its own would open
   * three requests per event the moment the page loads.
   */
  const count = useCallback(async () => {
    const got = await Promise.all(events.map(async (one) => {
      const [sessions, files, photos] = await Promise.all([
        apiClient.listSessions(one.id).catch(() => [] as Session[]),
        apiClient.getResources(one.id).catch(() => [] as Artifact[]),
        apiClient.getPhotos(one.code).catch(() => null as PhotoPage | null),
      ]);
      const summaries = await Promise.all(
        sessions.map((session) =>
          apiClient.getSessionSummary(session.id)
            .then((summary) => summary.saved)
            .catch(() => false)
        )
      );
      return [one.id, {
        folders: photos?.folders.length ?? 0,
        agendas: sessions.length,
        summaries: summaries.filter(Boolean).length,
        files: files.length,
      }] as const;
    }));
    setTallies(Object.fromEntries(got));
  }, [events]);

  useEffect(() => { count(); }, [count]);

  const event = events.find((one) => one.id === opened);

  const shown = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    return events.filter((one) => {
      if (!one.title.toLowerCase().includes(wanted)) return false;
      if (filter === 'all') return true;
      const done = eventState(one) === 'finished';
      return filter === 'completed' ? done : !done;
    });
  }, [events, search, filter]);

  // -- the events --------------------------------------------------------

  if (!event) {
    return (
      <Sheet>
        <div>
          <h1 className="text-[24px] font-medium text-head leading-[1.2]">
            {t({ ne: 'सामग्री र सारांश', en: 'Files and Summaries' })}
          </h1>
          <p className="pt-2 text-[14px] text-body leading-[1.5]">
            {t({
              ne: 'कार्यक्रमका सारांश, फाइल र तस्बिर।',
              en: 'setup event for meetings',
            })}
          </p>
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          <SearchInput
            value={search}
            onChange={setSearch}
            label={t({ ne: 'खोज्नुहोस्', en: 'Search' })}
          />
          <FilterPills<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: { ne: 'सबै', en: 'All' } },
              { id: 'completed', label: { ne: 'सकिएका', en: 'Completed' } },
              { id: 'upcoming', label: { ne: 'आउँदै', en: 'Upcoming' } },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <NothingYet
            title={t({ ne: 'कुनै कार्यक्रम भेटिएन', en: 'No events matched' })}
          />
        ) : (
          <div className="grid gap-8"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
            {shown.map((one) => {
              const done = eventState(one) === 'finished';
              const tally = tallies[one.id];
              return (
                <article
                  key={one.id}
                  className={`border-[0.6px] rounded-[12px] px-4 py-3
                    flex flex-col gap-4
                    shadow-[0px_4px_3px_rgba(0,0,0,0.1),0px_2px_2px_rgba(0,0,0,0.05)] ${
                    done
                      ? 'bg-[#ebfbf1] border-[#c1f4d4]'
                      : 'bg-white border-line'
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    <span className="self-end">
                      <span
                        className={`bg-white border rounded-[4px] px-2 py-0.5
                          text-[12px] font-medium leading-4 ${
                          done
                            ? 'border-[#016626] text-[#018030]'
                            : 'border-[#0279cf] text-[#4272dd]'
                        }`}
                      >
                        {done
                          ? t({ ne: 'सकियो', en: 'Completed' })
                          : t({ ne: 'आउँदै', en: 'Upcoming' })}
                      </span>
                    </span>

                    <div className="flex flex-col gap-1">
                      <h3 className="pt-2 text-[20px] font-semibold text-head
                        leading-[20.625px]">
                        {one.title}
                      </h3>
                      <p className="pt-0.5 text-[14px] text-subtle leading-5">
                        {[
                          new Date(one.scheduled_start).toLocaleDateString(
                            undefined,
                            { day: 'numeric', month: 'long', year: 'numeric' }
                          ),
                          one.venue,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>

                    <div className="pt-2 flex gap-4 items-center flex-wrap
                      text-[12px] text-navy-600 leading-4">
                      <span>
                        {t({
                          ne: `${num(tally?.folders ?? 0)} फोल्डर`,
                          en: `${tally?.folders ?? 0} Folders`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(tally?.agendas ?? 0)} कार्यसूची`,
                          en: `${tally?.agendas ?? 0} Agendas`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(tally?.summaries ?? 0)} सारांश`,
                          en: `${tally?.summaries ?? 0} Summaries`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(tally?.files ?? 0)} फाइल`,
                          en: `${tally?.files ?? 0} files`,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <FilledButton onClick={() => {
                      setOpened(one.id);
                      setTab('summaries');
                    }}>
                      {t({ ne: 'कार्यक्रम हेर्नुहोस्', en: 'View Event' })}
                    </FilledButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Sheet>
    );
  }

  // -- one event ---------------------------------------------------------

  return (
    <Sheet>
      <button
        type="button"
        onClick={() => setOpened('')}
        className="self-start flex gap-2 items-center text-[14px] text-head"
      >
        <span aria-hidden className="text-[18px] leading-none">‹</span>
        {t({ ne: 'सामग्री र सारांश', en: 'Files and Summaries' })}
      </button>

      <div>
        <h1 className="text-[24px] font-medium text-head leading-[1.2]">
          {event.title}
        </h1>
        <p className="pt-2 text-[14px] text-body leading-[1.5]">
          {whenAndWhere(event)}
        </p>
      </div>

      <UnderlineTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'summaries', label: TAB_LABEL.summaries },
          { id: 'files', label: TAB_LABEL.files },
          { id: 'photos', label: TAB_LABEL.photos },
        ]}
      />

      {tab === 'summaries' && <SummariesTab event={event} />}
      {tab === 'files' && <FilesTab event={event} />}
      {tab === 'photos' && <PhotosTab event={event} />}
    </Sheet>
  );
};
