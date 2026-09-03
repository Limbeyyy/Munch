import React, { useMemo } from 'react';
import { useOrganizer } from '../../organizer/i18n';
import { Card, Chip } from '../../organizer/ui';
import { SpineItem, clock } from '../Spine';

interface Props {
  items: SpineItem[];
  onOpen: (item: SpineItem) => void;
}

/** Who is speaking, and which part of the day they hold. */
export const SpeakersView: React.FC<Props> = ({ items, onOpen }) => {
  const { t, num } = useOrganizer();

  // A speaker often holds more than one slot, so gather their sessions.
  const speakers = useMemo(() => {
    const order: string[] = [];
    const byName: Record<string, SpineItem[]> = {};
    items.forEach((item) => {
      const name = item.session.speaker_name?.trim();
      if (!name) return;
      if (!byName[name]) { byName[name] = []; order.push(name); }
      byName[name].push(item);
    });
    return order.map((name) => ({ name, sessions: byName[name] }));
  }, [items]);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[26px] font-semibold">{t({ ne: 'वक्ता', en: 'Speakers' })}</h1>
        <p className="text-sm text-[#6E7C8E] mt-1">
          {t({
            ne: 'कसले के बोल्दै छन् — नाममा क्लिक गर्दा त्यो सत्र खुल्छ।',
            en: 'Who is speaking on what — open a slot to read it.',
          })}
        </p>
      </div>

      {speakers.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({
              ne: 'अझै कुनै सत्रमा वक्ता तोकिएको छैन।',
              en: 'No speaker has been named on the programme yet.',
            })}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {speakers.map(({ name, sessions }) => (
            <Card key={name} className="flex flex-col gap-3">
              <div className="flex gap-3 items-center">
                <span className="w-14 h-14 rounded-full bg-navy-700 text-white grid place-items-center text-[19px] font-bold flex-none">
                  {name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold truncate">{name}</h3>
                  <p className="text-[12.5px] text-[#6E7C8E]">
                    {t({
                      ne: `${num(sessions.length)} सत्र`,
                      en: `${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
                    })}
                  </p>
                </div>
              </div>

              {sessions.map((item) => (
                <button
                  key={item.session.id}
                  onClick={() => onOpen(item)}
                  className="text-[12.5px] text-ink-2 bg-cream rounded-lg px-3 py-2 text-start hover:bg-cream-200"
                >
                  <span className="tabular-nums">{clock(item.session.starts_at)}</span>
                  {' · '}
                  {item.session.title}
                  {item.session.status === 'live' && (
                    <span className="ms-1.5"><Chip tone="live">{t({ ne: 'लाइभ', en: 'Live' })}</Chip></span>
                  )}
                </button>
              ))}
            </Card>
          ))}
        </div>
      )}
    </>
  );
};
