import React from 'react';
import { EventMeeting, Session } from '../types';
import { useOrganizer } from '../organizer/i18n';
import { Chip } from '../organizer/ui';
import {
  SESSION_STATE_LABEL, SESSION_STATE_TONE, isPast, sessionState,
} from '../organizer/sessionState';

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface SpineItem {
  session: Session;
  meeting: EventMeeting;
  /** True when this person was recorded present for it. */
  attended?: boolean;
}

interface Props {
  items: SpineItem[];
  onOpen: (item: SpineItem) => void;
  /** Hide the meeting name when the whole list is one meeting. */
  compact?: boolean;
}

/**
 * The day as a vertical thread: time on the left, a marker on the line,
 * and the session itself as a card you can open.
 */
export const Spine: React.FC<Props> = ({ items, onOpen, compact }) => {
  const { t, num } = useOrganizer();

  if (items.length === 0) {
    return (
      <p className="text-[#6E7C8E] text-[13.5px] py-6">
        {t({ ne: 'यो दिनमा कुनै सत्र छैन।', en: 'Nothing on the programme for this day.' })}
      </p>
    );
  }

  return (
    <div className="relative ps-1">
      {/* The thread itself, behind the markers */}
      <span
        className="absolute w-0.5 bg-navy-800/15"
        style={{ insetBlock: 14, insetInlineStart: 62 }}
        aria-hidden="true"
      />
      {items.map((item) => {
        const { session, meeting } = item;
        // The meeting matters: an overrun session inside one still
        // running is overdue, not never started.
        const state = sessionState(session, Date.now(), meeting);
        const shape = state === 'live' ? 'live' : isPast(state) ? 'past' : 'next';

        return (
          <article
            key={session.id}
            className="grid items-start py-2.5 relative"
            style={{ gridTemplateColumns: '52px 22px minmax(0,1fr)' }}
          >
            <div className="text-[13px] text-[#6E7C8E] pt-3 text-end tabular-nums pe-1.5">
              {clock(session.starts_at)}
            </div>
            <div className="grid place-items-center pt-[15px]">
              <i
                className={`block rounded-full border-2 z-[1] ${
                  shape === 'live'
                    ? 'w-3.5 h-3.5 bg-amber border-amber ring-[5px] ring-amber/20'
                    : shape === 'past'
                    ? 'w-[11px] h-[11px] bg-navy-500 border-navy-500'
                    : 'w-[11px] h-[11px] bg-cream border-navy-500'
                }`}
              />
            </div>

            <button
              onClick={() => onOpen(item)}
              className={`w-full text-start border rounded-[14px] px-4 py-3 transition hover:border-navy-500 hover:translate-x-0.5 ${
                shape === 'next'
                  ? 'bg-transparent border-dashed border-navy-800/15'
                  : shape === 'past'
                  ? 'bg-white/[.62] border-navy-800/15'
                  : 'bg-white border-navy-800/15'
              }`}
            >
              <h3 className="text-[16px] font-semibold">{session.title}</h3>
              <p className="text-[13px] text-[#6E7C8E] mt-0.5">
                {session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
                {session.hall && ` · ${session.hall}`}
                {!compact && ` · ${item.meeting.title}`}
                {` · ${num(session.duration_minutes)}′`}
              </p>

              <div className="flex gap-1.5 flex-wrap mt-2.5 items-center">
                <Chip tone={SESSION_STATE_TONE[state]}>{t(SESSION_STATE_LABEL[state])}</Chip>
                {item.attended === true && (
                  <Chip tone="ok">{t({ ne: 'तपाईं उपस्थित', en: 'You attended' })}</Chip>
                )}
                {/* Missing a session only means something if it happened. */}
                {item.attended === false && state === 'finished' && (
                  <Chip tone="warn">{t({ ne: 'तपाईंले छुटाउनुभयो', en: 'You missed this' })}</Chip>
                )}
                {session.attendance_count > 0 && (
                  <Chip>{num(session.attendance_count)} {t({ ne: 'उपस्थित', en: 'present' })}</Chip>
                )}
              </div>
            </button>
          </article>
        );
      })}
    </div>
  );
};
