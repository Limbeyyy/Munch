import React, { useState } from 'react';
import { useOrganizer } from '../../organizer/i18n';
import { Card, Chip, Tabs } from '../../organizer/ui';
import { SpineItem, clock } from '../Spine';

interface Props {
  items: SpineItem[];
  attendedIds: Set<string>;
  onOpen: (item: SpineItem) => void;
}

/** Sessions as cards: what has finished, and what you were not there for. */
export const SessionsView: React.FC<Props> = ({ items, attendedIds, onOpen }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('past');

  const past = items.filter((i) => i.session.status === 'done');
  const missed = past.filter((i) => !attendedIds.has(i.session.id));
  const upcoming = items.filter((i) => i.session.status !== 'done');
  const shown = tab === 'past' ? past : tab === 'missed' ? missed : upcoming;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[26px] font-semibold">{t({ ne: 'सत्रहरू', en: 'Sessions' })}</h1>
        <p className="text-sm text-[#6E7C8E] mt-1">
          {t({
            ne: 'सकिएका सत्रको ट्रान्सक्रिप्ट, सामग्री र उपस्थिति सधैँका लागि यहीँ रहन्छ।',
            en: 'The transcript, files and attendance of a finished session stay here for good.',
          })}
        </p>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'past', label: { ne: `सकिएका (${num(past.length)})`, en: `Finished (${past.length})` } },
          { id: 'missed', label: { ne: `छुटेका (${num(missed.length)})`, en: `You missed (${missed.length})` } },
          { id: 'upcoming', label: { ne: `आउँदै (${num(upcoming.length)})`, en: `Coming up (${upcoming.length})` } },
        ]}
      />

      {shown.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E] max-w-sm mx-auto">
            {tab === 'missed'
              ? t({ ne: 'तपाईंले कुनै सत्र छुटाउनुभएको छैन।', en: 'You have not missed a session.' })
              : tab === 'past'
              ? t({ ne: 'अझै कुनै सत्र सकिएको छैन।', en: 'No session has finished yet.' })
              : t({ ne: 'यसपछि केही तालिकामा छैन।', en: 'Nothing more is scheduled.' })}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {shown.map((item) => {
            const { session, meeting } = item;
            const was = attendedIds.has(session.id);
            return (
              <button
                key={session.id}
                onClick={() => onOpen(item)}
                className="bg-white border border-navy-800/15 rounded-[14px] overflow-hidden text-start flex flex-col hover:border-navy-500 transition"
              >
                <div className="px-4 pt-3.5 pb-3 border-b border-navy-800/[.08]">
                  <div className="flex gap-2 items-center text-xs text-[#6E7C8E]">
                    <span className="tabular-nums">
                      {clock(session.starts_at)}–{clock(session.ends_at)}
                    </span>
                    <span>·</span>
                    <span className="truncate">{session.hall || meeting.title}</span>
                    {session.status === 'done' && !was && (
                      <span className="ms-auto"><Chip tone="warn">{t({ ne: 'छुट्यो', en: 'Missed' })}</Chip></span>
                    )}
                  </div>

                  <h3 className="text-[16px] font-semibold mt-1.5 mb-2">{session.title}</h3>

                  <div className="flex gap-2.5 items-center">
                    <span className="w-[30px] h-[30px] rounded-full bg-navy-700 text-white grid place-items-center text-xs font-semibold flex-none">
                      {(session.speaker_name || '—').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-[13px] text-ink-2 leading-tight min-w-0">
                      {session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
                      <small className="block text-[11.5px] text-[#6E7C8E]">
                        {num(session.duration_minutes)}′
                      </small>
                    </span>
                  </div>
                </div>

                <div className="px-4 py-2.5 bg-cream flex gap-1.5 flex-wrap mt-auto">
                  {session.status === 'live' && <Chip tone="live">{t({ ne: 'लाइभ', en: 'Live' })}</Chip>}
                  {was && <Chip tone="ok">{t({ ne: 'तपाईं उपस्थित', en: 'You were there' })}</Chip>}
                  {session.attendance_count > 0 && (
                    <Chip>{num(session.attendance_count)} {t({ ne: 'उपस्थित', en: 'present' })}</Chip>
                  )}
                  <Chip>{t({ ne: 'ट्रान्सक्रिप्ट', en: 'Transcript' })}</Chip>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};
