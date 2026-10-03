import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import {
  Artifact, Event, HubPost, PhotoPage, Session, SessionSummary, Speaker, SubEvent,
} from '../../types';
import { Pair, useOrganizer } from '../../organizer/i18n';
import { errorText } from '../../organizer/errors';
import { formatSize, kindOf } from '../../organizer/filesAndSummaries/shared';
import { daysOf } from '../../organizer/events/days';
import { Grouped, groupSessions } from './grouping';
import { stateOf } from './HomeShell';
import { PhotoImage } from '../../organizer/Photos';
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
                  ▼ {num(post.downvote_count ?? 0)}
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
  fromHome?: boolean;
  onBack: () => void;
  onEnterRoom?: () => void;
}> = ({ event, fromHome = false, onBack, onEnterRoom }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<Tab>('agendas');
  /** The files tab holds two: the handouts, and the albums. */
  const [filesAt, setFilesAt] = useState<'agenda' | 'photos'>('agenda');
  const [albums, setAlbums] = useState<PhotoPage | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [speakerProfiles, setSpeakerProfiles] = useState<Speaker[]>([]);
  const [groups, setGroups] = useState<SubEvent[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [files, setFiles] = useState<Artifact[]>([]);
  const [board, setBoard] = useState<{ questions: HubPost[]; suggestions: HubPost[] }>(
    { questions: [], suggestions: [] }
  );
  const [day, setDay] = useState('');

  const read = useCallback(async () => {
    const [own, parts, shared, hub, profiles] = await Promise.all([
      apiClient.listSessions(event.id).catch(() => [] as Session[]),
      apiClient.getSubEvents(event.id).catch(() => [] as SubEvent[]),
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
      apiClient.getHub(event.code).catch(() => null),
      apiClient.getSpeakers(event.id).catch(() => [] as Speaker[]),
    ]);
    setSessions(own);
    setSpeakerProfiles(profiles);
    setGroups(parts);
    setFiles(shared);
    setBoard({
      questions: hub?.questions ?? [],
      suggestions: hub?.suggestions ?? [],
    });

    apiClient.getPhotos(event.code).then(setAlbums).catch(() => setAlbums(null));

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

  /**
   * Which talks this tab is about.
   *
   * The day pills belong to the running order, where picking a day is
   * the whole point of them. Everywhere else the question is about the
   * event: who spoke at it, what was shared at it, what was asked at
   * it - and the filter followed those tabs around silently, so the
   * speaker list showed one day's speakers with nothing on screen
   * saying why the others were missing.
   */
  const inScope = useMemo(
    () => (tab === 'agendas'
      ? sessions.filter(
          (one) => days.length <= 1 || dayKey(new Date(one.starts_at)) === onDay
        )
      : sessions),
    [tab, sessions, days.length, onDay]
  );

  const grouped: Grouped[] = useMemo(
    () => groupSessions(
      inScope, groups, t({ ne: 'बाँकी', en: 'Everything else' })
    ),
    [inScope, groups, t]
  );
  const postsOf = (one: Session, kind: 'questions' | 'suggestions') =>
    board[kind].filter((post) => post.session_id === one.id);

  /**
   * Everything that belongs to no talk on the programme.
   *
   * A question asked with nothing on stage carries no session, and
   * the rest of this screen is grouped by session - so without a
   * place of its own it was drawn nowhere at all. Which is how a
   * question somebody could see in the room, and the host could see
   * on their queue, came back to an empty tab here.
   *
   * Measured against every session the event has, not the day being
   * shown, or switching days would strand the ones from the other.
   */
  const onProgramme = (id: string | null | undefined) =>
    Boolean(id) && sessions.some((one) => one.id === id);

  const looseFiles = files.filter((one) => !onProgramme(one.session));
  const loosePosts = (kind: 'questions' | 'suggestions') =>
    board[kind].filter((post) => !onProgramme(post.session_id));
  const looseQuestions = loosePosts('questions');
  const questionAgenda = groups.length === 1 ? groups[0] : null;
  const questionAgendaIsGrouped = Boolean(
    questionAgenda && grouped.some((group) => group.id === questionAgenda.id)
  );
  const renderLooseThread = (kind: 'questions' | 'suggestions') => (
    <Thread
      title={t(TAB[kind])}
      posts={loosePosts(kind)}
      more={(n) => (kind === 'questions'
        ? t({
            ne: `थप ${num(n)} प्रश्न हेर्नुहोस्`,
            en: `View ${n} more ${n === 1 ? 'Question' : 'Questions'}`,
          })
        : t({
            ne: `थप ${num(n)} सुझाव हेर्नुहोस्`,
            en: `View ${n} more ${n === 1 ? 'Suggestion' : 'Suggestions'}`,
          }))}
      onVote={kind === 'questions' ? vote : undefined}
    />
  );

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

  /**
   * Whether this tab is showing anything at all.
   *
   * The page used to be painted blue underneath everything, so a tab
   * with nothing on it was a white strip and then a blue slab - which
   * reads as a rendering fault rather than as an empty tab. The blue
   * is the ground between and beneath the white blocks; with no
   * blocks there is no ground to see.
   */
  const showingAlbums = tab === 'files' && filesAt === 'photos';
  const filled = showingAlbums
    ? (albums?.folders ?? []).length > 0
    : grouped.length > 0;

  return (
    <div className="bg-white min-h-full flex flex-col">
      <header
        className="bg-white px-4 pt-3 pb-2 border-b-[0.72px] border-[#b3b3b3]"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="pt-4 flex items-center gap-1.5 pt-4 text-[14px] font-medium
            text-[#9e9e9e] leading-5"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {fromHome
            ? t({ ne: 'पछाडि', en: 'Back' })
            : t({ ne: 'घटनाहरू', en: 'Events' })}
        </button>

        <div className="pt-1 flex items-start gap-1">
          <h1 className="flex-1 text-[18px] pt-4 font-semibold text-[#101828]
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

      {/* Scrolled rather than squeezed. A seven-day programme used to
          shrink every pill until each was a circle round a wrapped
          digit. */}
      {tab === 'agendas' && days.length > 1 && (
        <div className="bg-white px-4 py-2.5 flex gap-2 overflow-x-auto
          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map((one, i) => (
            <button
              key={one}
              type="button"
              aria-pressed={one === onDay}
              onClick={() => setDay(one)}
              className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5
                text-[12px] ${
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

      {/* The files tab holds two different things: the handouts filed
          against each talk, and the albums of the day. A switcher
          rather than two more tabs along the top, which would have
          made seven. */}
      {tab === 'files' && (
        <div className="bg-white px-4 pt-4 pb-2.5">
          <div className="bg-[#d6e4f8] rounded-[12px] p-1 flex gap-1 h-11">
            {([
              ['agenda', t({ ne: 'कार्यसूचीका फाइल', en: "Agenda's File" })],
              ['photos', t({ ne: 'तस्बिर', en: 'Photos' })],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filesAt === id}
                onClick={() => setFilesAt(id)}
                className={`flex-1 rounded-[8px] capitalize text-[14px] font-medium
                  leading-5 ${filesAt === id
                    ? 'bg-white text-[#101828] drop-shadow-[0px_1px_1.5px_rgba(0,0,0,0.1)]'
                    : 'text-[#6a7282]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The albums are of the day rather than of one talk, so they sit
          outside the parts the rest of the screen is grouped into. */}
      {tab === 'files' && filesAt === 'photos' && (
        <section className="bg-white mb-[22rem] px-4 py-2.5">
          {(albums?.folders ?? []).length === 0 ? (
            <p className="py-4 text-[13px] text-[#99a1af]">
              {t({ ne: 'कुनै तस्बिर छैन।', en: 'No photographs yet.' })}
            </p>
          ) : (
            <div className="pt-3 pb-3 grid grid-cols-2 gap-5">
              {(albums?.folders ?? []).map((folder) => {
                const cover = albums?.photos.find(
                  (one) => one.folder_id === folder.id
                );
                return (
                  <div
                    key={folder.id}
                    className="bg-white border-[0.72px] border-[#b3b3b3]
                      rounded-[16px] overflow-hidden
                      shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]"
                  >
                    <div className="h-[178px] bg-[#f3f4f6]">
                      {cover && (
                        <PhotoImage
                          photo={cover}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-[13px] font-semibold leading-[19.5px]
                        text-[#101828] truncate">
                        {folder.name}
                      </p>
                      <p className="text-[12px] leading-4 text-[#99a1af]">
                        {t({
                          ne: `${num(folder.photo_count)} तस्बिर`,
                          en: `${folder.photo_count} photo`
                            + `${folder.photo_count === 1 ? '' : 's'}`,
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className={`flex flex-col gap-1.5 ${filled ? 'bg-[#d6e4f8]' : ''}`}>
        {tab === 'files' && filesAt === 'photos' ? null : grouped.length === 0 && !(
          tab === 'questions' && Boolean(questionAgenda) && looseQuestions.length > 0
        ) ? (
          <p className="bg-white px-4 py-8 text-center text-[13px] text-[#8b90a0]">
            {tab === 'questions'
              ? t({
                  ne: 'कार्यक्रम सुरु भएपछि प्रश्नहरू यहाँ उपलब्ध हुनेछन्।',
                  en: 'Questions will be available during the event.',
                })
              : tab === 'suggestions'
              ? t({
                  ne: 'कार्यक्रम सुरु भएपछि सुझावहरू यहाँ उपलब्ध हुनेछन्।',
                  en: 'Suggestions will be available during the event.',
                })
              : t({ ne: 'यहाँ केही छैन।', en: 'Nothing here yet.' })}
          </p>
        ) : (
          <>
            {grouped.map((group) => (
              <section
                key={group.id || 'loose'}
                className="bg-white px-4 py-2.5 flex flex-col gap-2.5"
              >
                <GroupHead title={group.title} />
                {(tab === 'questions' || tab === 'suggestions')
                  && group.sessions.every(
                    (one) => postsOf(one, tab).length === 0
                  ) && (
                  <p className="text-[13px] text-[#8b90a0]">
                    {tab === 'questions'
                      ? t({
                          ne: 'कार्यक्रम सुरु भएपछि प्रश्नहरू यहाँ उपलब्ध हुनेछन्।',
                          en: 'Questions will be available during the event.',
                        })
                      : t({
                          ne: 'कार्यक्रम सुरु भएपछि सुझावहरू यहाँ उपलब्ध हुनेछन्।',
                          en: 'Suggestions will be available during the event.',
                        })}
                  </p>
                )}

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
                          <p className="pt-0.5 text-[12px] text-[#99a1af]">
                            {clock(one.starts_at)}
                            {one.speaker_name && ` · ${one.speaker_name}`}
                          </p>
                          {summary?.is_published && summary.body
                            ? <Prose body={summary.body} />
                            : (
                              <p className="pt-2 text-[13px] text-[#656565]">
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
                              <span className="inline-block bg-[#efefef] text-[#194d97]
                                rounded-[6px] px-2 py-1 text-[12px]">
                                {one.title}
                              </span>
                              <p className="pt-1.5 text-[15px] font-semibold
                                text-[#101828]">
                                {one.speaker_name}
                              </p>
                              {one.speaker_role && (
                                <p className="text-[13px] text-[#64748b]">
                                  {one.speaker_role}
                                </p>
                              )}
                              {speakerProfiles.find(
                                (profile) => profile.id === one.speaker
                              )?.organization && (
                              <p className="text-[13px] text-[#94a3b8]">
                                  {speakerProfiles.find(
                                    (profile) => profile.id === one.speaker
                                  )?.organization}
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

                {tab === 'questions' && questionAgenda?.id === group.id &&
                  looseQuestions.length > 0 && renderLooseThread('questions')}
              </section>
            ))}
            {tab === 'questions' && questionAgenda && !questionAgendaIsGrouped &&
              looseQuestions.length > 0 && (
                <section className="bg-white px-4 py-2.5 flex flex-col gap-2.5">
                  <GroupHead title={questionAgenda.title} />
                  {renderLooseThread('questions')}
                </section>
              )}
            <div className="h-0" />
          </>
        )}

        {/* Not under any part of the day, because it belongs to none. */}
        {tab === 'files' && filesAt === 'agenda' && looseFiles.length > 0 && (
          <section className="bg-white px-4 py-2.5 flex flex-col gap-2.5">
            <GroupHead title={t({ ne: 'कार्यक्रमभरि', en: 'For the whole event' })} />
            <ul className="pt-1 flex flex-col gap-2">
              {looseFiles.map((file) => (
                <li
                  key={file.id}
                  className="border-[0.72px] border-[#b3b3b3] rounded-[16px] p-4
                    flex gap-3 items-center"
                >
                  <span className="size-10 rounded-[12px] bg-[#fef2f2]
                    grid place-items-center flex-none">
                    <img src={fileIcon} alt="" width="18" height="18" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-[#101828]
                      leading-[21px] truncate">
                      {file.display_name}
                    </span>
                    <span className="block text-[12px] text-[#99a1af] leading-4">
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
          </section>
        )}

        {(tab === 'suggestions' || (tab === 'questions' && !questionAgenda))
          && loosePosts(tab).length > 0 && (
          <section className="bg-white px-4 py-2.5 flex flex-col gap-2.5">
            <GroupHead
              title={t({ ne: 'कार्यक्रमभरि', en: 'For the whole event' })}
            />
            {renderLooseThread(tab)}
          </section>
        )}
      </div>

      {/* The rest of the way down. Only where something is sitting on
          it: an empty tab is simply a white screen, and a blue slab
          under nothing reads as a rendering fault. */}
      {filled && <div className="flex-1 bg-[#d6e4f8]" data-ground aria-hidden />}
    </div>
  );
};
