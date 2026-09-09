import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import {
  AttendanceReport, EventMeeting, EventProgramme, Session, SessionAttendanceRow,
} from '../../types';
import { useOrganizer } from '../i18n';
import { openAsSheet } from '../sheets';
import { BarRow, Btn, Card, Chip, Empty, Head, Kpi, Panel, Tabs } from '../ui';
import { sessionState } from '../sessionState';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Person {
  id: string;
  name: string;
  isGuest: boolean;
  /** Sessions this person was present at, by session id. */
  sessions: Set<string>;
}

/** One meeting, with who came and which parts of it they sat through. */
interface MeetingRoll {
  meeting: EventMeeting;
  sessions: Session[];
  /** Present at each session, by session id. */
  bySession: Record<string, SessionAttendanceRow[]>;
  /** Everyone who attended at least one of its sessions. */
  people: Person[];
  report?: AttendanceReport;
}

export const AttendanceView: React.FC<{ meetings: any[] }> = () => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [eventId, setEventId] = useState('');
  const [rolls, setRolls] = useState<MeetingRoll[]>([]);
  const [tab, setTab] = useState('sessions');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});

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

  /** Read every session's attendance, then roll it up per meeting. */
  const load = useCallback(async () => {
    if (!event) { setRolls([]); return; }
    setLoading(true);

    const built = await Promise.all(
      event.meetings.map(async (meeting) => {
        const sessions = [...meeting.sessions].sort(
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
        // meeting, so the roll is the union rather than the intersection.
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

        const report = await apiClient.getAttendance(meeting.id).catch(() => undefined);

        return {
          meeting,
          sessions,
          bySession,
          people: Object.values(byPerson).sort((a, b) => b.sessions.size - a.sessions.size),
          report,
        } as MeetingRoll;
      })
    );

    setRolls(built.sort(
      (a, b) => +new Date(a.meeting.scheduled_start) - +new Date(b.meeting.scheduled_start)
    ));
    setLoading(false);
  }, [event]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    // The roll, not the invitations: a guest was part of the meeting even
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
    const byPerson: Record<string, Person & { meetings: Set<string> }> = {};
    rolls.forEach((roll) =>
      roll.people.forEach((p) => {
        if (!byPerson[p.id]) {
          byPerson[p.id] = { ...p, sessions: new Set(), meetings: new Set() };
        }
        p.sessions.forEach((s) => byPerson[p.id].sessions.add(s));
        byPerson[p.id].meetings.add(roll.meeting.id);
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
    const head = ['person', 'guest', 'meetings_attended', 'sessions_attended', 'of_sessions'];
    const rows = across.map((p) => [
      p.name, p.isGuest ? 'yes' : 'no', p.meetings.size, p.sessions.size, totalSessions,
    ]);
    openAsSheet('attendance', [head, ...rows], { subject: event?.title ?? '', t });
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
          en: 'Who was at each session, and who came to the meeting at all.',
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
      ) : (
        <>
          {events.length > 1 && (
            <div className="mb-4">
              <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
                {t({ ne: 'कुन कार्यक्रम', en: 'Which event' })}
              </label>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {new Date(e.event_date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}

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
              { id: 'meetings', label: { ne: 'बैठक अनुसार', en: 'By meeting' } },
              { id: 'people', label: { ne: 'व्यक्ति अनुसार', en: 'By person' } },
            ]}
          />

          {loading ? (
            <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
          ) : tab === 'sessions' ? (
            <div className="flex flex-col gap-3.5">
              {rolls.length === 0 && (
                <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No meetings.' })}</Empty></Panel>
              )}
              {rolls.map((roll) => (
                <Panel
                  key={roll.meeting.id}
                  title={roll.meeting.title}
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
                      <Empty>{t({ ne: 'यो बैठकमा सत्र छैन।', en: 'No sessions in this meeting.' })}</Empty>
                    ) : (
                      roll.sessions.map((session) => {
                        const rows = roll.bySession[session.id] ?? [];
                        // Measured against the people who came to this
                        // meeting at all: it says who stayed for what.
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
                                label={`${clock(session.starts_at)}  ${session.title}${session.hall ? ` · ${session.hall}` : ''}`}
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
          ) : tab === 'meetings' ? (
            <div className="flex flex-col gap-3.5">
              {rolls.map((roll) => (
                <Panel
                  key={roll.meeting.id}
                  title={roll.meeting.title}
                  aside={
                    <span className="flex items-center gap-2 text-[12.5px] text-[#6E7C8E]">
                      {clock(roll.meeting.scheduled_start)}–{clock(roll.meeting.scheduled_end)}
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
                      <Empty>{t({ ne: 'यो बैठकमा कोही आएन।', en: 'Nobody attended this meeting.' })}</Empty>
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
                        { ne: 'बैठक', en: 'Meetings' },
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
                          {num(p.meetings.size)}/{num(rolls.length)}
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
