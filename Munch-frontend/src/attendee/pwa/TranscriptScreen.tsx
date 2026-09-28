import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api';
import { Event, Session, TranscriptionSegment } from '../../types';
import { useOrganizer } from '../../organizer/i18n';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** How long the event has been running, as the header counts it. */
const runningFor = (from: string | null | undefined): string => {
  if (!from) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - +new Date(from)) / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${
    String(minutes % 60).padStart(2, '0')}`;
};

/**
 * What is being said, as it is said.
 *
 * The screen follows the speaker by itself, which is what somebody
 * holding a phone in a hall wants - until they scroll back to read
 * something again, at which point following would yank the page out
 * from under them. So it stops, and offers to catch up.
 */
export const TranscriptScreen: React.FC<{
  event: Event;
  live: Session | null;
}> = ({ event, live }) => {
  const { t } = useOrganizer();
  const [lines, setLines] = useState<TranscriptionSegment[]>([]);
  const [following, setFollowing] = useState(true);
  const [tick, setTick] = useState(0);
  const foot = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const read = useCallback(async () => {
    try {
      setLines(await apiClient.getEventSegments(event.code));
    } catch {
      // A transcript that cannot be read is an empty one, not an error
      // worth a banner: the hall may simply not have started.
    }
  }, [event.code]);

  useEffect(() => {
    read();
    const id = setInterval(read, 4000);
    return () => clearInterval(id);
  }, [read]);

  // The running time, once a minute.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (following) foot.current?.scrollIntoView({ block: 'end' });
  }, [lines, following]);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    // Within a line or so of the bottom counts as still following, so a
    // thumb resting on the page does not stop it.
    const atFoot = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    setFollowing(atFoot);
  };

  const catchUp = () => {
    setFollowing(true);
    foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-76px)]">
      <header
        className="bg-[#12386e] text-white px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold truncate">{event.title}</p>
          <p className="text-[11px] text-white/70">
            {t({ ne: 'प्रत्यक्ष ट्रान्सक्रिप्ट', en: 'Live transcription' })}
          </p>
        </div>
        {event.status === 'active' && (
          <span className="bg-white rounded-full px-2.5 py-1 flex items-center gap-1.5
            flex-none">
            <span className="bg-[#e12121] rounded-full size-1.5" aria-hidden />
            <span className="text-[11px] font-semibold text-[#e12121]">
              {t({ ne: 'प्रत्यक्ष', en: 'LIVE' })}
            </span>
            <span className="text-[11px] text-[#111726] tabular-nums">
              {runningFor(event.started_at) || String(tick).slice(0, 0)}
            </span>
          </span>
        )}
      </header>

      <div className="px-4 py-2.5 border-b border-[#eceef2] flex items-center gap-3
        text-[11px]">
        <span className="uppercase tracking-[.06em] text-[#8b90a0]">
          {t({ ne: 'अहिलेको', en: 'Current agenda' })}
        </span>
        <span className="w-px h-3 bg-[#e2e5ea]" aria-hidden />
        <span className="flex-1 min-w-0 text-[13px] font-medium text-[#111726] truncate">
          {live?.title ?? t({ ne: 'केही चलिरहेको छैन', en: 'Nothing on stage' })}
        </span>
        {live && (
          <span className="text-[#8b90a0] tabular-nums">{clock(live.starts_at)}</span>
        )}
      </div>

      <div className="px-4 py-2 flex items-center gap-2 text-[11px]">
        <span className="uppercase tracking-[.06em] text-[#8b90a0]">
          {t({ ne: 'प्रत्यक्ष ट्रान्सक्रिप्ट', en: 'Live transcript' })}
        </span>
        <span className="flex items-center gap-1 text-[#1a9f54]">
          <span className="bg-[#1a9f54] rounded-full size-1.5" aria-hidden />
          {t({ ne: 'चालु', en: 'Active' })}
        </span>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 pb-4"
      >
        {lines.length === 0 ? (
          <p className="pt-10 text-center text-[13px] text-[#8b90a0]">
            {t({
              ne: 'अझै केही भनिएको छैन।',
              en: 'Nothing has been said yet.',
            })}
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={`${line.created_at ?? ''}-${i}`} className="pt-3">
              {line.created_at && (
                <p className="text-[11px] text-[#9ba0ad] tabular-nums">
                  {clock(line.created_at)}
                </p>
              )}
              {line.speaker_name && (
                <p className="text-[14px] font-semibold text-[#111726]">
                  {line.speaker_name}
                </p>
              )}
              <p className="pt-0.5 text-[14px] leading-6 text-[#2b3140]">
                {line.text}
              </p>
            </div>
          ))
        )}
        <div ref={foot} />
      </div>

      {!following && lines.length > 0 && (
        <button
          type="button"
          onClick={catchUp}
          className="absolute left-1/2 -translate-x-1/2 bottom-[92px] bg-[#111726]
            text-white rounded-full px-4 py-2 flex items-center gap-1.5
            text-[13px] font-medium shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
          {t({ ne: 'प्रत्यक्षमा जानुहोस्', en: 'Jump to live' })}
        </button>
      )}
    </div>
  );
};
