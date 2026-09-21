import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { AttendanceReport, Event, Session, SessionAttendanceRow } from '../../types';
import { useOrganizer } from '../i18n';
import { openAsSheet } from '../sheets';
import { BarRow, Btn, Card, Chip, Empty, Head, Kpi, Panel, Tabs } from '../ui';
import {
  EVENT_STATE_LABEL, EVENT_STATE_TONE, EventState, eventState, sessionState,
} from '../sessionState';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The day and the room, on one line under the title. */
const whenAndWhere = (event: Event) => [
  new Date(event.event_date ?? event.scheduled_start).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  }),
  event.venue,
].filter(Boolean).join(' · ');

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
  const [tab, setTab] = useState('sessions');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});
  /** The grid is the landing; an event's own roll is opened from a card. */
  const [opened, setOpened] = useState('');
  const [cards, setCards] = useState<Record<string, AttendanceReport>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EventState>('all');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');

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

  const totals = useMemo(() => {
    // The roll, not the invitations: a guest was part of the event even
    // though nobody sent them anything.
    const invited = rolls.reduce((n, r) => n + (r.report?.expected_total ?? 0), 0);
    const inRoom = rolls.reduce((n, r) => n + (r.report?.active_count ?? 0), 0);
    const guests = rolls.reduce((n, r) => n + r.people.filter((p) => p.isGuest).length, 0);

    // Across the whole programme, one person is one person.
    const everyone = new Set<string>();
    rolls.forEach((r) => r.people.forEach((p) => everyone.add(p.id)));

    return { invited, inRoom, guests, attended: everyone.size };
  }, [rolls]);

  /** Everyone across the event, with what they sat through. */
  const across = useMemo(() => {
    const byPerson: Record<string, Person & { events: Set<string> }> = {};
    rolls.forEach((roll) =>
      roll.people.forEach((p) => {
        if (!byPerson[p.id]) {
          byPerson[p.id] = { ...p, sessions: new Set(), events: new Set() };
        }
        p.sessions.forEach((s) => byPerson[p.id].sessions.add(s));
        byPerson[p.id].events.add(roll.event.id);
      })
    );
    const q = query.trim().toLowerCase();
    return Object.values(byPerson)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.sessions.size - a.sessions.size);
  }, [rolls, query]);

  const totalSessions = rolls.reduce((n, r) => n + r.sessions.length, 0);

  /**
   * The register, in the host's own Google Sheets.
   *
   * A downloaded file cannot be handed to a board or a ministry without
   * being attached to something; a sheet is a link, and it lands in the
   * host's own Drive rather than ours.
   */
  const exportSheet = () => {
    const head = ['person', 'guest', 'events_attended', 'sessions_attended', 'of_sessions'];
    const rows = across.map((p) => [
      p.name, p.isGuest ? 'yes' : 'no', p.events.size, p.sessions.size, totalSessions,
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

  const nameChip = (p: Person) => (
    <span
      key={p.id}
      className="inline-flex items-center gap-2 bg-white border border-navy-800/15 rounded-full ps-1 pe-3 py-1"
    >
      <span className="w-6 h-6 rounded-full bg-navy-700 text-white grid place-items-center text-[11px] font-semibold">
        {p.name.charAt(0).toUpperCase()}
      </span>
      <span className="text-[13px]">{p.name}</span>
      {p.isGuest && <Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip>}
    </span>
  );

  return (
    <>
      <Head
        title={{ ne: 'उपस्थिति', en: 'Attendance' }}
        lede={{
          ne: 'कुन सत्रमा को थियो, र बैठकभरि कति जना आए।',
          en: 'Who was at each session, and who came to the event at all.',
        }}
        actions={
          <Btn onClick={exportSheet} disabled={across.length === 0}>
            {t({ ne: 'गुगल शीटमा निकाल्नुहोस्', en: 'Export to Sheets' })}
          </Btn>
        }
      />

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
                const invited = report?.expected_total ?? 0;
                const attended = report?.attended_count ?? 0;
                const missing = Math.max(0, invited - attended);
                const pct = invited > 0 ? Math.round((attended / invited) * 100) : 0;
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
                            label={t({ ne: 'निम्तो', en: 'Invited' })}
                            value={num(invited)}
                          />
                          <Figure
                            label={t({ ne: 'आएका', en: 'Attended' })}
                            value={num(attended)}
                          />
                          <Figure
                            label={t({ ne: 'आएनन्', en: 'No-show' })}
                            value={num(missing)}
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
        <>
          {/* The grid is where an event is picked now, so this is a way
              back to it rather than a second chooser. */}
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setOpened('')}
              className="flex items-center gap-2 text-[14px] text-head hover:text-navy-800"
            >
              <span aria-hidden>‹</span>
              {t({ ne: 'उपस्थिति', en: 'Attendance' })}
            </button>
            {event && (
              <span className="text-[14px] text-subtle">
                {event.title} · {whenAndWhere(event)}
              </span>
            )}
          </div>

          <div className="mb-4">
            <Kpi
              items={[
                { value: num(totals.invited), label: { ne: 'निम्तो पठाइएको', en: 'Invited' } },
                { value: num(totals.attended), label: { ne: 'आएका', en: 'Came' } },
                { value: num(totals.inRoom), label: { ne: 'अहिले हलमा', en: 'In the room now' } },
                { value: num(totalSessions), label: { ne: 'सत्र', en: 'Sessions' } },
                { value: num(totals.guests), label: { ne: 'पाहुना', en: 'Guests' } },
              ]}
            />
          </div>

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'sessions', label: { ne: 'सत्र अनुसार', en: 'By session' } },
              { id: 'events', label: { ne: 'बैठक अनुसार', en: 'By event' } },
              { id: 'people', label: { ne: 'व्यक्ति अनुसार', en: 'By person' } },
            ]}
          />

          {loading ? (
            <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
          ) : tab === 'sessions' ? (
            <div className="flex flex-col gap-3.5">
              {rolls.length === 0 && (
                <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No events.' })}</Empty></Panel>
              )}
              {rolls.map((roll) => (
                <Panel
                  key={roll.event.id}
                  title={roll.event.title}
                  aside={
                    <span className="text-[12.5px] text-[#6E7C8E]">
                      {t({
                        ne: `${num(roll.sessions.length)} सत्र · ${num(roll.people.length)} जना आए`,
                        en: `${roll.sessions.length} sessions · ${roll.people.length} came`,
                      })}
                    </span>
                  }
                >
                  <div className="px-4 py-3">
                    {roll.sessions.length === 0 ? (
                      <Empty>{t({ ne: 'यो बैठकमा सत्र छैन।', en: 'No sessions in this event.' })}</Empty>
                    ) : (
                      roll.sessions.map((session) => {
                        const rows = roll.bySession[session.id] ?? [];
                        // Measured against the people who came to this
                        // event at all: it says who stayed for what.
                        const roll_ = Math.max(1, roll.people.length);
                        const pct = Math.round((rows.length / roll_) * 100);
                        const shown = !!openSessions[session.id];

                        return (
                          <div key={session.id} className="border-b border-navy-800/[.08] last:border-0 py-1.5">
                            <button
                              onClick={() => setOpenSessions((v) => ({ ...v, [session.id]: !shown }))}
                              className="w-full text-start"
                            >
                              <BarRow
                                label={`${clock(session.starts_at)}  ${session.title}`}
                                pct={pct}
                                right={`${num(rows.length)}/${num(roll.people.length)}`}
                              />
                            </button>

                            {shown && (
                              <div className="ps-2 pb-2">
                                {rows.length === 0 ? (
                                  <p className="text-[12.5px] text-[#6E7C8E]">
                                    {(() => {
                                      const state = sessionState(session);
                                      if (state === 'finished') {
                                        return t({
                                          ne: 'यो सत्रमा कोही दर्ता भएन।',
                                          en: 'Nobody was recorded at this session.',
                                        });
                                      }
                                      if (state === 'never-started') {
                                        return t({
                                          ne: 'यो सत्र सुरु नै भएन।',
                                          en: 'This session never started.',
                                        });
                                      }
                                      return t({
                                        ne: 'सत्र सकिएपछि दर्ता हुन्छ।',
                                        en: 'Recorded when the session ends.',
                                      });
                                    })()}
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {rows.map((row) =>
                                      nameChip({
                                        id: row.person_id || row.id,
                                        name: row.name,
                                        isGuest: row.is_guest,
                                        sessions: new Set(),
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <p className="text-[12.5px] text-[#6E7C8E] mt-2.5">
                      {t({
                        ne: 'पङ्क्तिमा क्लिक गर्दा त्यो सत्रमा को थिए भन्ने देखिन्छ।',
                        en: 'Click a row to see who was at that session.',
                      })}
                    </p>
                  </div>
                </Panel>
              ))}
            </div>
          ) : tab === 'events' ? (
            <div className="flex flex-col gap-3.5">
              {rolls.map((roll) => (
                <Panel
                  key={roll.event.id}
                  title={roll.event.title}
                  aside={
                    <span className="flex items-center gap-2 text-[12.5px] text-[#6E7C8E]">
                      {clock(roll.event.scheduled_start)}–{clock(roll.event.scheduled_end)}
                      <Chip tone={roll.people.length > 0 ? 'ok' : 'draft'}>
                        {t({
                          ne: `${num(roll.people.length)} जना आए`,
                          en: `${roll.people.length} came`,
                        })}
                      </Chip>
                    </span>
                  }
                >
                  <div className="px-4 py-3">
                    <p className="text-[12.5px] text-[#6E7C8E] mb-2.5">
                      {t({
                        ne: `${num(roll.sessions.length)} सत्रमध्ये एउटामा भए पनि उपस्थित भएका सबै यहाँ गनिन्छन्।`,
                        en: `Anyone present at even one of the ${roll.sessions.length} sessions counts as having attended.`,
                      })}
                    </p>

                    {roll.people.length === 0 ? (
                      <Empty>{t({ ne: 'यो बैठकमा कोही आएन।', en: 'Nobody attended this event.' })}</Empty>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse min-w-[460px]">
                          <thead>
                            <tr className="bg-[#FBFAF6]">
                              {[
                                { ne: 'नाम', en: 'Name' },
                                { ne: 'कति सत्र', en: 'Sessions attended' },
                                { ne: 'कुन सत्र', en: 'Which' },
                              ].map((h, i) => (
                                <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2 border-b border-navy-800/15">
                                  {t(h)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {roll.people.map((p) => (
                              <tr key={p.id} className="hover:bg-[#FBFAF6]">
                                <td className="px-3 py-2 border-b border-navy-800/[.08] text-[13.5px] font-medium">
                                  {p.name}
                                  {p.isGuest && <span className="ms-2"><Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip></span>}
                                </td>
                                <td className="px-3 py-2 border-b border-navy-800/[.08] text-[13px] tabular-nums">
                                  {num(p.sessions.size)}/{num(roll.sessions.length)}
                                </td>
                                <td className="px-3 py-2 border-b border-navy-800/[.08]">
                                  <span className="inline-flex gap-1">
                                    {roll.sessions.map((s) => (
                                      <i
                                        key={s.id}
                                        title={s.title}
                                        className={`w-2.5 h-2.5 rounded-sm block ${
                                          p.sessions.has(s.id) ? 'bg-ok' : 'bg-[#E3D9C6]'
                                        }`}
                                      />
                                    ))}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          ) : (
            <Panel
              title={t({ ne: 'कार्यक्रमभरिका सहभागी', en: 'Everyone across the event' })}
              actions={
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t({ ne: 'नाम खोज्नुहोस्', en: 'Search a name' })}
                  className="border border-navy-800/15 rounded-[9px] px-3 py-1.5 text-[13px] min-w-[200px]"
                />
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[520px]">
                  <thead>
                    <tr className="bg-[#FBFAF6]">
                      {[
                        { ne: 'नाम', en: 'Name' },
                        { ne: 'बैठक', en: 'Events' },
                        { ne: 'सत्र', en: 'Sessions' },
                        { ne: 'अवस्था', en: 'Status' },
                      ].map((h, i) => (
                        <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2.5 border-b border-navy-800/15">
                          {t(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {across.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-5 text-[12.5px] text-[#6E7C8E]">
                        {t({ ne: 'कोही भेटिएन।', en: 'Nobody matched.' })}
                      </td></tr>
                    )}
                    {across.map((p) => (
                      <tr key={p.id} className="hover:bg-[#FBFAF6]">
                        <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13.5px] font-medium">
                          {p.name}
                        </td>
                        <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13px] tabular-nums">
                          {num(p.events.size)}/{num(rolls.length)}
                        </td>
                        <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13px] tabular-nums">
                          {num(p.sessions.size)}/{num(totalSessions)}
                        </td>
                        <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                          {p.isGuest
                            ? <Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip>
                            : <Chip tone="ok">{t({ ne: 'सहभागी', en: 'Participant' })}</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
};
