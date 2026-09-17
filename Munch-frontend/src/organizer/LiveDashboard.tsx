import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../services/api';
import { Artifact, Conclusion, Event, Session, TranscriptionSegment } from '../types';
import { Pair, useOrganizer } from './i18n';
import { FigmaIcon } from '../assets/icons';
import { RoomQuestions } from './RoomQuestions';
import { PhotoAlbums } from './Photos';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "10:12-10:25", the way every time chip on this screen is written. */
const span = (from: string, minutes?: number | null) => {
  const start = new Date(from);
  const end = new Date(+start + (minutes ?? 0) * 60000);
  return `${clock(start.toISOString())}-${clock(end.toISOString())}`;
};

/** The white card everything on this screen is drawn on. */
const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '', children,
}) => (
  <div className={`bg-white border border-[#e3e8ef] rounded-[12px] overflow-hidden ${className}`}>
    {children}
  </div>
);

/** A card's head: a centred title, and whatever sits to the right of it. */
const CardHead: React.FC<{
  children: React.ReactNode;
  right?: React.ReactNode;
  size?: number;
}> = ({ children, right, size = 24 }) => (
  <div className="bg-white border-b border-[#e3e8ef] flex items-center justify-between
    gap-2 px-4 py-2.5">
    <h2
      className="flex-1 min-w-0 font-medium text-black text-center leading-[1.2]"
      style={{ fontSize: size }}
    >
      {children}
    </h2>
    {right}
  </div>
);

/** The pale chip a time is written in. */
const TimeChip: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({
  children, dark,
}) => (
  <span
    className={`h-6 px-1 rounded-[4px] grid place-items-center text-[12px] leading-none
      flex-none ${dark ? 'bg-white text-navy-900' : 'bg-[#f6f8fb] border border-[#e3e8ef] text-[#4a5567]'}`}
  >
    {children}
  </span>
);

/**
 * A round portrait the way the design draws one.
 *
 * The mock uses a stock photograph; nobody here has one, so the initial
 * stands in on the same warm disc rather than a grey box where a face
 * should be.
 */
const Portrait: React.FC<{ name: string; size: number }> = ({ name, size }) => (
  <span
    className="bg-[#fbecd1] rounded-full grid place-items-center flex-none
      text-navy-900 font-semibold overflow-hidden"
    style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    aria-hidden
  >
    {(name || '?').trim().charAt(0).toUpperCase()}
  </span>
);

/** The thin upright rule the design puts between two facts. */
const Rule: React.FC = () => (
  <span aria-hidden className="w-px h-3 bg-[#e3e8ef] flex-none" />
);

type PanelTab = 'slides' | 'questions' | 'photos';

interface Props {
  /** The room this desk is driving. */
  event: Event;
  sessions: Session[];
  /** The session on stage, if one is. */
  live: Session | null;
  /** The controls that belong on the stage card: start it, end it. */
  stageActions?: React.ReactNode;
  /** The two queues, and the chat switches, down the right-hand side. */
  queues?: React.ReactNode;
  onBackToRoom: () => void;
}

/**
 * The host's live dashboard.
 *
 * What is on stage across the top, what is being said beside it, what the
 * day has come to underneath, and the two queues waiting on the host down
 * the right. It is the host's own screen rather than the attendee's with
 * things bolted on: the two are laid out differently, and a shared
 * component pulled in both directions would serve neither.
 */
export const LiveDashboard: React.FC<Props> = ({
  event, sessions, live, stageActions, queues, onBackToRoom,
}) => {
  const { t, num } = useOrganizer();

  const [tab, setTab] = useState<PanelTab>('photos');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [slides, setSlides] = useState<Artifact[]>([]);
  const [conclusions, setConclusions] = useState<Conclusion[]>([]);
  const [opened, setOpened] = useState<string>('');

  const agenda = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const onStage = live ?? agenda.find((s) => s.status === 'live') ?? agenda[0] ?? null;
  const selected = agenda.find((s) => s.id === opened) ?? onStage;

  /** The transcript of whatever the day has reached. */
  useEffect(() => {
    if (!event.code) { setSegments([]); return; }
    let gone = false;
    const read = () => {
      apiClient
        .getEventSegments(event.code)
        .then((lines) => { if (!gone) setSegments(lines); })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, 20000);
    return () => { gone = true; window.clearInterval(timer); };
  }, [event.code]);

  useEffect(() => {
    apiClient.getResources(event.id).then(setSlides).catch(() => setSlides([]));
  }, [event.id]);

  const loadConclusions = useCallback(() => {
    apiClient
      .getConclusions()
      .then((page) => setConclusions(page?.conclusions ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => { loadConclusions(); }, [loadConclusions]);

  const summaryOf = (sessionId?: string) =>
    conclusions.find((c) => c.session_id === sessionId) ?? null;

  const summary = summaryOf(selected?.id);

  const TABS: { id: PanelTab; label: Pair }[] = [
    { id: 'slides', label: { ne: 'स्लाइड', en: 'Slides' } },
    { id: 'questions', label: { ne: 'प्रश्न', en: 'Questions' } },
    { id: 'photos', label: { ne: 'तस्बिर', en: 'Photos' } },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Heading, and the way back into the room itself. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium text-[#030712] leading-[1.2]">
            {t({ ne: 'लाइभ ड्यासबोर्ड', en: 'Live Dashboard' })}
          </h1>
          <p className="text-[14px] text-[#4a5567] leading-[1.5] mt-2">
            {t({
              ne: 'चलिरहेको कार्यक्रम यहीँबाट हेर्नुहोस्।',
              en: 'Watch the event as it runs.',
            })}
          </p>
        </div>
        <button
          onClick={onBackToRoom}
          className="border border-[#e7e9ef] rounded-[8px] px-3 py-2 flex items-center gap-1.5
            text-[14px] font-medium text-white leading-[1.5] flex-none"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgb(247,140,93) 7.29%, rgba(247,140,93,0.05) 65.63%),'
              + ' linear-gradient(90deg, rgb(245,108,65) 0%, rgb(245,108,65) 100%)',
          }}
        >
          <FigmaIcon name="layoutGrid" size={14} />
          {t({ ne: 'लाइभ कोठामा फर्कनुहोस्', en: 'Back to Live Room' })}
        </button>
      </div>

      <div className="grid gap-3 items-start xl:grid-cols-[minmax(0,699fr)_385px]">
        {/* The left column: the stage, the panels, the day. */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card>
            <CardHead
              right={
                <span className="flex items-center gap-2 flex-none">
                  {live && (
                    <span className="bg-[#fce2ef] text-[#f83995] h-6 px-2 rounded-[4px]
                      grid place-items-center text-[12px] tracking-[-0.06px]">
                      {t({ ne: 'लाइभ', en: 'Live' })}
                    </span>
                  )}
                  {stageActions}
                </span>
              }
            >
              {event.title}
            </CardHead>

            <div className="flex flex-col gap-3 justify-center px-4 py-2.5">
              <div className="flex gap-2 items-center">
                <Portrait name={onStage?.speaker_name || onStage?.title || event.title} size={84} />
                <div className="flex flex-col items-start justify-center min-w-0">
                  <p className="text-[22px] font-medium text-black leading-[1.2]">
                    {onStage?.title ?? t({ ne: 'कुनै सत्र छैन', en: 'Nothing on stage' })}
                  </p>
                  {onStage?.speaker_name && (
                    <p className="text-[18px] text-[#030712] leading-[1.5]">
                      {onStage.speaker_name}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 items-center flex-wrap">
                {onStage?.hall && (
                  <span className="border border-[#e3e8ef] h-6 px-2 rounded-[4px] flex items-center
                    gap-1.5 text-[14px] text-[#030712] tracking-[-0.07px]">
                    <span className="bg-[#13cef7] rounded-full w-[5px] h-[5px]" aria-hidden />
                    {onStage.hall}
                  </span>
                )}
                {onStage?.hall && onStage.starts_at && <Rule />}
                {onStage?.starts_at && (
                  <span className="text-[14px] text-[#4a5567] leading-[1.4] tracking-[-0.07px]">
                    {span(onStage.starts_at, onStage.duration_minutes)}
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Slides, questions, photos - the three things a room carries. */}
          <Card>
            <div className="flex border-b border-[#e3e8ef]" role="tablist">
              {TABS.map((one) => (
                <button
                  key={one.id}
                  role="tab"
                  aria-selected={tab === one.id}
                  onClick={() => setTab(one.id)}
                  className={`w-[125px] h-[47px] text-[14px] -mb-px border-b-2 ${
                    tab === one.id
                      ? 'border-black text-black font-medium'
                      : 'border-transparent text-[#4a5567]'
                  }`}
                >
                  {t(one.label)}
                </button>
              ))}
            </div>
            <div className="min-h-[156px]">
              {tab === 'slides' && (
                slides.length === 0 ? (
                  <p className="text-[12.5px] text-subtle px-4 py-5">
                    {t({ ne: 'कुनै फाइल छैन।', en: 'Nothing shared yet.' })}
                  </p>
                ) : (
                  <ul className="px-4 py-3 flex flex-col gap-2">
                    {slides.map((one) => (
                      <li key={one.id} className="text-[14px] text-[#030712] truncate">
                        {one.display_name}
                      </li>
                    ))}
                  </ul>
                )
              )}
              {tab === 'questions' && (
                <RoomQuestions eventId={event.id} canSort />
              )}
              {tab === 'photos' && <PhotoAlbums eventRef={event.code} />}
            </div>
          </Card>

          {/* The day, and what each part of it came to. */}
          <Card>
            <CardHead>{t({ ne: 'एजेन्डा सारांश', en: 'Agenda Summary' })}</CardHead>
            <div className="grid md:grid-cols-[268px_minmax(0,1fr)] items-stretch">
              <div className="max-h-[363px] overflow-y-auto ps-3">
                {agenda.length === 0 ? (
                  <p className="text-[12.5px] text-subtle px-4 py-5">
                    {t({ ne: 'कुनै सत्र छैन।', en: 'Nothing scheduled.' })}
                  </p>
                ) : (
                  agenda.map((one) => {
                    const chosen = one.id === selected?.id;
                    return (
                      <button
                        key={one.id}
                        onClick={() => setOpened(chosen ? '' : one.id)}
                        aria-current={chosen}
                        className={`w-full text-left flex items-center gap-2 p-1 border-b
                          border-[#e3e8ef] last:border-0 ${
                            chosen ? 'bg-navy-800 text-white' : 'hover:bg-[#fcfcfc]'
                          }`}
                      >
                        <Portrait name={one.speaker_name || one.title} size={chosen ? 40 : 48} />
                        <span className="min-w-0 flex-1 px-1">
                          <span className="block text-[13px] font-medium leading-[1.3] truncate">
                            {one.title}
                          </span>
                          <span className={`block text-[12px] truncate ${
                            chosen ? 'text-white/70' : 'text-[#4a5567]'
                          }`}>
                            {one.speaker_name || t({ ne: 'वक्ता छैन', en: 'No speaker' })}
                          </span>
                        </span>
                        {chosen && (
                          <FigmaIcon name="arrowRight" size={24} className="flex-none" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="bg-navy-800 text-white p-4 min-h-[363px]">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[20px] font-medium leading-[1.2] text-center">
                      {t({ ne: 'सारांश', en: 'Summary' })}
                    </p>
                    <p className="text-[14px] text-white/80 mt-1.5">
                      {selected?.speaker_name ?? ''}
                    </p>
                  </div>
                  {selected?.starts_at && (
                    <TimeChip dark>{span(selected.starts_at, selected.duration_minutes)}</TimeChip>
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-3 text-[14px] leading-[1.5]">
                  {summary ? (
                    summary.findings.map((line, i) => <p key={i}>{line}</p>)
                  ) : (
                    <p className="text-white/70">
                      {t({
                        ne: 'यो सत्र सकिएपछि सारांश यहाँ देखिन्छ।',
                        en: 'The summary appears here once this session has finished.',
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* The right column: what is being said, and who is waiting. */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card>
            <CardHead>{t({ ne: 'लाइभ ट्रान्सक्रिप्ट', en: 'Live Transcript' })}</CardHead>
            <div className="max-h-[383px] overflow-y-auto px-3 py-2.5 flex flex-col gap-3">
              {segments.length === 0 ? (
                <p className="text-[12.5px] text-subtle py-2">
                  {t({ ne: 'अझै केही भनिएको छैन।', en: 'Nothing said yet.' })}
                </p>
              ) : (
                segments.map((line, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <TimeChip>
                      {line.created_at ? clock(line.created_at) : num(i + 1)}
                    </TimeChip>
                    <Rule />
                    <p className="text-[14px] text-[#030712] leading-[1.5] min-w-0 flex-1">
                      {line.text}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>

          {queues}
        </div>
      </div>
    </div>
  );
};
