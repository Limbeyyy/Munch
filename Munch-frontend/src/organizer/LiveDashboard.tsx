import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../services/api';
import { Event, Session, TranscriptionSegment } from '../types';
import { Pair, useOrganizer } from './i18n';
import { useElapsed } from '../services/elapsed';
import { FigmaIcon } from '../assets/icons';
import { PendingQuestions, PhotoFolderStrip, SlideGroups } from './livePanels';
import { RoomAgenda } from './RoomAgenda';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

/**
 * A round portrait the way the design draws one.
 *
 * The mock uses a stock photograph; nobody here has one, so the initial
 * stands in on the same warm disc rather than a grey box where a face
 * should be.
 */
const Portrait: React.FC<{
  name: string;
  size: number;
  /** Their photograph, where a speaker profile has one. */
  src?: string | null;
}> = ({ name, size, src }) => (
  <span
    className="bg-[#fbecd1] rounded-full grid place-items-center flex-none
      text-navy-900 font-semibold overflow-hidden"
    style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    aria-hidden
  >
    {src
      ? <img src={src} alt="" className="w-full h-full object-cover" />
      : (name || '?').trim().charAt(0).toUpperCase()}
  </span>
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
  /** Re-read the day after the running order has been rearranged. */
  onChanged: () => Promise<void> | void;
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
  event, sessions, live, stageActions, queues, onChanged, onBackToRoom,
}) => {
  const { t, num } = useOrganizer();

  const [tab, setTab] = useState<PanelTab>('photos');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);

  const agenda = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const onStage = live ?? agenda.find((s) => s.status === 'live') ?? agenda[0] ?? null;

  /**
   * The clock runs only while a talk actually is.
   *
   * The card falls back to the first item on the running order when
   * nothing is on stage, so there is something to look at between
   * talks - but that item has already been given, and its start time
   * is hours old. Counting from it turned the gap between two talks
   * into a two-hour countdown. In the gap the light says Live, which
   * is true of the event, and nothing says how long, which is the
   * honest answer about a talk that has not started.
   */
  const actuallyOn = live ?? agenda.find((s) => s.status === 'live') ?? null;
  const running = useElapsed(
    actuallyOn?.status === 'live' ? actuallyOn.started_at : null
  );

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

  const TABS: { id: PanelTab; label: Pair }[] = [
    { id: 'slides', label: { ne: 'स्लाइड', en: 'Slides' } },
    { id: 'questions', label: { ne: 'प्रश्न', en: 'Questions' } },
    { id: 'photos', label: { ne: 'तस्बिर', en: 'Photos' } },
  ];

  return (
    // Everything the desk shows sits on one sheet of white, the way the
    // design draws it: the heading, the stage, the panels and the queues
    // are one thing to look at rather than cards adrift on the page.
    <div className="bg-white border border-[#e7e9ef] rounded-[12px] p-4 sm:p-5
      flex flex-col gap-3">
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
        {/* Navy, like every other way into somewhere in this product.
            The orange read as a warning on a screen where the warnings
            are red. */}
        <button
          onClick={onBackToRoom}
          className="bg-navy-800 hover:bg-navy-900 border border-navy-800 rounded-[8px]
            px-3 py-2 flex items-center gap-1.5 text-[14px] font-medium text-white
            leading-[1.5] flex-none"
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
                    <span className="bg-live text-white h-6 px-2 rounded-[4px]
                      grid place-items-center text-[12px] tracking-[-0.06px]">
                      {t({ ne: 'लाइभ', en: 'Live' })}
                    </span>
                  )}
                  {/* How long it has been running, beside the light that
                      says it is. A start and an end time said when the
                      talk was meant to happen, which the running order
                      already says and nobody watching a live room asks. */}
                  {running && (
                    <span className="text-[13px] text-[#4a5567] leading-[1.4]
                      tabular-nums">
                      {running}
                    </span>
                  )}
                </span>
              }
            >
              {event.title}
            </CardHead>

            <div className="px-4 py-2.5 flex gap-3 items-start justify-between">
              <div className="flex gap-2 items-center min-w-0">
                <Portrait
                  name={onStage?.speaker_name || onStage?.title || event.title}
                  src={onStage?.speaker_photo_url}
                  size={84}
                />
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

              {/* Ending the session belongs beside the session, not up
                  beside the event's own name. */}
              {stageActions && (
                <span className="flex items-center gap-2 flex-none">
                  {stageActions}
                </span>
              )}
            </div>

            {/* Slides, questions, photos - the three things a room
                carries. On the same sheet as the talk they belong to
                rather than adrift underneath it. */}
            <div className="bg-[#fcfcfc] h-12 flex items-stretch
              border-y border-[#e3e8ef]" role="tablist">
              {TABS.map((one) => (
                <button
                  key={one.id}
                  role="tab"
                  aria-selected={tab === one.id}
                  onClick={() => setTab(one.id)}
                  className={`w-[125px] text-[14px] -mb-px border-b-[3px] ${
                    tab === one.id
                      ? 'border-black text-black font-semibold'
                      : 'border-transparent text-[#49454f]'
                  }`}
                >
                  {t(one.label)}
                </button>
              ))}
            </div>

            <div className="min-h-[156px]">
              {/* Each panel carries its own way of adding to it: a file
                  belongs to a talk, a folder to the album, and a
                  question arrives from the room rather than from here.
                  One button at the top could only ever mean one of the
                  three. */}
              {tab === 'slides' && (
                <SlideGroups
                  eventId={event.id}
                  sessions={sessions}
                  live={onStage}
                />
              )}
              {tab === 'questions' && (
                <PendingQuestions eventId={event.id} sessions={sessions} />
              )}
              {tab === 'photos' && <PhotoFolderStrip eventRef={event.code} />}
            </div>
          </Card>

          {/* The day, and what each part of it came to.

              The same running order the room shows, rather than a second
              drawing of it: a host rearranging the day here and looking
              at the room on the next screen should be looking at one
              thing, and two components meant the two drifted. */}
          <Card>
            <RoomAgenda
              event={event}
              sessions={sessions}
              liveSessionId={live?.id ?? null}
              canEdit
              onChanged={onChanged}
            />
          </Card>
        </div>

        {/* The right column: what is being said, and who is waiting. */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card>
            <CardHead>{t({ ne: 'लाइभ ट्रान्सक्रिप्ट', en: 'Live Transcript' })}</CardHead>

            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <span className="text-[12px] font-semibold leading-4 uppercase
                tracking-[1.2px] text-[#99a1af]">
                {t({ ne: 'प्रत्यक्ष ट्रान्सक्रिप्ट', en: 'Live transcript' })}
              </span>
              <span className="flex items-center gap-1 text-[12px] leading-4
                text-[#00a63e]">
                <span className="bg-[#00c950] opacity-[.64] rounded-full size-1.5"
                  aria-hidden />
                {t({ ne: 'चालु', en: 'Active' })}
              </span>
            </div>

            <div className="max-h-[383px] overflow-y-auto px-4 pb-3 flex flex-col">
              {segments.length === 0 ? (
                <p className="text-[12.5px] text-subtle py-2">
                  {t({ ne: 'अझै केही भनिएको छैन।', en: 'Nothing said yet.' })}
                </p>
              ) : (
                /* When, who, then what they said - each on its own line.
                   It used to be the time in a chip down the left with
                   the words beside it and no name at all, which read as
                   a log rather than as a conversation. */
                segments.map((line, i) => (
                  <div key={i} className="pt-3" data-transcript-line>
                    {/* Smaller than both the name and the words: it is
                        the least of the three things on the line. */}
                    <p className="text-[11px] leading-4 text-[#99a1af] tabular-nums">
                      {line.created_at ? clock(line.created_at) : num(i + 1)}
                    </p>
                    {line.speaker_name && (
                      <p className="pt-1 text-[14px] font-semibold leading-5
                        text-[#101828]">
                        {line.speaker_name}
                      </p>
                    )}
                    <p className="pt-1 text-[14px] leading-[22.75px] text-[#364153]">
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
