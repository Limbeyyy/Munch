import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import {
  Artifact, Event, HubPost, Session, SessionSummary, SubEvent,
} from '../../types';
import { Pair, useOrganizer } from '../../organizer/i18n';
import { formatSize, kindOf } from '../../organizer/filesAndSummaries/shared';
import { daysOf } from '../../organizer/events/days';
import { Grouped, groupSessions } from './grouping';
import { StateChip, stateOf } from './HomeShell';

type Tab = 'agendas' | 'speaker' | 'files' | 'questions' | 'suggestions';

const TAB: Record<Tab, Pair> = {
  agendas: { ne: 'कार्यसूची', en: 'Agendas' },
  speaker: { ne: 'वक्ता', en: 'Speaker' },
  files: { ne: 'फाइल', en: 'Files' },
  questions: { ne: 'प्रश्न', en: 'Questions' },
  suggestions: { ne: 'सुझाव', en: 'Suggestions' },
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayKey = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** A summary that opens out, because most of them are longer than a card. */
const Prose: React.FC<{ body: string }> = ({ body }) => {
  const { t } = useOrganizer();
  const [open, setOpen] = useState(false);
  const long = body.length > 120;

  return (
    <p className="pt-2 text-[13px] leading-6 text-[#2b3140]">
      {long && !open ? `${body.slice(0, 120)}…… ` : `${body} `}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="text-[#2440c9] underline"
        >
          {open
            ? t({ ne: 'कम देखाउनुहोस्', en: 'view less' })
            : t({ ne: 'थप हेर्नुहोस्', en: 'view more' })}
        </button>
      )}
    </p>
  );
};

/** The heading each named part of the day is read under. */
const GroupHead: React.FC<{ title: string }> = ({ title }) => (
  <h2 className="px-4 pt-4 pb-1 text-[16px] font-semibold text-[#111726]">
    {title}
  </h2>
);

/** The rule the design draws between one named part and the next. */
const Between: React.FC = () => (
  <div className="h-2 bg-[#eef3fc] border-y border-[#dce6f7] mt-4" aria-hidden />
);

/**
 * One event, read rather than run.
 *
 * Everything here is grouped under the named parts of the day, because
 * that is how the host arranged it and how somebody looking for the
 * emergency track expects to find it - the same headings on every tab,
 * so the shape of the day does not change when the subject does.
 */
export const EventDetail: React.FC<{
  event: Event;
  onBack: () => void;
  onEnterRoom?: () => void;
}> = ({ event, onBack, onEnterRoom }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<Tab>('agendas');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<SubEvent[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [files, setFiles] = useState<Artifact[]>([]);
  const [board, setBoard] = useState<{ questions: HubPost[]; suggestions: HubPost[] }>(
    { questions: [], suggestions: [] }
  );
  const [day, setDay] = useState('');

  const read = useCallback(async () => {
    const [own, parts, shared, hub] = await Promise.all([
      apiClient.listSessions(event.id).catch(() => [] as Session[]),
      apiClient.getSubEvents(event.id).catch(() => [] as SubEvent[]),
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
      apiClient.getHub(event.code).catch(() => null),
    ]);
    setSessions(own);
    setGroups(parts);
    setFiles(shared);
    setBoard({
      questions: hub?.questions ?? [],
      suggestions: hub?.suggestions ?? [],
    });

    const written = await Promise.all(
      own.map((one) => apiClient.getSessionSummary(one.id)
        .then((got) => [one.id, got] as const)
        .catch(() => null))
    );
    setSummaries(Object.fromEntries(
      written.filter(Boolean) as (readonly [string, SessionSummary])[]
    ));
  }, [event.id, event.code]);

  useEffect(() => { read(); }, [read]);

  const days = useMemo(() => daysOf(event), [event]);
  const onDay = day && days.includes(day) ? day : (days[0] ?? '');

  const onThisDay = useMemo(
    () => sessions.filter(
      (one) => days.length <= 1 || dayKey(new Date(one.starts_at)) === onDay
    ),
    [sessions, days.length, onDay]
  );

  const grouped: Grouped[] = useMemo(
    () => groupSessions(
      onThisDay, groups, t({ ne: 'बाँकी', en: 'Everything else' })
    ),
    [onThisDay, groups, t]
  );

  const postsOf = (one: Session, kind: 'questions' | 'suggestions') =>
    board[kind].filter((post) => post.session_id === one.id);

  return (
    <div>
      <header
        className="px-4 pt-3 pb-2"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[14px] text-[#5b6070]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t({ ne: 'कार्यक्रम', en: 'Events' })}
        </button>

        <div className="pt-1 flex items-start gap-3">
          <h1 className="flex-1 text-[19px] font-semibold text-[#111726] leading-tight">
            {event.title}
          </h1>
          <StateChip state={stateOf(event)} />
        </div>

        {stateOf(event) === 'live' && onEnterRoom && (
          <button
            type="button"
            onClick={onEnterRoom}
            className="mt-3 w-full rounded-[10px] bg-[#12386e] text-white
              py-2.5 text-[14px] font-medium"
          >
            {t({ ne: 'प्रत्यक्ष कोठामा जानुहोस्', en: 'Enter live room' })}
          </button>
        )}
      </header>

      <div
        role="tablist"
        className="px-4 flex gap-4 border-b border-[#eceef2] overflow-x-auto"
      >
        {(Object.keys(TAB) as Tab[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`py-2.5 text-[14px] whitespace-nowrap border-b-2 -mb-px ${
              tab === id
                ? 'border-[#2440c9] text-[#2440c9] font-medium'
                : 'border-transparent text-[#8b90a0]'
            }`}
          >
            {t(TAB[id])}
          </button>
        ))}
      </div>

      {tab === 'agendas' && days.length > 1 && (
        <div className="px-4 pt-3 flex gap-2">
          {days.map((one, i) => (
            <button
              key={one}
              type="button"
              aria-pressed={one === onDay}
              onClick={() => setDay(one)}
              className={`rounded-full px-4 py-1.5 text-[13px] ${
                one === onDay
                  ? 'bg-[#12386e] text-white font-medium'
                  : 'bg-[#dbe6fa] text-[#2b3140]'
              }`}
            >
              {t({ ne: `दिन ${num(i + 1)}`, en: `Day ${i + 1}` })}
            </button>
          ))}
        </div>
      )}

      {grouped.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {t({ ne: 'यहाँ केही छैन।', en: 'Nothing here yet.' })}
        </p>
      ) : (
        grouped.map((group, gi) => (
          <section key={group.id || 'loose'}>
            {gi > 0 && <Between />}
            <GroupHead title={group.title} />

            {tab === 'agendas' && (
              <div className="px-4 pt-1 flex flex-col gap-3">
                {group.sessions.map((one) => {
                  const summary = summaries[one.id];
                  return (
                    <article
                      key={one.id}
                      className="border border-[#e8eaee] rounded-[12px] px-3.5 py-3"
                    >
                      <p className="text-[14px] font-semibold text-[#111726]">
                        {one.title}
                      </p>
                      <p className="pt-0.5 text-[12px] text-[#9ba0ad]">
                        {clock(one.starts_at)}
                        {one.speaker_name && ` · ${one.speaker_name}`}
                      </p>
                      {summary?.is_published && summary.body
                        ? <Prose body={summary.body} />
                        : (
                          <p className="pt-2 text-[13px] italic text-[#9ba0ad]">
                            {t({
                              ne: 'सारांश अझै प्रकाशित छैन।',
                              en: 'No summary published yet.',
                            })}
                          </p>
                        )}
                    </article>
                  );
                })}
              </div>
            )}

            {tab === 'speaker' && (
              <div className="px-4 pt-1 flex flex-col gap-3">
                {group.sessions.filter((one) => one.speaker_name).length === 0 ? (
                  <p className="text-[13px] text-[#8b90a0]">
                    {t({ ne: 'वक्ता तोकिएको छैन।', en: 'No speaker named.' })}
                  </p>
                ) : (
                  group.sessions
                    .filter((one) => one.speaker_name)
                    .map((one) => (
                      <article
                        key={one.id}
                        className="border border-[#e8eaee] rounded-[12px] p-3
                          flex gap-3 items-start"
                      >
                        <span className="size-[72px] rounded-[10px] bg-[#fbecd1]
                          grid place-items-center overflow-hidden flex-none
                          text-[24px] font-semibold text-[#12386e]">
                          {one.speaker_photo_url
                            ? <img src={one.speaker_photo_url} alt=""
                                className="w-full h-full object-cover" />
                            : one.speaker_name.trim().charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <span className="inline-block bg-[#e6efff] text-[#2440c9]
                            rounded-[6px] px-2 py-1 text-[12px]">
                            {one.title}
                          </span>
                          <p className="pt-1.5 text-[15px] font-semibold
                            text-[#111726]">
                            {one.speaker_name}
                          </p>
                          {one.speaker_role && (
                            <p className="text-[13px] text-[#2b3140]">
                              {one.speaker_role}
                            </p>
                          )}
                        </div>
                      </article>
                    ))
                )}
              </div>
            )}

            {tab === 'files' && (
              <div className="px-4 pt-1 flex flex-col gap-4">
                {group.sessions.map((one) => {
                  const mine = files.filter((f) => f.session === one.id);
                  if (mine.length === 0) return null;
                  return (
                    <div key={one.id}>
                      <h3 className="text-[11px] font-semibold tracking-[.06em]
                        text-[#8b90a0] uppercase">
                        {one.title}
                      </h3>
                      <ul className="pt-2 flex flex-col gap-2.5">
                        {mine.map((file) => (
                          <li
                            key={file.id}
                            className="border border-[#e8eaee] rounded-[12px]
                              px-3 py-3 flex gap-3 items-center"
                          >
                            <span className="size-9 rounded-[8px] bg-[#fef2f2]
                              text-[#ef4444] grid place-items-center flex-none
                              text-[9px] font-bold">
                              {kindOf(file.display_name ?? '')}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[14px] font-medium
                                text-[#111726] truncate">
                                {file.display_name}
                              </span>
                              <span className="block text-[12px] text-[#9ba0ad]">
                                {kindOf(file.display_name ?? '')} ·{' '}
                                {formatSize(file.file_size)}
                              </span>
                            </span>
                            {file.web_view_link && (
                              <a
                                href={file.web_view_link}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({
                                  ne: `${file.display_name} खोल्नुहोस्`,
                                  en: `Open ${file.display_name}`,
                                })}
                                className="size-9 rounded-full bg-[#f2f3f5] grid
                                  place-items-center flex-none text-[#5b6070]"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24"
                                  fill="none" stroke="currentColor" strokeWidth="1.9"
                                  strokeLinecap="round" strokeLinejoin="round"
                                  aria-hidden>
                                  <path d="M12 4v11M12 15l-4-4M12 15l4-4M5 19h14" />
                                </svg>
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {(tab === 'questions' || tab === 'suggestions') && (
              <div className="px-4 pt-1 flex flex-col gap-4">
                {group.sessions.map((one) => {
                  const posts = postsOf(one, tab);
                  if (posts.length === 0) return null;
                  return (
                    <div key={one.id}>
                      <h3 className="text-[11px] font-semibold tracking-[.06em]
                        text-[#8b90a0] uppercase">
                        {one.title}
                      </h3>
                      <ul className="pt-2 flex flex-col gap-2.5">
                        {posts.map((post) => (
                          <li
                            key={post.id}
                            className="border border-[#e8eaee] rounded-[12px]
                              px-3.5 py-3"
                          >
                            <p className="text-[13px] leading-6 text-[#111726]">
                              {post.body}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}

      <div className="h-6" />
    </div>
  );
};
