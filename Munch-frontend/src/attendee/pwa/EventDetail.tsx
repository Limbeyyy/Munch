import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import {
  Artifact, Event, HubPost, Session, SessionSummary, SubEvent,
} from '../../types';
import { Pair, useOrganizer } from '../../organizer/i18n';
import { errorText } from '../../organizer/errors';
import { formatSize, kindOf } from '../../organizer/filesAndSummaries/shared';
import { daysOf } from '../../organizer/events/days';
import { Grouped, groupSessions } from './grouping';
import { stateOf } from './HomeShell';
import fileIcon from './icons/file.svg';
import downloadIcon from './icons/download.svg';

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
  <h2 className="capitalize text-[16px] font-semibold text-black leading-5">
    {title}
  </h2>
);

/** The talk a file or a question belongs to, over the top of it. */
const TalkHead: React.FC<{ title: string }> = ({ title }) => (
  <h3 className="text-[11px] font-bold uppercase tracking-[1.1px] text-[#99a1af]
    leading-[16.5px]">
    {title}
  </h3>
);

/** Where the event has got to, in the pill the header carries. */
const HeadChip: React.FC<{ event: Event }> = ({ event }) => {
  const { t } = useOrganizer();
  const state = stateOf(event);
  const ink = { completed: '#018030', live: '#bc1c1c', upcoming: '#4272dd' }[state];
  const label = {
    completed: t({ ne: 'सकियो', en: 'Completed' }),
    live: t({ ne: 'प्रत्यक्ष', en: 'Live' }),
    upcoming: t({ ne: 'आउँदै', en: 'Upcoming' }),
  }[state];

  return (
    <span
      className="bg-[#efefef] rounded-full px-2.5 py-1 flex-none text-[11px]
        font-semibold leading-[16.5px] whitespace-nowrap"
      style={{ color: ink }}
    >
      {label}
    </span>
  );
};

/**
 * Everything asked or suggested against one talk.
 *
 * Folded to the first two, because a popular talk collects thirty
 * questions and the point of grouping them under their talk is lost
 * if one talk fills the screen. The rest are a press away.
 */
const Thread: React.FC<{
  title: string;
  posts: HubPost[];
  /** What the fold calls the ones it is hiding. */
  more: (n: number) => string;
  onVote?: (post: HubPost, value: 1 | -1) => void;
}> = ({ title, posts, more, onVote }) => {
  const { t, num } = useOrganizer();
  const [all, setAll] = useState(false);
  const shown = all ? posts : posts.slice(0, 2);
  const rest = posts.length - shown.length;

  return (
    <div className="pl-2">
      <TalkHead title={title} />

      {shown.map((post) => (
        <div key={post.id} className="pt-2">
          <div className="border-[0.72px] border-[#b3b3b3] rounded-[16px]
            px-4 py-3">
            <p className="text-[14px] leading-[22.75px] text-[#1e2939]">
              {post.body}
            </p>

            {onVote && (
              <div className="pt-2 flex gap-1 items-center justify-end">
                <button
                  type="button"
                  onClick={() => onVote(post, 1)}
                  aria-label={t({ ne: 'माथि भोट', en: 'Vote up' })}
                  aria-pressed={post.my_vote === 1}
                  className={`rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold
                    leading-4 ${post.my_vote === 1
                      ? 'bg-[#194d97] text-white'
                      : 'bg-[#f3f4f6] text-[#6a7282]'}`}
                >
                  ▲ {num(Math.max(0, post.score))}
                </button>
                <button
                  type="button"
                  onClick={() => onVote(post, -1)}
                  aria-label={t({ ne: 'तल भोट', en: 'Vote down' })}
                  aria-pressed={post.my_vote === -1}
                  className={`rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold
                    leading-4 ${post.my_vote === -1
                      ? 'bg-[#194d97] text-white'
                      : 'bg-[#f3f4f6] text-[#6a7282]'}`}
                >
                  ▼
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full pt-2 text-[12px] font-medium text-[#5b94e4] underline"
        >
          {more(rest)}
        </button>
      )}
    </div>
  );
};

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

  /**
   * A vote on a question, which sorts a queue. Suggestions carry none:
   * nobody reads a suggestion in order of popularity.
   */
  const vote = async (post: HubPost, value: 1 | -1) => {
    try {
      const back = await apiClient.voteHubPost(event.code, post.id, value);
      setBoard((was) => ({
        ...was,
        questions: was.questions.map((one) => (one.id === back.id ? back : one)),
      }));
    } catch (e) {
      toast.error(errorText(e, t({ ne: 'भोट पुगेन', en: 'That vote did not land' })));
    }
  };

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <header
        className="bg-white px-4 pt-3 pb-2 border-b-[0.72px] border-[#b3b3b3]"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[14px] font-medium
            text-[#9e9e9e] leading-5"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t({ ne: 'कार्यसूची', en: 'Agenda' })}
        </button>

        <div className="pt-1 flex items-start gap-1">
          <h1 className="flex-1 text-[18px] font-semibold text-[#101828]
            leading-[27px]">
            {event.title}
          </h1>
          <HeadChip event={event} />
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

        <div role="tablist" className="pt-3 flex gap-4 overflow-x-auto">
          {(Object.keys(TAB) as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`capitalize pb-2 text-[14px] font-medium leading-5
                whitespace-nowrap border-b-[1.441px] ${
                tab === id
                  ? 'border-[#194d97] text-[#1f62c0]'
                  : 'border-transparent text-[#99a1af]'
              }`}
            >
              {t(TAB[id])}
            </button>
          ))}
        </div>
      </header>

      {tab === 'agendas' && days.length > 1 && (
        <div className="bg-white px-4 py-2.5 flex gap-4">
          {days.map((one, i) => (
            <button
              key={one}
              type="button"
              aria-pressed={one === onDay}
              onClick={() => setDay(one)}
              className={`rounded-full px-3 py-1.5 text-[12px] ${
                one === onDay
                  ? 'bg-[#12386e] text-white'
                  : 'bg-[#e3ecfd] text-[#393939]'
              }`}
            >
              {t({ ne: `दिन ${num(i + 1)}`, en: `Day ${i + 1}` })}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {grouped.length === 0 ? (
          <p className="bg-white px-4 py-8 text-center text-[13px] text-[#8b90a0]">
            {t({ ne: 'यहाँ केही छैन।', en: 'Nothing here yet.' })}
          </p>
        ) : (
          grouped.map((group) => (
            <section
              key={group.id || 'loose'}
              className="bg-white px-4 py-2.5 flex flex-col gap-2.5"
            >
              <GroupHead title={group.title} />

              {tab === 'agendas' && (
                <div className="flex flex-col gap-3">
                  {group.sessions.map((one) => {
                    const summary = summaries[one.id];
                    return (
                      <article
                        key={one.id}
                        className="border-[0.72px] border-[#b3b3b3] rounded-[16px]
                          px-4 py-3"
                      >
                        <p className="text-[14px] font-semibold text-[#101828]">
                          {one.title}
                        </p>
                        <p className="pt-0.5 text-[12px] text-[#656565]">
                          {clock(one.starts_at)}
                          {one.speaker_name && ` · ${one.speaker_name}`}
                        </p>
                        {summary?.is_published && summary.body
                          ? <Prose body={summary.body} />
                          : (
                            <p className="pt-2 text-[13px] italic text-[#99a1af]">
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
                <div className="flex flex-col gap-3">
                  {group.sessions.filter((one) => one.speaker_name).length === 0 ? (
                    <p className="text-[13px] text-[#99a1af]">
                      {t({ ne: 'वक्ता तोकिएको छैन।', en: 'No speaker named.' })}
                    </p>
                  ) : (
                    group.sessions
                      .filter((one) => one.speaker_name)
                      .map((one) => (
                        <article
                          key={one.id}
                          className="border-[0.72px] border-[#b3b3b3] rounded-[16px]
                            p-4 flex gap-3 items-start"
                        >
                          <span className="size-[72px] rounded-[12px] bg-[#fbecd1]
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
                              text-[#101828]">
                              {one.speaker_name}
                            </p>
                            {one.speaker_role && (
                              <p className="text-[13px] text-[#1e2939]">
                                {one.speaker_role}
                              </p>
                            )}
                          </div>
                        </article>
                      ))
                  )}
                </div>
              )}

              {tab === 'files' && group.sessions.map((one) => {
                const mine = files.filter((f) => f.session === one.id);
                if (mine.length === 0) return null;
                return (
                  <div key={one.id}>
                    <TalkHead title={one.title} />
                    <ul className="pt-3 flex flex-col gap-2">
                      {mine.map((file) => (
                        <li
                          key={file.id}
                          className="border-[0.72px] border-[#b3b3b3]
                            rounded-[16px] p-4 flex gap-3 items-center"
                        >
                          <span className="size-10 rounded-[12px] bg-[#fef2f2]
                            grid place-items-center flex-none">
                            <img src={fileIcon} alt="" width="18" height="18" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] font-medium
                              text-[#101828] leading-[21px] truncate">
                              {file.display_name}
                            </span>
                            <span className="block text-[12px] text-[#99a1af]
                              leading-4">
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
                                en: `Download ${file.display_name}`,
                              })}
                              className="bg-[#efefef] rounded-[12px] p-2 flex-none
                                grid place-items-center"
                            >
                              <img src={downloadIcon} alt="" width="18" height="18" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {(tab === 'questions' || tab === 'suggestions') &&
                group.sessions.map((one) => {
                  const posts = postsOf(one, tab);
                  if (posts.length === 0) return null;
                  return (
                    <Thread
                      key={one.id}
                      title={one.title}
                      posts={posts}
                      more={(n) => (tab === 'questions'
                        ? t({
                            ne: `थप ${num(n)} प्रश्न हेर्नुहोस्`,
                            en: `view ${n} more ${n === 1 ? 'question' : 'questions'}`,
                          })
                        : t({
                            ne: `थप ${num(n)} सुझाव हेर्नुहोस्`,
                            en: `view ${n} more ${n === 1 ? 'suggestion' : 'suggestions'}`,
                          }))}
                      onVote={tab === 'questions' ? vote : undefined}
                    />
                  );
                })}
            </section>
          ))
        )}
      </div>

      <div className="h-6" />
    </div>
  );
};
