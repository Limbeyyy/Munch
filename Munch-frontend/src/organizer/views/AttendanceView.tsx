import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { AttendanceReport, Event, Session, SessionAttendanceRow } from '../../types';
import { useOrganizer } from '../i18n';
import { openAsSheet } from '../sheets';
import { Card, Chip, Empty, Head } from '../ui';
import {
  EVENT_STATE_LABEL, EVENT_STATE_TONE, EventState, eventState,
} from '../sessionState';

/** The day and the room, on one line under the title. */
const whenAndWhere = (event: Event) => [
  new Date(event.event_date ?? event.scheduled_start).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  }),
  event.venue,
].filter(Boolean).join(' · ');

/** One line of an event's register, as the table reads it. */
interface RegisterRow {
  key: string;
  name: string;
  email: string | null;
  came: boolean;
  joined: string | null;
  left: string | null;
  /** How long they were there, already written out. */
  duration: string | null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** How long between two moments, in the hours and minutes of it. */
const spanOf = (from: string, to: string) => {
  const minutes = Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

/** The two letters an avatar falls back to. */
const initialsOf = (who: string) => {
  const parts = who.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
};

/** One figure of the three, with its name over it. */
const Figure: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col items-start">
    <span className="text-[12px] text-faint leading-4">{label}</span>
    <span className="pt-0.5 text-[18px] font-semibold text-head leading-7 tabular-nums">
      {value}
    </span>
  </div>
);

interface Person {
  id: string;
  name: string;
  isGuest: boolean;
  /** Sessions this person was present at, by session id. */
  sessions: Set<string>;
}

/** One event, with who came and which parts of it they sat through. */
interface EventRoll {
  event: Event;
  sessions: Session[];
  /** Present at each session, by session id. */
  bySession: Record<string, SessionAttendanceRow[]>;
  /** Everyone who attended at least one of its sessions. */
  people: Person[];
  report?: AttendanceReport;
}

export const AttendanceView: React.FC<{ events: any[] }> = () => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [rolls, setRolls] = useState<EventRoll[]>([]);
  const [loading, setLoading] = useState(true);
  /** The grid is the landing; an event's own roll is opened from a card. */
  const [opened, setOpened] = useState('');
  const [cards, setCards] = useState<Record<string, AttendanceReport>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EventState>('all');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [query, setQuery] = useState('');
  const [cameFilter, setCameFilter] = useState<'all' | 'attended' | 'no-show'>('all');

  useEffect(() => {
    apiClient
      .listEvents()
      .then((list) => {
        setEvents(list);
        setEventId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the events' })))
      .finally(() => setLoading(false));
  }, [t]);

  const event = events.find((e) => e.id === eventId) ?? null;

  /**
   * The headline figures for every event, for the cards.
   *
   * One request each, settled rather than chained: a report that will not
   * come back leaves its card without numbers instead of emptying the
   * whole grid.
   */
  useEffect(() => {
    if (events.length === 0) return;
    let live = true;
    Promise.allSettled(
      events.map((one) =>
        apiClient.getAttendance(one.id).then((report) => [one.id, report] as const)
      )
    ).then((results) => {
      if (!live) return;
      const next: Record<string, AttendanceReport> = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled') next[r.value[0]] = r.value[1];
      });
      setCards(next);
    });
    return () => { live = false; };
  }, [events]);

  /**
   * One line of the register: who, and what the day did with them.
   *
   * Built from the report rather than from each session's own list,
   * because the report knows who is in the room now - a session's list
   * is only written when that session closes, and during an event none
   * has.
   */
  const register = useMemo(() => {
    const report = rolls[0]?.report;
    if (!report) return [] as RegisterRow[];

    const came: RegisterRow[] = report.attended.map((row) => ({
      key: `came-${row.email ?? row.name}`,
      name: row.name,
      email: row.email,
      came: true,
      joined: row.joined_at || null,
      // Somebody still in the room has not left; the clock runs to now.
      left: row.left_at,
      duration: row.joined_at
        ? spanOf(row.joined_at, row.left_at ?? new Date().toISOString())
        : null,
    }));

    const missing: RegisterRow[] = report.did_not_attend.map((row) => ({
      key: `missed-${row.email}`,
      name: '',
      email: row.email,
      came: false,
      joined: null,
      left: null,
      duration: null,
    }));

    return [...came, ...missing];
  }, [rolls]);

  /** What the search and the status filter leave of it. */
  const shownRegister = useMemo(() => {
    const q = query.trim().toLowerCase();
    return register
      .filter((row) => cameFilter === 'all'
        || (cameFilter === 'attended' ? row.came : !row.came))
      .filter((row) => !q
        || row.name.toLowerCase().includes(q)
        || (row.email ?? '').toLowerCase().includes(q));
  }, [register, query, cameFilter]);

  /** The events the toolbar leaves on screen, in the order it asks for. */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter((one) => !q || one.title.toLowerCase().includes(q))
      .filter((one) => statusFilter === 'all' || eventState(one) === statusFilter)
      .sort((a, b) => {
        const gap = +new Date(a.scheduled_start) - +new Date(b.scheduled_start);
        return order === 'newest' ? -gap : gap;
      });
  }, [events, search, statusFilter, order]);

  /** Read every session's attendance, then roll it up per event. */
  const load = useCallback(async () => {
    if (!event || !opened) { setRolls([]); return; }
    setLoading(true);

    const built = await Promise.all(
      [event].map(async (event) => {
        const sessions = [...(event.sessions ?? [])].sort(
          (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
        );

        const results = await Promise.allSettled(
          sessions.map((s) =>
            apiClient.getSessionAttendance(s.id).then((rows) => [s.id, rows] as const)
          )
        );

        const bySession: Record<string, SessionAttendanceRow[]> = {};
        results.forEach((r) => {
          if (r.status === 'fulfilled') bySession[r.value[0]] = r.value[1];
        });

        // Somebody who sat through one session of four still attended the
        // event, so the roll is the union rather than the intersection.
        const byPerson: Record<string, Person> = {};
        Object.entries(bySession).forEach(([sessionId, rows]) => {
          rows.forEach((row) => {
            const key = row.person_id || row.name;
            if (!byPerson[key]) {
              byPerson[key] = {
                id: key, name: row.name, isGuest: row.is_guest, sessions: new Set(),
              };
            }
            byPerson[key].sessions.add(sessionId);
          });
        });

        const report = await apiClient.getAttendance(event.id).catch(() => undefined);

        /*
         * Everybody the event counted, whether a session has closed yet
         * or not.
         *
         * A session's register is written when that session ends, so
         * during the event there are no rows at all and the table came
         * out empty while the card beside it said 40%. The report knows
         * who is in the room now; the session rows say which parts they
         * sat through. The roll is both, so it fills as the day runs
         * rather than all at once when it is over.
         */
        (report?.attended ?? []).forEach((row) => {
          const key = row.email || row.name;
          if (!byPerson[key]) {
            byPerson[key] = {
              id: key,
              name: row.name,
              isGuest: row.type === 'guest',
              sessions: new Set(),
            };
          }
        });

        return {
          event,
          sessions,
          bySession,
          people: Object.values(byPerson).sort((a, b) => b.sessions.size - a.sessions.size),
          report,
        } as EventRoll;
      })
    );

    setRolls(built.sort(
      (a, b) => +new Date(a.event.scheduled_start) - +new Date(b.event.scheduled_start)
    ));
    setLoading(false);
  }, [event, opened]);

  useEffect(() => { load(); }, [load]);

  /**
   * The register, in the host's own Google Sheets.
   *
   * A downloaded file cannot be handed to a board or a ministry without
   * being attached to something; a sheet is a link, and it lands in the
   * host's own Drive rather than ours.
   */
  const exportSheet = () => {
    // The sheet says what the table says: a register read on a screen and
    // one handed to a board should not be two different documents.
    const head = ['name', 'email', 'status', 'joined', 'left', 'duration'];
    const rows = shownRegister.map((row) => [
      row.name,
      row.email ?? '',
      row.came ? 'attended' : 'no-show',
      row.joined ? clock(row.joined) : '',
      row.left ? clock(row.left) : '',
      row.duration ?? '',
    ]);
    openAsSheet('attendance', [head, ...rows], { subject: event?.title ?? '', t });
  };

  /** One event's register, from the report its card already holds. */
  const exportEvent = (one: Event) => {
    const report = cards[one.id];
    if (!report) {
      toast.error(t({ ne: 'निकाल्न केही छैन', en: 'There is nothing to export' }));
      return;
    }
    const head = ['person', 'status'];
    const rows = [
      ...report.attended.map((row: any) => [row.name ?? row.email ?? '', 'attended']),
      ...report.did_not_attend.map((row) => [row.email, 'no-show']),
    ];
    openAsSheet('attendance', [head, ...rows], { subject: one.title, t });
  };

  const heading = (
    <Head
        title={{ ne: 'उपस्थिति', en: 'Attendance' }}
        lede={{
          ne: 'कुन सत्रमा को थियो, र बैठकभरि कति जना आए।',
          en: 'Who was at each session, and who came to the event at all.',
        }}
      /* No export here: a card exports its own event, which is the only
         scope this page has now that it opens on one at a time. */
    />
  );

  return (
    <>
      {!opened && heading}

      {events.length === 0 && !loading ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({ ne: 'अझै कुनै कार्यक्रम छैन।', en: 'No events yet.' })}
          </p>
        </Card>
      ) : !opened ? (
        <>
          {/* What is being looked for, narrowed and ordered. */}
          <div className="bg-[#f9fafb] border border-line rounded-[12px] p-4 mb-5
            flex gap-3 flex-wrap items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t({ ne: 'खोज्नुहोस्', en: 'Search' })}
              aria-label={t({ ne: 'कार्यक्रम खोज्नुहोस्', en: 'Search events' })}
              className="flex-1 min-w-[200px] max-w-[280px] bg-white border border-line
                rounded-[8px] px-3 py-2 text-[14px] text-head"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | EventState)}
              aria-label={t({ ne: 'अवस्था', en: 'Status' })}
              className="bg-white border border-line rounded-[8px] px-3 py-2
                text-[14px] text-head"
            >
              <option value="all">{t({ ne: 'सबै अवस्था', en: 'All statuses' })}</option>
              {(Object.keys(EVENT_STATE_LABEL) as EventState[]).map((state) => (
                <option key={state} value={state}>{t(EVENT_STATE_LABEL[state])}</option>
              ))}
            </select>
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value as 'newest' | 'oldest')}
              aria-label={t({ ne: 'क्रम', en: 'Order' })}
              className="bg-white border border-line rounded-[8px] px-3 py-2
                text-[14px] text-head"
            >
              <option value="newest">{t({ ne: 'नयाँ पहिले', en: 'Newest' })}</option>
              <option value="oldest">{t({ ne: 'पुरानो पहिले', en: 'Oldest' })}</option>
            </select>
          </div>

          {shown.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-[#6E7C8E]">
                {t({ ne: 'कुनै कार्यक्रम भेटिएन।', en: 'No events matched.' })}
              </p>
            </Card>
          ) : (
            <div className="grid gap-5"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
              {shown.map((one) => {
                const report = cards[one.id];
                // Everybody the day counted, and the two ways they got
                // there: an invitation, or the door. The total is neither
                // one plus the other - somebody can be counted without
                // being either - so it is read from the server rather
                // than added up here.
                const total = report?.expected_total ?? 0;
                const invited = report?.expected_from_invites ?? 0;
                const guests = report?.guests_admitted ?? 0;
                const attended = report?.attended_count ?? 0;
                const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
                const state = eventState(one);
                return (
                  <article
                    key={one.id}
                    className="bg-white border-[0.6px] border-line rounded-[12px] p-5
                      flex flex-col gap-4
                      shadow-[0px_4px_3px_rgba(0,0,0,0.04),0px_2px_2px_rgba(0,0,0,0.03)]"
                  >
                    <div className="flex flex-col">
                      <span className="self-start">
                        <Chip tone={EVENT_STATE_TONE[state]}>
                          {t(EVENT_STATE_LABEL[state])}
                        </Chip>
                      </span>
                      <h3 className="pt-2 text-[15px] font-semibold text-head leading-5">
                        {one.title}
                      </h3>
                      <p className="pt-0.5 text-[14px] text-subtle leading-5">
                        {whenAndWhere(one)}
                      </p>
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-end justify-between gap-4">
                        <div className="flex gap-4">
                          <Figure
                            label={t({ ne: 'जम्मा', en: 'Total' })}
                            value={num(total)}
                          />
                          <Figure
                            label={t({ ne: 'निम्तो', en: 'Invited' })}
                            value={num(invited)}
                          />
                          <Figure
                            label={t({ ne: 'पाहुना', en: 'Guests' })}
                            value={num(guests)}
                          />
                        </div>
                        <span className="text-[18px] font-semibold text-head leading-7
                          tabular-nums">
                          {num(pct)}%
                        </span>
                      </div>
                      <div className="pt-2">
                        <div className="bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-head h-1.5 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="border-t-[0.6px] border-[#f3f4f6] pt-3 flex gap-2">
                      <button
                        onClick={() => { setEventId(one.id); setOpened(one.id); }}
                        className="flex-1 border-[0.6px] border-[#215db4] rounded-[8px]
                          py-1.5 text-[14px] font-medium text-[#215db4] leading-5
                          hover:bg-[#215db4]/[.06]"
                      >
                        {t({ ne: 'उपस्थिति हेर्नुहोस्', en: 'View attendance' })}
                      </button>
                      <button
                        onClick={() => exportEvent(one)}
                        className="border-[0.6px] border-line rounded-[8px] px-3 py-1.5
                          text-[14px] text-subtle leading-5 hover:border-navy-800"
                      >
                        {t({ ne: 'निकाल्नुहोस्', en: 'Export' })}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /*
         * One event's attendance, on one screen.
         *
         * It used to be three tabs over a strip of totals - by session,
         * by event, by person - which is three ways of reading the same
         * register, and a reader had to try each to find the one they
         * wanted. The register itself is what they came for: which
         * sessions ran, who was at each, and who came at all.
         */
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setOpened('')}
            className="self-start w-fit flex items-center gap-2 text-[14px] text-head
              hover:text-navy-800"
          >
            <span aria-hidden>‹</span>
            {t({ ne: 'उपस्थिति', en: 'Attendance' })}
          </button>

          <div className="bg-white border border-line-soft rounded-[12px] p-5 sm:p-6
            flex flex-col gap-5">
            {/* The event, and the two things done to its register: search
                it, or take it away. */}
            <div className="bg-[#f9fafb] rounded-[12px] p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[14px] text-faint leading-5">
                    {t({ ne: 'उपस्थिति', en: 'Attendance' })}
                  </p>
                  <h1 className="pt-1 text-[24px] font-semibold text-head leading-[1.2]">
                    {event?.title}
                  </h1>
                  <p className="pt-1.5 text-[14px] text-subtle leading-5">
                    {event ? whenAndWhere(event) : ''}
                  </p>
                </div>
                <button
                  onClick={exportSheet}
                  disabled={register.length === 0}
                  className="flex-none flex items-center gap-2 bg-navy-800 hover:bg-navy-700
                    disabled:opacity-50 rounded-[8px] px-3 py-2 text-[14px] text-white
                    leading-5"
                >
                  <svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden
                  >
                    <path d="M12 16V4M12 4L8 8M12 4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                  {t({ ne: 'उपस्थिति निकाल्नुहोस्', en: 'Export attendance' })}
                </button>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px] max-w-[417px] h-10 bg-white
                  border-[0.6px] border-line rounded-[8px] px-2.5 flex items-center gap-1
                  shadow-[0px_1.5px_4px_-1px_rgba(10,9,11,0.07)]">
                  <svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="#7f7d83" strokeWidth="1.8" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden
                  >
                    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={t({ ne: 'सहभागी खोज्नुहोस्', en: 'Search Attendees' })}
                    placeholder={t({ ne: 'सहभागी खोज्नुहोस्', en: 'Search Attendees' })}
                    className="flex-1 min-w-0 text-[14px] text-head placeholder:text-[#7f7d83]
                      focus:outline-none bg-transparent"
                  />
                </div>
                <select
                  value={cameFilter}
                  onChange={(e) => setCameFilter(e.target.value as typeof cameFilter)}
                  aria-label={t({ ne: 'अवस्था', en: 'Status' })}
                  className="h-10 bg-white border-[0.6px] border-line rounded-[8px] px-3
                    text-[14px] text-head"
                >
                  <option value="all">{t({ ne: 'सबै अवस्था', en: 'All statuses' })}</option>
                  <option value="attended">{t({ ne: 'आएका', en: 'Attended' })}</option>
                  <option value="no-show">{t({ ne: 'आएनन्', en: 'No-show' })}</option>
                </select>
              </div>
            </div>

            {loading ? (
              <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
            ) : shownRegister.length === 0 ? (
              <Empty>
                {register.length === 0
                  ? t({ ne: 'यो बैठकमा कोही आएन।', en: 'Nobody attended this event.' })
                  : t({ ne: 'कोही भेटिएन।', en: 'Nobody matched.' })}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[720px]">
                  <thead>
                    <tr className="bg-[#f9fafb]">
                      {[
                        { ne: 'नाम', en: 'Name' },
                        { ne: 'इमेल', en: 'Email' },
                        { ne: 'अवस्था', en: 'Status' },
                        { ne: 'आएको', en: 'Joined' },
                        { ne: 'गएको', en: 'Left' },
                        { ne: 'अवधि', en: 'Duration' },
                      ].map((head) => (
                        <th
                          key={head.en}
                          className="text-left text-[12px] font-medium text-subtle
                            border-b-[0.6px] border-[#f3f4f6] px-4 py-2.5"
                        >
                          {t(head)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRegister.map((row) => (
                      <tr key={row.key} className="border-b-[0.6px] border-[#f9fafb]">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="w-6 h-6 rounded-full border-[0.6px] border-line
                                grid place-items-center text-[12px] font-medium text-body
                                flex-none"
                            >
                              {initialsOf(row.name || row.email || '?')}
                            </span>
                            <span className="text-[14px] font-medium text-head leading-5">
                              {row.name || '—'}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[14px] text-subtle leading-5">
                          {row.email || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {row.came ? (
                            <span className="inline-flex items-center bg-[#f0fdf4] rounded-[4px]
                              px-2 py-0.5 text-[12px] font-medium text-[#008236] leading-4">
                              {t({ ne: 'आए', en: 'Attended' })}
                            </span>
                          ) : (
                            <span className="inline-flex items-center bg-[#f3f4f6] rounded-[4px]
                              px-2 py-0.5 text-[12px] font-medium text-subtle leading-4">
                              {t({ ne: 'आएनन्', en: 'No-show' })}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[14px] text-subtle leading-5 tabular-nums">
                          {row.joined ? clock(row.joined) : '—'}
                        </td>
                        <td className="px-4 py-3 text-[14px] text-subtle leading-5 tabular-nums">
                          {row.left ? clock(row.left) : '—'}
                        </td>
                        <td className="px-4 py-3 text-[14px] text-subtle leading-5 tabular-nums">
                          {row.duration ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
