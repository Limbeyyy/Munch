import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import { Artifact, Event, Session, SessionSummary, SubEvent } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { daysOf } from '../../organizer/events/days';
import { ScreenHead } from './PhoneShell';
import { Grouped, groupSessions } from './grouping';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayKey = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/**
 * One talk, read rather than run.
 *
 * What it settled and who gave it, which are the two things somebody
 * asks of a talk afterwards. Neither is editable here: this is the
 * attendee's copy of the programme.
 */
const AgendaDetail: React.FC<{
  event: Event;
  session: Session;
  isLive: boolean;
  onBack: () => void;
}> = ({ event, session, isLive, onBack }) => {
  const { t } = useOrganizer();
  const [tab, setTab] = useState<'summary' | 'speaker'>('summary');
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient.getSessionSummary(session.id)
      .then((got) => { if (alive) setSummary(got); })
      // Only a published one is readable by an attendee, so a refusal
      // here means there is nothing to read yet rather than a fault.
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [session.id]);

  const ends = new Date(
    +new Date(session.starts_at) + session.duration_minutes * 60000
  ).toISOString();

  return (
    <div>
      <header
        className="px-4 pt-3 pb-3 border-b border-[#eceef2]"
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
          {t({ ne: 'कार्यसूची', en: 'Agenda' })}
        </button>

        <div className="pt-1.5 flex items-start gap-2 flex-wrap">
          <h1 className="text-[19px] font-semibold text-[#111726] leading-tight">
            {session.title}
          </h1>
          {isLive && (
            <span className="bg-[#f2f3f5] rounded-full px-2.5 py-1 flex items-center
              gap-1.5 flex-none">
              <span className="bg-[#e12121] rounded-full size-1.5" aria-hidden />
              <span className="text-[11px] font-medium text-[#e12121]">
                {t({ ne: 'प्रत्यक्ष', en: 'Live' })}
              </span>
            </span>
          )}
        </div>
        <p className="pt-1 text-[12px] text-[#8b90a0]">
          {clock(session.starts_at)} – {clock(ends)}
          <span className="px-2">|</span>
          {event.title}
        </p>
      </header>

      <div role="tablist" className="px-4 flex gap-5 border-b border-[#eceef2]">
        {([
          ['summary', t({ ne: 'सारांश', en: 'Summary' })],
          ['speaker', t({ ne: 'वक्ता', en: 'Speaker' })],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`py-2.5 text-[14px] border-b-2 -mb-px ${
              tab === id
                ? 'border-[#2440c9] text-[#2440c9] font-medium'
                : 'border-transparent text-[#8b90a0]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <div className="p-4">
          <div className="border border-[#e8eaee] rounded-[12px] p-4">
            <p className="text-[14px] font-semibold text-[#111726]">
              {t({ ne: 'सारांश', en: 'Overview' })}
            </p>
            <p className="pt-1.5 text-[14px] leading-6 text-[#2b3140]">
              {summary?.is_published && summary.body
                ? summary.body
                : t({
                    ne: 'यो कार्यसूचीको सारांश अझै प्रकाशित भएको छैन।',
                    en: 'No summary has been published for this agenda yet.',
                  })}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4">
          {session.speaker_name ? (
            <div className="border border-[#e8eaee] rounded-[12px] p-3 flex gap-3
              items-center">
              <span className="size-[74px] rounded-[10px] bg-[#fbecd1] grid
                place-items-center overflow-hidden flex-none text-[26px]
                font-semibold text-[#12386e]">
                {session.speaker_photo_url
                  ? <img src={session.speaker_photo_url} alt=""
                      className="w-full h-full object-cover" />
                  : session.speaker_name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[#111726]">
                  {session.speaker_name}
                </p>
                {session.speaker_role && (
                  <p className="text-[13px] text-[#2b3140]">{session.speaker_role}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-[#8b90a0]">
              {t({ ne: 'वक्ता तोकिएको छैन।', en: 'No speaker named.' })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Where a talk has got to, as the cards label it.
 *
 * Read off the talk itself rather than off the room, because the list
 * shows the whole day and only one of them is the room.
 */
type Where = 'completed' | 'live' | 'upcoming';

const whereOf = (one: Session): Where => {
  if (one.status === 'live') return 'live';
  if (one.status === 'done' || one.status === 'skipped') return 'completed';
  return 'upcoming';
};

const WhereChip: React.FC<{ where: Where }> = ({ where }) => {
  const { t } = useOrganizer();
  const ink = {
    completed: '#018030',
    live: '#bc1c1c',
    upcoming: '#4272dd',
  }[where];
  const label = {
    completed: t({ ne: 'सकियो', en: 'Completed' }),
    live: t({ ne: 'प्रत्यक्ष', en: 'Live' }),
    upcoming: t({ ne: 'आउँदै', en: 'Upcoming' }),
  }[where];

  return (
    <span
      className="bg-[#efefef] rounded-full px-2.5 py-1 flex items-center gap-1.5
        flex-none text-[11px] font-semibold whitespace-nowrap"
      style={{ color: ink }}
    >
      <span className="rounded-full size-[6px] flex-none"
        style={{ backgroundColor: ink }} aria-hidden />
      {label}
    </span>
  );
};

/**
 * The running order, grouped under the parts of the day it was
 * arranged into.
 *
 * A programme read straight through is a list of thirty talks; read
 * under its headings it is three subjects, and somebody looking for
 * the emergency track finds it without reading the other two. The
 * headings are the host's own - what they called each part when they
 * grouped it - so this screen says nothing the programme does not.
 */
export const AgendaScreen: React.FC<{
  event: Event;
  sessions: Session[];
  live: Session | null;
}> = ({ event, sessions, live }) => {
  const { t, num } = useOrganizer();
  const [opened, setOpened] = useState<string>('');
  const [day, setDay] = useState('');
  const [groups, setGroups] = useState<SubEvent[]>([]);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [asked, setAsked] = useState<Record<string, number>>({});

  const read = useCallback(async () => {
    const [parts, shared, hub] = await Promise.all([
      apiClient.getSubEvents(event.id).catch(() => [] as SubEvent[]),
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
      apiClient.getHub(event.code).catch(() => null),
    ]);
    setGroups(parts);
    setFiles(shared);
    const tally: Record<string, number> = {};
    (hub?.questions ?? []).forEach((post) => {
      if (post.session_id) tally[post.session_id] = (tally[post.session_id] ?? 0) + 1;
    });
    setAsked(tally);
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

  const open = sessions.find((one) => one.id === opened);
  if (open) {
    return (
      <AgendaDetail
        event={event}
        session={open}
        isLive={live?.id === open.id}
        onBack={() => setOpened('')}
      />
    );
  }

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <ScreenHead
        title={t({ ne: 'कार्यसूची', en: 'Agenda' })}
        under={event.title}
      />

      <div className="flex flex-col gap-1.5">
        {days.length > 1 && (
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

        {grouped.length === 0 ? (
          <p className="bg-white px-4 py-8 text-center text-[13px] text-[#8b90a0]">
            {t({ ne: 'यो दिन केही छैन।', en: 'Nothing on this day.' })}
          </p>
        ) : (
          grouped.map((group) => (
            <section key={group.id || 'loose'} className="bg-white px-4 py-2.5">
              <h2 className="capitalize text-[16px] font-semibold text-[#101010]
                leading-5">
                {group.title}
              </h2>

              <ul className="pt-2.5 flex flex-col gap-2.5">
                {group.sessions.map((one) => {
                  const where = live?.id === one.id ? 'live' : whereOf(one);
                  const mine = files.filter((f) => f.session === one.id).length;
                  const qs = asked[one.id] ?? 0;
                  return (
                    <li key={one.id}>
                      <button
                        type="button"
                        onClick={() => setOpened(one.id)}
                        className={`w-full text-left bg-white border rounded-[12px]
                          px-5 py-3 flex items-center gap-4
                          shadow-[0px_4px_3px_rgba(0,0,0,0.1),0px_2px_2px_rgba(0,0,0,0.05)]
                          ${where === 'live'
                            ? 'border-[#f75656]'
                            : 'border-[#b3b3b3]'}`}
                        style={{ borderWidth: '0.612px' }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold
                            text-[#101828] leading-5">
                            {one.title}
                          </span>
                          <span className="block pt-0.5 text-[12px] text-[#656565]
                            leading-4 truncate">
                            {clock(one.starts_at)}
                            {one.speaker_name && ` · ${one.speaker_name}`}
                          </span>
                          <span className="block pt-1 text-[12px] text-[#959595]
                            leading-[18px]">
                            {t({
                              ne: `${num(qs)} प्रश्न · ${num(mine)} फाइल`,
                              en: `${qs} question${qs === 1 ? '' : 's'}`
                                + ` · ${mine} file${mine === 1 ? '' : 's'}`,
                            })}
                          </span>
                        </span>

                        <span className="flex flex-col items-end gap-4 flex-none">
                          <WhereChip where={where} />
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="#b8bcc6" strokeWidth="2.4" strokeLinecap="round"
                            strokeLinejoin="round" aria-hidden>
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
};
