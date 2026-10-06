import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api';
import { Event, Session, TranscriptionSegment } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { useElapsed } from '../../services/elapsed';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** How long the event has been running, as the header counts it. */
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
  onLeave?: () => void;
  guestToken?: string;
}> = ({ event, live, onLeave, guestToken }) => {
  const { t } = useOrganizer();
  const [lines, setLines] = useState<TranscriptionSegment[]>([]);
  const [following, setFollowing] = useState(true);
  const running = useElapsed(live?.started_at);
  // Newest first, so the place to follow is the top of the list.
  const head = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const read = useCallback(async () => {
    try {
      setLines(guestToken
        ? await apiClient.getGuestSegments(event.code, guestToken)
        : await apiClient.getEventSegments(event.code));
    } catch {
      // A transcript that cannot be read is an empty one, not an error
      // worth a banner: the hall may simply not have started.
    }
  }, [event.code, guestToken]);

  useEffect(() => {
    read();
    const id = setInterval(read, 4000);
    return () => clearInterval(id);
  }, [read]);


  useEffect(() => {
    if (following) head.current?.scrollIntoView({ block: 'start' });
  }, [lines, following]);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    // Within a line or so of the top counts as still following, so a
    // thumb resting on the page does not stop it.
    setFollowing(box.scrollTop < 40);
  };

  const catchUp = () => {
    setFollowing(true);
    head.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-76px)]">
      <header
        className="bg-[#12386e] text-white px-6 py-2 flex items-center gap-3
          border-b-[0.612px] border-[#e5e7eb]"
        style={{ paddingTop: 'max(35px, env(safe-area-inset-top))' }}
      >
        <div className="min-w-0 flex-1 flex flex-col gap-1.5 items-start">
          <div className="min-w-0 w-full">
            <p className="text-[14px] font-semibold leading-[17.5px] truncate">
              {event.title}
            </p>
            <p className="text-[12px] leading-4 text-[#efefef]">
              {t({ ne: 'प्रत्यक्ष श्रुतिलेखन', en: 'Live transcription' })}
            </p>
          </div>

          {event.status === 'active' && (
            <span className="bg-[#fef2f2] rounded-full px-3 py-1.5 flex items-center
              gap-2 flex-none">
              <span className="bg-[#fb2c36] opacity-[.64] rounded-full size-2"
                aria-hidden />
              <span className="text-[12px] font-semibold leading-4 tracking-[0.3px]
                text-[#e7000b]">
                {t({ ne: 'प्रत्यक्ष', en: 'LIVE' })}
              </span>
              <span className="text-[12px] leading-4 text-[#fb2c36] tabular-nums">
                {running}
              </span>
            </span>
          )}
        </div>

        {onLeave && (
          <button
            type="button"
            onClick={onLeave}
            className="flex-none bg-white border border-[#12386e] rounded-[12px]
              px-2 py-1 flex items-center gap-1 text-[14px] text-[#f75656]
              tracking-[-0.07px]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden>
              <path d="M14 20H6a2 2 0 01-2-2V6a2 2 0 012-2h8M18 16l4-4-4-4M22 12H10" />
            </svg>
            {t({ ne: 'बाहिर', en: 'Leave' })}
          </button>
        )}

      </header>

      <div className="bg-white px-5 py-3 border-b-[0.612px] border-[#f3f4f6]
        flex items-center gap-2
        drop-shadow-[0px_4px_3px_rgba(0,0,0,0.1),0px_2px_2px_rgba(0,0,0,0.05)]">
        <span className="flex-none text-[12px] font-medium leading-4 uppercase
          text-[#99a1af]">
          {t({ ne: 'अहिलेको', en: 'Current agenda' })}
        </span>
        <span className="w-px h-4 bg-[#e5e7eb] flex-none" aria-hidden />
        <span className="flex-1 min-w-0 text-[14px] font-medium leading-5
          text-[#1e2939] truncate">
          {live?.title ?? t({ ne: 'केही चलिरहेको छैन', en: 'Nothing on stage' })}
        </span>
        {live && (
          <>
            <span className="w-px h-4 bg-[#e5e7eb] flex-none" aria-hidden />
            <span className="flex-none text-[12px] leading-4 text-[#99a1af]
              tabular-nums">
              {clock(live.starts_at)}
            </span>
          </>
        )}
      </div>

      <div className="px-5 pt-3 flex items-center gap-2">
        <span className="text-[12px] font-semibold leading-4 uppercase
          tracking-[1.2px] text-[#99a1af]">
          {t({ ne: 'प्रत्यक्ष श्रुतिलेखन', en: 'Live transcript' })}
        </span>
        <span className="flex items-center gap-1 text-[12px] leading-4
          text-[#00a63e]">
          <span className="bg-[#00c950] opacity-[.64] rounded-full size-1.5"
            aria-hidden />
          {t({ ne: 'चालु', en: 'Active' })}
        </span>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-5 pb-4"
      >
        <div ref={head} />
        {lines.length === 0 ? (
          <p className="pt-10 text-center text-[13px] text-[#8b90a0]">
            {t({
              ne: 'अझै केही भनिएको छैन।',
              en: 'Nothing has been said yet.',
            })}
          </p>
        ) : (
          // Newest first. Read on a phone in a hall, what matters is
          // the line being said now; at the foot of a list taller than
          // the screen it is the one line nobody can see. Copied
          // rather than reversed in place, because `lines` is state.
          [...lines].reverse().map((line, i) => {
            // The first line is now the one being said, and it is
            // worth marking: a reader glancing at this wants to know
            // where the room has got to, not only what it said.
            const now = i === 0 && event.status === 'active';
            return (
              <div key={`${line.created_at ?? ''}-${i}`} className="pt-6"
                data-transcript-line>
                {line.created_at && (
                  <p className="text-[12px] leading-4 text-[#99a1af] tabular-nums">
                    {clock(line.created_at)}
                  </p>
                )}
                <div className="pt-1 flex items-center gap-2">
                  {line.speaker_name && (
                    <p className="flex-1 min-w-0 text-[14px] font-semibold
                      leading-5 text-[#101828]">
                      {line.speaker_name}
                    </p>
                  )}
                  {now && (
                    <span className="bg-[#eff6ff] rounded-full px-2 py-0.5 flex-none
                      flex items-center gap-1 text-[12px] leading-4 text-[#155dfc]">
                      <span className="bg-[#2b7fff] opacity-[.62] rounded-full
                        w-3 h-1.5" aria-hidden />
                      {t({ ne: 'बोल्दै', en: 'Speaking' })}
                    </span>
                  )}
                </div>
                <p className={`pt-1 text-[14px] leading-[22.75px] ${
                  now ? 'text-[#101828]' : 'text-[#364153]'
                }`}>
                  {line.text}
                </p>
              </div>
            );
          })
        )}
      </div>

      {!following && lines.length > 0 && (
        <button
          type="button"
          onClick={catchUp}
          className="absolute left-1/2 -translate-x-1/2 bottom-[92px] bg-[#101828]
            text-white rounded-full px-4 py-2 flex items-center gap-1.5
            text-[12px] font-medium
            drop-shadow-[0px_10px_7.5px_rgba(0,0,0,0.1),0px_4px_3px_rgba(0,0,0,0.1)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M18 15l-6-6-6 6" />
          </svg>
          {t({ ne: 'प्रत्यक्षमा जानुहोस्', en: 'Jump to live' })}
        </button>
      )}
    </div>
  );
};
