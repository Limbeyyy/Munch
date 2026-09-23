import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import {
  Artifact, AttendanceEntry, ChatMessage, Event, ModerationQueue, Session,
  SessionSummary,
} from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { KindChip, dayOf, kindOf } from '../filesAndSummaries/shared';
import { BackLink, DeckTabs, EventHeading, Sheet } from './chrome';
import { initialsOf } from './people';
import { whenLine } from './EventsDashboard';

/** Which part of a finished event is being read. */
type Tab =
  | 'overview' | 'attendance' | 'agenda' | 'questions' | 'suggestions' | 'resources';

const TAB_LABEL: Record<Tab, Pair> = {
  overview: { ne: 'सारांश', en: 'Overview' },
  attendance: { ne: 'उपस्थिति', en: 'Attendance' },
  agenda: { ne: 'कार्यसूची', en: 'Agenda' },
  questions: { ne: 'प्रश्न', en: 'Questions' },
  suggestions: { ne: 'सुझाव', en: 'Suggestions' },
  resources: { ne: 'सामग्री', en: 'Resources' },
};

/** Which pile of a board is being read. */
type Pile = 'all' | 'approved' | 'rejected';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** First name and last initial, the way a list of askers writes it. */
const shortName = (full: string) => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

/** How long somebody was there, in the hours and minutes of it. */
const spanOf = (from: string, to: string | null) => {
  if (!to) return '—';
  const minutes = Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

/** One of the figures across the top of a tab. */
const Figure: React.FC<{ label: string; value: string; under?: string }> = ({
  label, value, under,
}) => (
  <div className="flex-1 min-w-[150px] bg-white border-[0.6px] border-line
    rounded-[12px] px-4 py-4 flex flex-col">
    <span className="text-[12px] text-subtle leading-4">{label}</span>
    <span className="pt-1 text-[24px] font-semibold text-head leading-8 tabular-nums">
      {value}
    </span>
    {under && (
      <span className="pt-0.5 text-[12px] text-faint leading-4">{under}</span>
    )}
  </div>
);

/** A bordered card with a heading over it, as the summary tabs use. */
const Panel: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title, children,
}) => (
  <div className="bg-white border-[0.6px] border-line rounded-[12px] overflow-hidden">
    {title && (
      <div className="px-5 py-4 border-b-[0.6px] border-line">
        <h3 className="text-[14px] font-semibold text-head leading-5">{title}</h3>
      </div>
    )}
    {children}
  </div>
);

/** What became of one thing somebody put to the host. */
const Verdict: React.FC<{ approved: boolean }> = ({ approved }) => {
  const { t } = useOrganizer();
  return (
    <span
      className="rounded-[4px] px-2 py-0.5 text-[12px] font-medium leading-4"
      style={approved
        ? { backgroundColor: '#f0fdf4', color: '#008236' }
        : { backgroundColor: '#f3f4f6', color: '#6a7282' }}
    >
      {approved
        ? t({ ne: 'स्वीकृत', en: 'Approved' })
        : t({ ne: 'अस्वीकृत', en: 'Rejected' })}
    </span>
  );
};

/** The pills over a board, each carrying how many are in its pile. */
const PilesRow: React.FC<{
  value: Pile;
  onChange: (value: Pile) => void;
  counts: Record<Pile, number>;
}> = ({ value, onChange, counts }) => {
  const { t, num } = useOrganizer();
  const options: { id: Pile; label: Pair }[] = [
    { id: 'all', label: { ne: 'सबै आएका', en: 'All Submitted' } },
    { id: 'approved', label: { ne: 'स्वीकृत', en: 'Approved' } },
    { id: 'rejected', label: { ne: 'अस्वीकृत', en: 'Rejected' } },
  ];
  return (
    <div className="flex gap-3 items-center flex-wrap">
      {options.map((one) => {
        const on = one.id === value;
        return (
          <button
            key={one.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(one.id)}
            className={`rounded-[36px] px-4 py-2.5 flex gap-2 items-center
              text-[14px] leading-5 ${
              on ? 'bg-navy-800 text-white' : 'bg-[#e3ecfd] text-[#393939]'
            }`}
          >
            {on && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".25" />
                <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {t(one.label)}
            <span className={`text-[16px] font-semibold tabular-nums ${
              on ? 'text-white' : 'text-[#393939]'
            }`}>
              {num(counts[one.id])}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * One board of a finished event, read rather than moderated.
 *
 * The decisions were made while it was running; this is the record of
 * them, so every entry carries what became of it and none of them
 * carries a button.
 */
const BoardTab: React.FC<{ rows: ChatMessage[]; approvedIds: Set<string> }> = ({
  rows, approvedIds,
}) => {
  const { t } = useOrganizer();
  const [pile, setPile] = useState<Pile>('all');

  const counts: Record<Pile, number> = {
    all: rows.length,
    approved: rows.filter((one) => approvedIds.has(one.id)).length,
    rejected: rows.filter((one) => !approvedIds.has(one.id)).length,
  };

  const shown = rows.filter((one) => {
    if (pile === 'all') return true;
    return pile === 'approved'
      ? approvedIds.has(one.id)
      : !approvedIds.has(one.id);
  });

  return (
    <div className="flex flex-col gap-4">
      <PilesRow value={pile} onChange={setPile} counts={counts} />

      {shown.length === 0 ? (
        <p className="text-[14px] text-subtle">
          {t({ ne: 'यहाँ केही छैन।', en: 'Nothing here.' })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((one) => (
            <article
              key={one.id}
              className="bg-white border-[0.6px] border-line rounded-[12px] px-4 py-4"
            >
              <p className="text-[14px] text-head leading-[22px]">“{one.body}”</p>
              <div className="pt-2 flex gap-3 items-center flex-wrap">
                <span className="text-[12px] text-body leading-4">
                  {shortName(one.sender_name)}
                </span>
                {one.session_title && (
                  <span className="text-[12px] text-faint leading-4">
                    {one.session_title}
                  </span>
                )}
                <span className="text-[12px] text-faint leading-4">
                  {clock(one.created_at)}
                </span>
                <Verdict approved={approvedIds.has(one.id)} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

interface Props {
  event: Event;
  onBack: () => void;
}

/**
 * A finished event, read back.
 *
 * Nothing here can be changed: the event has run, the decisions were
 * made while it was running, and this is the record. So the six tabs are
 * six readings of one thing - who came, what was on, what was asked,
 * what was suggested, and what was handed out.
 */
export const EventSummary: React.FC<Props> = ({ event, onBack }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<Tab>('overview');

  const [report, setReport] = useState<any>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [resources, setResources] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  /** Which agenda is open on the agenda tab. One at a time. */
  const [opened, setOpened] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [got, own, board, files] = await Promise.all([
      apiClient.getAttendanceReport(event.id).catch(() => null),
      apiClient.listSessions(event.id).catch(() => [] as Session[]),
      apiClient.getModerationQueue(event.id).catch(() => null),
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
    ]);
    setReport(got);
    setSessions(own);
    setQueue(board);
    setResources(files);

    const written = await Promise.all(
      own.map((one) =>
        apiClient.getSessionSummary(one.id)
          .then((summary) => [one.id, summary] as const)
          .catch(() => null)
      )
    );
    setSummaries(Object.fromEntries(
      written.filter(Boolean) as (readonly [string, SessionSummary])[]
    ));
    setLoading(false);
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  /**
   * Everything put to the host, and which of it went up.
   *
   * The queue returns the two piles separately; the boards read them as
   * one list with a verdict against each, so they are folded together
   * here and the approved ids kept to tell them apart.
   */
  const boards = useMemo(() => {
    const approved = queue?.approved ?? [];
    const rejected = queue?.rejected ?? [];
    const all = [...approved, ...rejected].sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
    );
    return {
      approvedIds: new Set(approved.map((one) => one.id)),
      questions: all.filter((one) => one.topic === 'faq'),
      suggestions: all.filter((one) => one.topic === 'suggestion'),
    };
  }, [queue]);

  const attended: AttendanceEntry[] = report?.attended ?? [];
  const invited = report?.expected_total ?? 0;
  const came = report?.attended_count ?? attended.length;
  const absent = report?.absent_count ?? Math.max(0, invited - came);
  const rate = invited > 0 ? Math.round((came / invited) * 100) : 0;

  return (
    <Sheet>
      <BackLink label={{ ne: 'कार्यक्रम', en: 'Event' }} onClick={onBack} />
      <EventHeading title={event.title} under={
        [whenLine(event), event.venue].filter(Boolean).join(' · ')
      } />

      <DeckTabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={(Object.keys(TAB_LABEL) as Tab[]).map((id) => ({
          id, label: TAB_LABEL[id],
        }))}
      />

      {loading ? (
        <p className="text-[14px] text-subtle">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="flex flex-col gap-5">
              <div className="flex gap-4 flex-wrap">
                <Figure
                  label={t({ ne: 'उपस्थिति', en: 'Attendance' })}
                  value={`${num(came)}/${num(invited)}`}
                  under={`${num(rate)}%`}
                />
                <Figure
                  label={t({ ne: 'कार्यसूची', en: 'Agendas' })}
                  value={num(sessions.length)}
                />
                <Figure
                  label={t({ ne: 'प्रश्न', en: 'Questions' })}
                  value={num(boards.questions.length)}
                />
                <Figure
                  label={t({ ne: 'सुझाव', en: 'Suggestions' })}
                  value={num(boards.suggestions.length)}
                />
              </div>

              <Panel>
                <div className="px-5 py-4">
                  <h3 className="text-[14px] font-semibold text-head leading-5">
                    {t({ ne: 'उपस्थिति', en: 'Attendance' })}
                  </h3>
                  <div className="pt-3 flex gap-10 flex-wrap">
                    <div>
                      <p className="text-[12px] text-subtle leading-4">
                        {t({ ne: 'आए', en: 'Attended' })}
                      </p>
                      <p className="pt-0.5 text-[20px] font-semibold text-head
                        tabular-nums">{num(came)}</p>
                    </div>
                    <div>
                      <p className="text-[12px] text-subtle leading-4">
                        {t({ ne: 'आएनन्', en: 'No-show' })}
                      </p>
                      <p className="pt-0.5 text-[20px] font-semibold text-head
                        tabular-nums">{num(absent)}</p>
                    </div>
                    <div>
                      <p className="text-[12px] text-subtle leading-4">
                        {t({ ne: 'दर', en: 'Rate' })}
                      </p>
                      <p className="pt-0.5 text-[20px] font-semibold text-head
                        tabular-nums">{num(rate)}%</p>
                    </div>
                  </div>
                  <div className="pt-4">
                    <div className="bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden">
                      <div className="bg-head h-1.5 rounded-full"
                        style={{ width: `${rate}%` }} />
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title={t({ ne: 'कार्यसूची र सारांश', en: 'Agenda & summaries' })}>
                {sessions.length === 0 ? (
                  <p className="px-5 py-4 text-[14px] text-subtle">
                    {t({ ne: 'कुनै कार्यसूची छैन।', en: 'No agenda was set.' })}
                  </p>
                ) : (
                  sessions.map((one, i) => {
                    const summary = summaries[one.id];
                    return (
                      <div
                        key={one.id}
                        className={`px-5 py-4 ${
                          i < sessions.length - 1
                            ? 'border-b-[0.6px] border-line' : ''
                        }`}
                      >
                        <p className="text-[14px] font-semibold text-head leading-5">
                          {one.title}
                        </p>
                        <p className="pt-0.5 text-[12px] text-faint leading-4">
                          {[clock(one.starts_at), one.speaker_name]
                            .filter(Boolean).join(' · ')}
                        </p>
                        <p className="pt-2 text-[14px] text-body leading-[22px]">
                          {summary?.saved && summary.body
                            ? summary.body
                            : t({
                                ne: 'यो कार्यसूचीको सारांश लेखिएको छैन।',
                                en: 'No summary was written for this agenda.',
                              })}
                        </p>
                      </div>
                    );
                  })
                )}
              </Panel>
            </div>
          )}

          {tab === 'attendance' && (
            <div className="flex flex-col gap-5">
              <div className="flex gap-4 flex-wrap">
                <Figure label={t({ ne: 'निम्तो', en: 'Invited' })} value={num(invited)} />
                <Figure label={t({ ne: 'आए', en: 'Attended' })} value={num(came)} />
                <Figure label={t({ ne: 'आएनन्', en: 'No-show' })} value={num(absent)} />
                <Figure
                  label={t({ ne: 'उपस्थिति दर', en: 'Attendance rate' })}
                  value={`${num(rate)}%`}
                />
              </div>

              <Panel title={t({ ne: 'उपस्थित', en: 'Attendees' })}>
                {attended.length === 0 ? (
                  <p className="px-5 py-4 text-[14px] text-subtle">
                    {t({ ne: 'कोही आएनन्।', en: 'Nobody came.' })}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-[0.6px] border-line">
                          {[
                            { ne: 'नाम', en: 'Name' },
                            { ne: 'अवस्था', en: 'Status' },
                            { ne: 'आइपुगे', en: 'Joined' },
                            { ne: 'गए', en: 'Left' },
                            { ne: 'अवधि', en: 'Duration' },
                          ].map((head) => (
                            <th
                              key={head.en}
                              className="px-5 py-3 text-[12px] font-normal
                                text-subtle leading-4"
                            >
                              {t(head)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {attended.map((row, i) => (
                          <tr
                            key={`${row.name}-${i}`}
                            className={i < attended.length - 1
                              ? 'border-b-[0.6px] border-line' : ''}
                          >
                            <td className="px-5 py-3">
                              <span className="flex gap-2.5 items-center">
                                <span className="size-7 rounded-full bg-[#f3f4f6]
                                  grid place-items-center text-[11px] font-medium
                                  text-subtle flex-none">
                                  {initialsOf(row.name)}
                                </span>
                                <span className="text-[14px] text-head">{row.name}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className="rounded-[4px] px-2 py-0.5 text-[12px]
                                  font-medium leading-4"
                                style={{ backgroundColor: '#f0fdf4', color: '#008236' }}
                              >
                                {t({ ne: 'आए', en: 'Attended' })}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-[14px] text-subtle
                              tabular-nums">
                              {clock(row.joined_at)}
                            </td>
                            <td className="px-5 py-3 text-[14px] text-subtle
                              tabular-nums">
                              {row.left_at ? clock(row.left_at) : '—'}
                            </td>
                            <td className="px-5 py-3 text-[14px] text-subtle
                              tabular-nums">
                              {spanOf(row.joined_at, row.left_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === 'agenda' && (
            <div className="flex flex-col gap-4">
              {sessions.length === 0 ? (
                <p className="text-[14px] text-subtle">
                  {t({ ne: 'कुनै कार्यसूची छैन।', en: 'No agenda was set.' })}
                </p>
              ) : (
                sessions.map((one) => {
                  const summary = summaries[one.id];
                  const on = opened === one.id;
                  const actions = summary?.actions ?? [];
                  return (
                    <div
                      key={one.id}
                      className="bg-white border-[0.6px] border-line rounded-[12px]
                        overflow-hidden"
                    >
                      <button
                        type="button"
                        aria-expanded={on}
                        onClick={() => setOpened(on ? '' : one.id)}
                        className="w-full px-5 py-4 flex items-center justify-between
                          gap-4 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-[14px] font-semibold text-head
                            leading-5 truncate">
                            {one.title}
                          </span>
                          <span className="block pt-0.5 text-[12px] text-faint
                            leading-4 truncate">
                            {[clock(one.starts_at), one.speaker_name]
                              .filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className={`text-faint flex-none ${on ? 'rotate-90' : ''}`}
                          aria-hidden>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M9 6l6 6-6 6" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round"
                              strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>

                      {on && (
                        <div className="border-t-[0.6px] border-line px-5 py-4
                          flex flex-col gap-4">
                          <div>
                            <p className="text-[12px] text-subtle leading-4">
                              {t({ ne: 'सारांश', en: 'Overview' })}
                            </p>
                            <p className="pt-1 text-[14px] text-head leading-[22px]">
                              {summary?.saved && summary.body
                                ? summary.body
                                : t({
                                    ne: 'यो कार्यसूचीको सारांश लेखिएको छैन।',
                                    en: 'No summary was written for this agenda.',
                                  })}
                            </p>
                          </div>

                          {actions.length > 0 && (
                            <div>
                              <p className="text-[12px] text-subtle leading-4">
                                {t({ ne: 'गर्नुपर्ने काम', en: 'Action items' })}
                              </p>
                              <ul className="pt-1 flex flex-col gap-1.5">
                                {actions.map((action, i) => (
                                  <li key={i} className="flex gap-2 items-start">
                                    {/* The record of a finished event, so the
                                        box says what was settled rather than
                                        offering to settle it now. */}
                                    <span className="mt-1 size-3 border border-[#b3b3b3]
                                      rounded-[2px] flex-none" aria-hidden />
                                    <span className="text-[14px] text-head leading-5">
                                      {action.task}
                                      {action.owner && (
                                        <span className="text-faint">
                                          {` · ${action.owner}`}
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {tab === 'questions' && (
            <BoardTab rows={boards.questions} approvedIds={boards.approvedIds} />
          )}
          {tab === 'suggestions' && (
            <BoardTab rows={boards.suggestions} approvedIds={boards.approvedIds} />
          )}

          {tab === 'resources' && (
            <div className="flex flex-col gap-4">
              {resources.length === 0 ? (
                <p className="text-[14px] text-subtle">
                  {t({ ne: 'कुनै सामग्री बाँडिएन।', en: 'Nothing was shared.' })}
                </p>
              ) : (
                resources.map((one) => (
                  <div
                    key={one.id}
                    className="bg-white border-[0.6px] border-line rounded-[12px]
                      px-5 py-4 flex gap-4 items-center"
                  >
                    <KindChip kind={kindOf(one.display_name ?? '')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-head leading-5 truncate">
                        {one.display_name}
                      </p>
                      <p className="pt-0.5 text-[12px] text-faint leading-4 truncate">
                        {[
                          one.uploaded_by_name
                            ? t({
                                ne: `${one.uploaded_by_name} ले राखे`,
                                en: `Uploaded by ${one.uploaded_by_name}`,
                              })
                            : '',
                          dayOf(one.created_at, t),
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {one.web_view_link ? (
                      <a
                        href={one.web_view_link}
                        target="_blank"
                        rel="noreferrer"
                        className="border-[0.6px] border-line rounded-[8px] px-3 py-1.5
                          text-[12px] text-body leading-4 hover:border-navy-800"
                      >
                        {t({ ne: 'डाउनलोड', en: 'Download' })}
                      </a>
                    ) : (
                      <span className="text-[12px] text-faint">
                        {t({ ne: 'लिङ्क छैन', en: 'No link' })}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
};
