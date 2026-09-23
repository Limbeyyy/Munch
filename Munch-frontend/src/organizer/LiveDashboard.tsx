import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../services/api';
import { Artifact, Event, Session, TranscriptionSegment } from '../types';
import { Pair, useOrganizer } from './i18n';
import { FigmaIcon } from '../assets/icons';
import { RoomQuestions } from './RoomQuestions';
import { PhotoAlbums } from './Photos';
import toast from 'react-hot-toast';
import { RoomAgenda } from './RoomAgenda';
import { errorText } from './errors';
import {
  KindChip, dayOf, formatSize, kindOf,
} from './filesAndSummaries/shared';

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
  /** Re-read the day after the running order has been rearranged. */
  onChanged: () => Promise<void> | void;
  /** Put one on stage from the running order itself. */
  onStart: (sessionId: string) => Promise<void> | void;
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
  event, sessions, live, stageActions, queues, onChanged, onStart, onBackToRoom,
}) => {
  const { t, num } = useOrganizer();

  const [tab, setTab] = useState<PanelTab>('photos');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [slides, setSlides] = useState<Artifact[]>([]);
  /** A share or a removal in flight, so the row cannot be pressed twice. */
  const [sharing, setSharing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const agenda = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const onStage = live ?? agenda.find((s) => s.status === 'live') ?? agenda[0] ?? null;

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

  const loadSlides = useCallback(() => {
    apiClient.getResources(event.id).then(setSlides).catch(() => setSlides([]));
  }, [event.id]);

  useEffect(() => { loadSlides(); }, [loadSlides]);

  /**
   * Share something with the room, from the room.
   *
   * Filed against whatever is on stage, which is what the server does
   * with a file that names no session - the same rule the agenda form
   * follows when a talk is running.
   */
  const share = async (files: File[]) => {
    setSharing(true);
    let done = 0;
    for (const file of files) {
      try {
        await apiClient.uploadResource(event.id, file);
        done += 1;
      } catch (e: any) {
        toast.error(errorText(e, t({ ne: 'अपलोड भएन', en: 'Upload failed' })));
      }
    }
    if (done > 0) {
      toast.success(t({
        ne: `${num(done)} फाइल थपियो`,
        en: done === 1 ? 'File added' : `${done} files added`,
      }));
    }
    setSharing(false);
    loadSlides();
  };

  const drop = async (one: Artifact) => {
    setSharing(true);
    try {
      await apiClient.deleteResource(event.id, one.id);
      toast.success(t({ ne: 'फाइल हटाइयो', en: 'File removed' }));
      loadSlides();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' })));
    } finally {
      setSharing(false);
    }
  };

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

              <div className="flex gap-3 items-center flex-wrap">
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
            <div className="flex items-center border-b border-[#e3e8ef]">
              <div className="flex" role="tablist">
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

              {/* Only on the slides. Questions arrive from the room and
                  photographs have their own way in, so a button here that
                  did nothing on two tabs out of three would be a puzzle. */}
              {tab === 'slides' && (
                <>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    aria-label={t({ ne: 'फाइल छान्नुहोस्', en: 'Choose files' })}
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length > 0) share(files);
                    }}
                  />
                  <button
                    type="button"
                    disabled={sharing}
                    onClick={() => picker.current?.click()}
                    className="ml-auto mr-4 border-[0.6px] border-navy-600 rounded-[8px]
                      px-3 py-1.5 text-[12px] text-navy-600 leading-4
                      hover:bg-navy-600/[.06] disabled:opacity-50"
                  >
                    {sharing
                      ? t({ ne: 'पठाउँदै…', en: 'Uploading…' })
                      : t({ ne: '+ थप्नुहोस्', en: '+ Add' })}
                  </button>
                </>
              )}
            </div>
            <div className="min-h-[156px]">
              {tab === 'slides' && (
                slides.length === 0 ? (
                  <p className="text-[12.5px] text-subtle px-4 py-5">
                    {t({ ne: 'कुनै फाइल छैन।', en: 'Nothing shared yet.' })}
                  </p>
                ) : (
                  /* A row per file, the way every other list of files in
                     the product reads it: what kind it is, how big, who
                     shared it and when. A bare filename said none of that
                     and could not be taken off again. */
                  <div className="flex flex-col">
                    {slides.map((one, i) => (
                      <div
                        key={one.id}
                        className={`px-5 py-3 flex gap-4 items-center ${
                          i < slides.length - 1
                            ? 'border-b-[0.6px] border-[#f9fafb]' : ''
                        }`}
                      >
                        <KindChip kind={kindOf(one.display_name ?? '')} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-head leading-5
                            truncate">
                            {one.display_name}
                          </p>
                          <p className="text-[12px] text-faint leading-4 truncate">
                            {[
                              formatSize(one.file_size),
                              one.uploaded_by_name,
                              dayOf(one.created_at, t),
                            ].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={sharing}
                          onClick={() => drop(one)}
                          aria-label={t({
                            ne: `${one.display_name} हटाउनुहोस्`,
                            en: `Remove ${one.display_name}`,
                          })}
                          className="size-11 grid place-items-center rounded-[12px]
                            text-[#d81313] hover:bg-[#d81313]/[.06]
                            disabled:opacity-50"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                            aria-hidden>
                            <path
                              d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"
                              stroke="currentColor" strokeWidth="1.8"
                              strokeLinecap="round" strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
              {tab === 'questions' && (
                <RoomQuestions eventId={event.id} canSort />
              )}
              {/* The albums draw their own filters and folders flush to
                  the edge, which is right in a panel of their own and too
                  close to the rule here. */}
              {tab === 'photos' && (
                <div className="px-4 py-3">
                  <PhotoAlbums eventRef={event.code} />
                </div>
              )}
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
              onStart={onStart}
            />
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
                    {/* Marked, so the size and spacing the reader chose on
                        the appearance page reach it. */}
                    <p
                      data-transcript-line
                      className="text-[14px] text-[#030712] leading-[1.5] min-w-0 flex-1"
                    >
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
