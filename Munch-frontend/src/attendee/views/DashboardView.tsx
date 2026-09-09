import React from 'react';
import { EventMeeting, EventProgramme } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { Btn, Card } from '../../organizer/ui';
import {
  deskSession, doorway, howFarOff, sessionState,
} from '../../organizer/sessionState';
import { Spine, SpineItem, clock } from '../Spine';

interface Props {
  event: EventProgramme | null;
  items: SpineItem[];
  live: SpineItem | null;
  attendedIds: Set<string>;
  onOpen: (item: SpineItem) => void;
  onNavigate: (view: string) => void;
  onJoinRoom: (meeting: EventMeeting) => void;
  /** Seconds the live session has been running, from the server's clock. */
  elapsed: number;
}

/**
 * The next session, whenever it is.
 *
 * Shown the same way whether it is eight hours off or eight minutes: what
 * changes with the clock is the door, not whether people are told what is
 * coming. Going in is refused until a quarter of an hour before, and the
 * button says so rather than failing when pressed.
 */
const UpNext: React.FC<{
  item: SpineItem;
  onOpen: (item: SpineItem) => void;
  onJoinRoom: (meeting: EventMeeting) => void;
}> = ({ item, onOpen, onJoinRoom }) => {
  const { t, num } = useOrganizer();
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const door = doorway(item.session.starts_at, now);
  const { amount, unit } = howFarOff(item.session.starts_at, now);
  const away =
    unit === 'minute'
      ? t({ ne: `${num(amount)} मिनेटमा`, en: `in ${amount} min` })
      : unit === 'hour'
      ? t({ ne: `${num(amount)} घण्टामा`, en: `in ${amount} h` })
      : t({ ne: `${num(amount)} दिनमा`, en: `in ${amount} d` });
  const opens = new Date(door.opensAt).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className="bg-navy-800 text-white rounded-[22px] px-6 py-5"
      style={{ backgroundImage: 'radial-gradient(circle at 88% -20%, rgba(240,162,43,.22), transparent 55%)' }}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[12.5px] text-amber font-semibold">
          {t({ ne: 'अर्को सत्र', en: 'Up next' })}
        </span>
        <span className="text-[12px] text-[#C9DAF1] bg-white/[.14] rounded-full px-2.5 leading-[20px]">
          {away}
        </span>
        <span className="ms-auto text-[12.5px] text-[#AFC6E6]">
          {item.meeting.title} · {clock(item.session.starts_at)}–{clock(item.session.ends_at)}
        </span>
      </div>

      <h2 className="text-[23px] font-semibold mt-3 mb-1.5 tracking-tight">
        {item.session.title}
      </h2>
      <p className="text-sm text-[#C9DAF1]">
        {[
          item.session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' }),
          item.session.hall,
        ].filter(Boolean).join(' · ')}
      </p>

      <div className="flex gap-2.5 mt-4 flex-wrap items-center">
        <button
          onClick={() => onJoinRoom(item.meeting)}
          disabled={!door.canEnter}
          className="px-3.5 py-2 rounded-[10px] bg-amber text-[#20160A] text-[13.5px] font-semibold
            disabled:opacity-45 disabled:cursor-not-allowed"
        >
          {t({ ne: 'कोठामा जानुहोस्', en: 'Enter the room' })}
        </button>
        <button
          onClick={() => onOpen(item)}
          className="px-3.5 py-2 rounded-[10px] border border-white/35 text-[13.5px] hover:bg-white/[.12]"
        >
          {t({ ne: 'विवरण हेर्नुहोस्', en: 'See the details' })}
        </button>
        {!door.canEnter && (
          <span className="text-[12.5px] text-[#AFC6E6]">
            {t({
              ne: `कोठा ${opens} बजे खुल्छ`,
              en: `The room opens at ${opens}`,
            })}
          </span>
        )}
      </div>
    </div>
  );
};

/** What is happening now, what you have missed, and what is coming. */
export const DashboardView: React.FC<Props> = ({
  event, items, live, attendedIds, onOpen, onNavigate, onJoinRoom, elapsed,
}) => {
  const { t, num } = useOrganizer();

  // Attendance can only be judged on sessions that actually ran.
  const done = items.filter((i) => sessionState(i.session, Date.now(), i.meeting) === 'finished');
  const ahead = items
    .filter((i) => sessionState(i.session, Date.now(), i.meeting) === 'upcoming')
    .sort((a, b) => +new Date(a.session.starts_at) - +new Date(b.session.starts_at));
  const upcoming = ahead.slice(0, 3);
  /**
   * What the panel shows when nothing is on stage: the session the desk
   * would be holding, however far off it is. An empty panel saying
   * "nothing is running" answers a question nobody asked - what people
   * want to know is what is next and whether they can go in yet.
   *
   * The same rule the organizer's desk uses, so the two agree about which
   * session the day has reached.
   */
  const onDesk = deskSession(
    items.map((i) => i.session),
    Date.now()
  ).session;
  const next = items.find((i) => i.session.id === onDesk?.id) ?? ahead[0] ?? null;
  const attendedCount = done.filter((i) => attendedIds.has(i.session.id)).length;
  const missed = done.filter((i) => !attendedIds.has(i.session.id));

  const progress = live
    ? Math.min(100, Math.round((elapsed / (live.session.duration_minutes * 60)) * 100))
    : 0;
  const leftMinutes = live
    ? Math.max(0, live.session.duration_minutes - Math.floor(elapsed / 60))
    : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_326px] items-start">
      <div className="min-w-0">
        {/* What is on stage */}
        {live ? (
          <div
            className="bg-navy-800 text-white rounded-[22px] px-6 py-5"
            style={{ backgroundImage: 'radial-gradient(circle at 88% -20%, rgba(240,162,43,.32), transparent 55%)' }}
          >
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full bg-amber animate-pulse" />
              <span className="text-[12.5px] text-amber font-semibold">
                {t({ ne: 'अहिले चलिरहेको सत्र', en: 'On stage now' })}
              </span>
              <span className="ms-auto text-[12.5px] text-[#AFC6E6]">
                {live.meeting.title} · {clock(live.session.starts_at)}–{clock(live.session.ends_at)}
              </span>
            </div>

            <h2 className="text-[23px] font-semibold mt-3 mb-1.5 tracking-tight">
              {live.session.title}
            </h2>
            <p className="text-sm text-[#C9DAF1]">
              {live.session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
            </p>

            <div className="mt-4">
              <div className="h-1.5 rounded-md bg-white/[.18] overflow-hidden">
                <i
                  className="block h-full bg-amber rounded-md transition-[width] duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-[#AFC6E6] mt-2">
                <span>{t({ ne: 'चलिरहेको', en: 'Running' })}</span>
                <span>
                  {t({
                    ne: `बाँकी ${num(leftMinutes)} मिनेट`,
                    en: `${leftMinutes} minutes left`,
                  })}
                </span>
              </div>
            </div>

            <div className="flex gap-2.5 mt-4 flex-wrap">
              <button
                onClick={() => onJoinRoom(live.meeting)}
                className="px-3.5 py-2 rounded-[10px] bg-amber text-[#20160A] text-[13.5px] font-semibold"
              >
                {t({ ne: 'कोठामा जानुहोस्', en: 'Enter the room' })}
              </button>
              <button
                onClick={() => onOpen(live)}
                className="px-3.5 py-2 rounded-[10px] border border-white/35 text-[13.5px] hover:bg-white/[.12]"
              >
                {t({ ne: 'ट्रान्सक्रिप्ट हेर्नुहोस्', en: 'Follow the transcript' })}
              </button>
            </div>
          </div>
        ) : next ? (
          <UpNext item={next} onOpen={onOpen} onJoinRoom={onJoinRoom} />
        ) : (
          <Card className="text-center py-8">
            <p className="text-[#6E7C8E]">
              {items.length === 0
                ? t({ ne: 'तपाईंको कुनै कार्यक्रम छैन।', en: 'You are not on any programme yet.' })
                : t({ ne: 'तपाईंको कार्यक्रममा अब कुनै सत्र बाँकी छैन।', en: 'Nothing left on your programme.' })}
            </p>
          </Card>
        )}

        {/* Where you stand */}
        <div
          className="grid gap-px bg-navy-800/15 border border-navy-800/15 rounded-[14px] overflow-hidden my-5"
          style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}
        >
          {[
            { value: `${num(attendedCount)}/${num(done.length)}`, label: { ne: 'सत्र उपस्थित', en: 'Sessions attended' }, ok: true },
            { value: num(missed.length), label: { ne: 'छुटेका सत्र', en: 'Sessions missed' } },
            { value: num(items.length), label: { ne: 'कुल सत्र', en: 'Sessions in all' } },
            { value: num(event?.meeting_count ?? 0), label: { ne: 'बैठक', en: 'Meetings' } },
          ].map((s, i) => (
            <div key={i} className="bg-white px-4 py-3">
              <b className={`block text-[21px] font-semibold tracking-tight tabular-nums ${s.ok ? 'text-ok' : ''}`}>
                {s.value}
              </b>
              <span className="text-[12.5px] text-[#6E7C8E]">{t(s.label)}</span>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-[18px] font-semibold">{t({ ne: 'आजको एजेन्डा', en: "Today's agenda" })}</h2>
            <button
              onClick={() => onNavigate('agenda')}
              className="ms-auto text-[13px] text-navy-700 underline underline-offset-4"
            >
              {t({ ne: 'पूरा एजेन्डा', en: 'The full agenda' })}
            </button>
          </div>
          <Spine items={items.slice(0, 6)} onOpen={onOpen} />
        </div>
      </div>

      {/* Side */}
      <aside className="flex flex-col gap-4 xl:sticky xl:top-[84px]">
        {missed.length > 0 && (
          <Card className="border-s-4 border-s-amber">
            <h3 className="text-[15.5px] font-semibold">{t({ ne: 'छुटेका सत्र', en: 'What you missed' })}</h3>
            <p className="text-[13px] text-[#6E7C8E] mt-1">
              {t({
                ne: `${num(missed.length)} सत्रमा तपाईंको उपस्थिति दर्ता भएन। ट्रान्सक्रिप्टबाट पढ्न सकिन्छ।`,
                en: `You were not recorded at ${missed.length} session${missed.length === 1 ? '' : 's'}. The transcript is there to read.`,
              })}
            </p>
            <ul className="mt-3 ps-4 font-read text-[13.5px] leading-[1.75] text-ink-2 list-disc">
              {missed.slice(0, 3).map((m) => (
                <li key={m.session.id}>{m.session.title}</li>
              ))}
            </ul>
            <Btn tone="solid" className="mt-3" onClick={() => onOpen(missed[0])}>
              {t({ ne: 'पहिलो सत्र पढ्नुहोस्', en: 'Read the first one' })}
            </Btn>
          </Card>
        )}

        <Card>
          <h3 className="text-[15.5px] font-semibold">{t({ ne: 'आउँदै', en: 'Coming up' })}</h3>
          {upcoming.length === 0 ? (
            <p className="text-[13px] text-[#6E7C8E] mt-1">
              {t({ ne: 'यसपछि केही छैन।', en: 'Nothing after this.' })}
            </p>
          ) : (
            upcoming.map((u) => (
              <button
                key={u.session.id}
                onClick={() => onOpen(u)}
                className="flex gap-3 items-start py-2.5 border-t border-navy-800/[.08] first:border-0 w-full text-start"
              >
                <span className="text-xs text-[#6E7C8E] tabular-nums pt-0.5 w-11 flex-none">
                  {clock(u.session.starts_at)}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{u.session.title}</span>
                  <span className="block text-[12.5px] text-[#6E7C8E] truncate">
                    {u.session.speaker_name || u.meeting.title}
                  </span>
                </span>
              </button>
            ))
          )}
        </Card>

        <Card>
          <h3 className="text-[15.5px] font-semibold">{t({ ne: 'मेरो उपस्थिति', en: 'My attendance' })}</h3>
          <p className="text-[13px] text-[#6E7C8E] mt-1">
            {t({
              ne: 'सत्र सकिँदा हलमा हुनुभएको भए उपस्थिति आफैँ दर्ता हुन्छ।',
              en: 'If you are in the room when a session ends, your attendance is recorded for you.',
            })}
          </p>
          <div className="mt-3">
            {done.length === 0 ? (
              <p className="text-[12.5px] text-[#6E7C8E]">
                {t({ ne: 'अझै कुनै सत्र सकिएको छैन।', en: 'No session has finished yet.' })}
              </p>
            ) : (
              <>
                {done.slice(0, 5).map((d) => {
                  const was = attendedIds.has(d.session.id);
                  return (
                    <div key={d.session.id} className="flex gap-2.5 items-center py-1.5">
                      <span
                        className={`w-[18px] h-[18px] rounded-[5px] grid place-items-center text-[11px] flex-none ${
                          was ? 'bg-ok/[.12] text-ok' : 'bg-cream-200 text-[#6E7C8E]'
                        }`}
                      >
                        {was ? '✓' : '—'}
                      </span>
                      <span className="text-[13.5px] truncate">{d.session.title}</span>
                    </div>
                  );
                })}
                <div className="mt-2.5 pt-2.5 border-t border-navy-800/[.08]">
                  <div className="h-1.5 rounded-md bg-cream-200 overflow-hidden">
                    <i
                      className={`block h-full rounded-md ${
                        attendedCount / Math.max(1, done.length) >= 0.75 ? 'bg-ok' : 'bg-amber'
                      }`}
                      style={{ width: `${Math.round((attendedCount / Math.max(1, done.length)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[13px] text-[#6E7C8E] mt-2">
                    {t({
                      ne: `सकिएका ${num(done.length)} मध्ये ${num(attendedCount)} मा उपस्थित।`,
                      en: `Present at ${attendedCount} of the ${done.length} that have finished.`,
                    })}
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>

        <div className="bg-navy-900 text-white rounded-[14px] p-4">
          <h3 className="text-[15.5px] font-semibold">{t({ ne: 'तपाईंको डाटा तपाईंकै', en: 'Your data is yours' })}</h3>
          <p className="text-[13px] text-[#A9C0E2] mt-1">
            {t({
              ne: 'हलको यन्त्रले बोलेको कुरा पाठमा पठाउँछ। कुनै अडियो वा भिडियो राखिँदैन।',
              en: 'The hall device sends speech as text. No audio or video is kept.',
            })}
          </p>
        </div>
      </aside>
    </div>
  );
};
