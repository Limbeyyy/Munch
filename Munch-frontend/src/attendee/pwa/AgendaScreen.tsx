import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import { Event, Session, SessionSummary } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { daysOf } from '../../organizer/events/days';
import { ScreenHead } from './PhoneShell';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayKey = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

const longDay = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  }).toUpperCase();

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
 * The running order, a day at a time.
 *
 * Down the left is when, because that is what somebody in a hall is
 * looking for: the next thing, and how long until it.
 */
export const AgendaScreen: React.FC<{
  event: Event;
  sessions: Session[];
  live: Session | null;
}> = ({ event, sessions, live }) => {
  const { t, num } = useOrganizer();
  const [opened, setOpened] = useState<string>('');
  const [day, setDay] = useState('');

  const days = useMemo(() => daysOf(event), [event]);
  const onDay = day && days.includes(day) ? day : (days[0] ?? '');

  const shown = useMemo(
    () => [...sessions]
      .filter((one) => days.length <= 1 || dayKey(new Date(one.starts_at)) === onDay)
      .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)),
    [sessions, days.length, onDay]
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
    <div>
      <ScreenHead
        title={t({ ne: 'कार्यसूची', en: 'Agenda' })}
        under={event.title}
      />

      {days.length > 1 && (
        <div className="px-4 pt-3">
          <label className="sr-only" htmlFor="manch-pwa-day">
            {t({ ne: 'दिन', en: 'Day' })}
          </label>
          <select
            id="manch-pwa-day"
            value={onDay}
            onChange={(e) => setDay(e.target.value)}
            className="bg-[#2440c9] text-white rounded-[10px] px-3 py-2
              text-[14px] font-medium"
          >
            {days.map((one, i) => (
              <option key={one} value={one}>
                {t({ ne: `दिन ${num(i + 1)}`, en: `Day ${i + 1}` })}
              </option>
            ))}
          </select>
        </div>
      )}

      {onDay && (
        <p className="px-4 pt-3 text-[11px] font-semibold tracking-[.06em]
          text-[#8b90a0]">
          {days.length > 1
            ? `${t({ ne: 'दिन', en: 'Day' })} ${num(days.indexOf(onDay) + 1)} — ${longDay(onDay)}`
            : longDay(onDay)}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {t({ ne: 'यो दिन केही छैन।', en: 'Nothing on this day.' })}
        </p>
      ) : (
        <ul className="px-4 pt-2 pb-4 flex flex-col">
          {shown.map((one) => {
            const isLive = live?.id === one.id;
            return (
              <li key={one.id} className="flex gap-3">
                <span className="w-[54px] flex-none pt-3 text-right">
                  <span className="block text-[13px] font-medium text-[#2440c9]
                    tabular-nums">
                    {clock(one.starts_at).replace(/\s?[AP]M/i, '')}
                  </span>
                  <span className="block text-[10px] text-[#9ba0ad]">
                    {clock(one.starts_at).slice(-2)}
                  </span>
                </span>

                <span className="relative flex-none w-px bg-[#e6e9ee]" aria-hidden />

                <button
                  type="button"
                  onClick={() => setOpened(one.id)}
                  className={`flex-1 my-1.5 text-left border rounded-[12px] px-3.5 py-3
                    flex items-center gap-3 ${
                    isLive
                      ? 'border-[#2440c9] shadow-[0_0_0_1px_rgba(36,64,201,.25)]'
                      : 'border-[#e8eaee]'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#111726]">
                      {one.title}
                    </span>
                    <span className="block pt-1 text-[12px] text-[#8b90a0] truncate">
                      {t({
                        ne: `${num(one.duration_minutes)} मिनेट`,
                        en: `${one.duration_minutes} min`,
                      })}
                      {one.speaker_name && ` · ${one.speaker_name}`}
                    </span>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="#b8bcc6" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden className="flex-none">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
