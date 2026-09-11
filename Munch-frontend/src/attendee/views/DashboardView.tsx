import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import {
  Artifact, Conclusion, EventMeeting, EventProgramme, TranscriptionSegment,
} from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { Empty } from '../../organizer/ui';
import { MessageBoard } from '../../organizer/MessageBoard';
import { PhotoAlbums } from '../../organizer/Photos';
import { FigmaIcon } from '../../assets/icons';
import { deskSession, doorway } from '../../organizer/sessionState';
import { SpineItem, clock } from '../Spine';

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

/** The white card every panel on this screen is drawn on. */
const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <div
    className={`bg-white border border-[#e3e8ef] rounded-[12px] overflow-hidden ${className}`}
  >
    {children}
  </div>
);

/** A card's centred title bar. */
const CardTitle: React.FC<{
  children: React.ReactNode;
  size?: number;
  right?: React.ReactNode;
}> = ({ children, size = 20, right }) => (
  <div className="bg-white border-b border-[#e3e8ef] flex items-center gap-2 px-4 py-2.5">
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

const timeRange = (from: string, minutes: number) => {
  const start = new Date(from);
  const end = new Date(+start + minutes * 60000);
  return `${clock(start.toISOString())}-${clock(end.toISOString())}`;
};

type PanelTab = 'slides' | 'questions' | 'photos';

/**
 * What is happening now, as the live dashboard draws it.
 *
 * The shape is the Figma's: the session on stage across the top left, the
 * transcript running beside it, and the day's agenda underneath with
 * whichever session is selected opened out. What fills those shapes is
 * what the platform already knows - the running order, the published
 * conclusions, the transcript lines - rather than anything new invented
 * to match a picture.
 */
export const DashboardView: React.FC<Props> = ({
  items, live, onOpen, onJoinRoom,
}) => {
  const { t, num } = useOrganizer();

  /** The session the day has reached: on stage, else the one due next. */
  const onDesk = useMemo(
    () => deskSession(items.map((i) => i.session), Date.now()).session,
    [items]
  );
  const current =
    live ?? items.find((i) => i.session.id === onDesk?.id) ?? items[0] ?? null;
  const door = doorway(current?.session.starts_at, Date.now());

  const [tab, setTab] = useState<PanelTab>('questions');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [slides, setSlides] = useState<Artifact[]>([]);
  const [conclusions, setConclusions] = useState<Conclusion[]>([]);
  const [opened, setOpened] = useState<string>('');

  const meetingId = current?.meeting.id ?? '';
  const meetingCode = current?.meeting.meeting_code ?? '';

  /** The transcript of whatever the day has reached. */
  useEffect(() => {
    if (!meetingCode) { setSegments([]); return; }
    let gone = false;
    const read = () => {
      apiClient
        .getMeetingSegments(meetingCode)
        .then((lines) => { if (!gone) setSegments(lines); })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, 20000);
    return () => { gone = true; window.clearInterval(timer); };
  }, [meetingCode]);

  useEffect(() => {
    if (!meetingId) { setSlides([]); return; }
    apiClient.getResources(meetingId).then(setSlides).catch(() => setSlides([]));
  }, [meetingId]);

  /** What each session came to, for the agenda underneath. */
  const loadConclusions = useCallback(() => {
    apiClient
      .getConclusions()
      .then((page) => setConclusions(page.conclusions))
      .catch(() => undefined);
  }, []);

  useEffect(() => { loadConclusions(); }, [loadConclusions]);

  const agenda = useMemo(
    () =>
      [...items].sort(
        (a, b) => +new Date(a.session.starts_at) - +new Date(b.session.starts_at)
      ),
    [items]
  );

  const selected =
    agenda.find((i) => i.session.id === opened) ??
    agenda.find((i) => i.session.id === current?.session.id) ??
    agenda[0] ??
    null;

  const summaryOf = (sessionId?: string) =>
    conclusions.find((c) => c.session_id === sessionId) ?? null;

  const summary = summaryOf(selected?.session.id);

  return (
    <>
      {/* Title, and the way back into the room */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium text-[#030712] leading-[1.2]">
            {t({ ne: 'लाइभ ड्यासबोर्ड', en: 'Live Dashboard' })}
          </h1>
          <p className="text-[14px] text-[#4a5567] leading-[1.5]">
            {t({
              ne: 'अहिले के भइरहेको छ, र दिनले कहाँसम्म पुग्यो।',
              en: 'What is happening now, and how far the day has come.',
            })}
          </p>
        </div>
        <button
          onClick={() => current && onJoinRoom(current.meeting)}
          disabled={!current || !door.canEnter}
          title={
            current && !door.canEnter
              ? t({
                  ne: 'सत्र सुरु हुनु १५ मिनेट अघि कोठा खुल्छ',
                  en: 'The room opens a quarter of an hour before the session',
                })
              : undefined
          }
          className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-3 py-2
            flex items-center gap-1.5 text-[14px] font-medium leading-[1.5]
            disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <FigmaIcon name="layoutGrid" size={14} />
          {t({ ne: 'कोठामा फर्कनुहोस्', en: 'Back to Live Room' })}
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_385px] items-start">
        <div className="flex flex-col gap-3 min-w-0">
          {/* What is on stage */}
          <Card>
            <CardTitle
              size={24}
              right={
                live ? (
                  <span className="bg-[#fce2ef] text-[#f83995] text-[12px] tracking-[-0.06px]
                    rounded-[4px] h-6 px-2 grid place-items-center flex-none">
                    {t({ ne: 'लाइभ', en: 'Live' })}
                  </span>
                ) : null
              }
            >
              {current?.meeting.title ?? t({ ne: 'कुनै बैठक छैन', en: 'No meeting' })}
            </CardTitle>

            {current ? (
              <div className="flex flex-col gap-3 px-4 py-2.5">
                <div className="flex gap-2 items-center">
                  <Portrait name={current.session.speaker_name} size={84} />
                  <div className="min-w-0">
                    <p className="text-[22px] font-medium text-black leading-[1.2]">
                      {current.session.title}
                    </p>
                    <p className="text-[18px] text-[#030712] leading-[1.5]">
                      {current.session.speaker_name ||
                        t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-center flex-wrap">
                  <span className="border border-[#e3e8ef] rounded-[4px] h-6 px-2
                    flex items-center gap-1.5">
                    <i className="w-[5px] h-[5px] rounded-full bg-[#13cef7]" aria-hidden />
                    <span className="text-[14px] text-[#030712] tracking-[-0.07px]">
                      {current.session.hall ||
                        t({ ne: 'हल तोकिएको छैन', en: 'No hall named' })}
                    </span>
                  </span>
                  <Rule />
                  <span className="text-[14px] text-[#030712] tracking-[-0.07px]">
                    {timeRange(current.session.starts_at, current.session.duration_minutes)}
                  </span>
                </div>
              </div>
            ) : (
              <Empty>
                {t({
                  ne: 'तपाईंको कुनै कार्यक्रम छैन।',
                  en: 'You are not on any programme yet.',
                })}
              </Empty>
            )}
          </Card>

          {/* Slides, questions and photographs of whatever is on stage */}
          <Card>
            <div className="bg-[#fcfcfc] border-b border-[#e3e8ef] flex">
              {(
                [
                  ['slides', { ne: 'स्लाइड', en: 'Slides' }],
                  ['questions', { ne: 'प्रश्न', en: 'Questions' }],
                  ['photos', { ne: 'फोटो', en: 'Photos' }],
                ] as [PanelTab, { ne: string; en: string }][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`flex-1 h-12 text-[14px] transition-colors ${
                    tab === id
                      ? 'text-black font-medium border-b-2 border-black'
                      : 'text-[#49454f] hover:text-black'
                  }`}
                >
                  {t(label)}
                </button>
              ))}
            </div>

            <div className="p-4 min-h-[156px]">
              {!current ? (
                <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No session yet.' })}</Empty>
              ) : tab === 'photos' ? (
                <PhotoAlbums meetingRef={meetingCode} canManage={false} />
              ) : tab === 'questions' ? (
                <MessageBoard meetingId={meetingId} refreshMs={30000} />
              ) : slides.length === 0 ? (
                <Empty>
                  {t({
                    ne: 'यो बैठकमा अझै कुनै फाइल राखिएको छैन।',
                    en: 'Nothing has been shared for this meeting yet.',
                  })}
                </Empty>
              ) : (
                <ul className="flex flex-col">
                  {slides.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-3 py-2.5 border-b border-[#e3e8ef]
                        last:border-0"
                    >
                      <FigmaIcon name="folder" size={24} />
                      <span className="text-[14px] text-[#383838] tracking-[-0.07px] truncate">
                        {file.display_name}
                      </span>
                      {file.web_view_link && (
                        <a
                          href={file.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                          className="ms-auto text-[13px] text-navy-700 underline flex-none"
                        >
                          {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* What is being said */}
        <Card className="xl:sticky xl:top-4">
          <CardTitle>{t({ ne: 'लाइभ ट्रान्सक्रिप्ट', en: 'Live Transcript' })}</CardTitle>
          <div className="flex flex-col gap-3 px-3 py-2.5 max-h-[420px] overflow-y-auto">
            {segments.length === 0 ? (
              <Empty>
                {t({
                  ne: 'हलको यन्त्रले बोली पठाउन थालेपछि यहाँ देखिन्छ।',
                  en: 'Lines appear here once the hall device starts sending them.',
                })}
              </Empty>
            ) : (
              segments.map((line, i) => (
                <div key={`${line.start_time}-${i}`} className="flex gap-3 items-start">
                  <span className="border border-[#e3e8ef] rounded-[4px] h-6 px-1
                    grid place-items-center flex-none text-[12px] text-[#656565]
                    tracking-[-0.06px] tabular-nums">
                    {line.created_at ? clock(line.created_at) : num(Math.round(line.start_time))}
                  </span>
                  <Rule />
                  <p className="flex-1 min-w-0 text-[14px] leading-[1.4] tracking-[-0.07px]
                    text-[#383838]">
                    {line.speaker_name && (
                      <span className="text-[#4a5567]">{line.speaker_name}: </span>
                    )}
                    {line.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* The day, and what each part of it came to */}
      <Card className="mt-3">
        <div className="bg-[#fcfcfc] h-12 grid place-items-center">
          <h2 className="text-[20px] font-medium text-black leading-[1.2]">
            {t({ ne: 'एजेन्डा सारांश', en: 'Agenda Summary' })}
          </h2>
        </div>

        <div className="grid md:grid-cols-[339px_minmax(0,1fr)] items-stretch">
          <div className="max-h-[363px] overflow-y-auto border-b md:border-b-0 md:border-e
            border-[#b3b3b3]/40">
            {agenda.length === 0 ? (
              <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'Nothing scheduled.' })}</Empty>
            ) : (
              agenda.map((item) => {
                const chosen = item.session.id === selected?.session.id;
                return (
                  <button
                    key={item.session.id}
                    type="button"
                    aria-current={chosen}
                    onClick={() => setOpened(item.session.id)}
                    onDoubleClick={() => onOpen(item)}
                    className={`w-full text-start flex items-center justify-between gap-2
                      px-1 py-2 border-b-[0.5px] border-[#b3b3b3] last:border-0
                      ${chosen ? 'bg-[#007092] text-white' : 'bg-[#fcfcfc] hover:bg-cream'}`}
                  >
                    <span className="flex gap-2 items-center p-1 min-w-0">
                      <Portrait name={item.session.speaker_name} size={48} />
                      <span className="min-w-0">
                        <span className={`block text-[16px] font-medium leading-[1.2] truncate
                          ${chosen ? 'text-white' : 'text-black'}`}>
                          {item.session.title}
                        </span>
                        <span className={`block text-[14px] leading-[1.5] truncate
                          ${chosen ? 'text-white' : 'text-[#030712]'}`}>
                          {item.session.speaker_name ||
                            t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
                        </span>
                      </span>
                    </span>
                    {chosen && <FigmaIcon name="arrowRight" size={24} />}
                  </button>
                );
              })
            )}
          </div>

          <div className="bg-[#007092] text-white p-4 min-h-[363px]">
            {!selected ? (
              <p className="text-[16px] opacity-90">
                {t({ ne: 'कुनै सत्र छानिएको छैन।', en: 'No session chosen.' })}
              </p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 text-center">
                    <p className="text-[20px] font-medium leading-[1.2]">
                      {t({ ne: 'सारांश', en: 'Summary' })}
                    </p>
                    <p className="text-[16px] leading-[1.5]">
                      {selected.session.speaker_name ||
                        t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
                    </p>
                  </div>
                  <span className="bg-white border border-[#e3e8ef] rounded-[4px] h-6 px-1
                    grid place-items-center flex-none text-[12px] text-[#030712]
                    tracking-[-0.06px] tabular-nums">
                    {timeRange(
                      selected.session.starts_at, selected.session.duration_minutes
                    )}
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-3 text-[14px] leading-[1.4]
                  tracking-[-0.07px] text-[#fcfcfc] max-h-[240px] overflow-y-auto">
                  {summary && summary.findings.length > 0 ? (
                    summary.findings.map((point, i) => <p key={i}>{point}</p>)
                  ) : (
                    <p className="opacity-80">
                      {t({
                        ne: 'यो सत्रको निष्कर्ष अझै प्रकाशित भएको छैन।',
                        en: 'Nothing has been published for this session yet.',
                      })}
                    </p>
                  )}

                  {summary && summary.actions.length > 0 && (
                    <div className="pt-3 border-t border-white/25">
                      <p className="text-[12px] uppercase tracking-wide opacity-80 mb-1.5">
                        {t({ ne: 'कार्यसूची', en: 'Actions' })}
                      </p>
                      {summary.actions.map((action, i) => (
                        <p key={i} className="flex gap-2 justify-between">
                          <span>{action.task}</span>
                          <span className="opacity-85 flex-none">
                            {[action.owner, action.due].filter(Boolean).join(' · ')}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </>
  );
};
