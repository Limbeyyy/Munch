import React, { useEffect, useMemo, useState } from 'react';
import { Meeting } from '../../types';
import { PhotoAlbums } from '../Photos';
import { meetingState } from '../sessionState';
import { useOrganizer } from '../i18n';
import { Card, Empty, Head } from '../ui';

interface Props { meetings: Meeting[]; }

/**
 * The photographs taken on the day, filed by the host.
 *
 * A meeting that has finished is the one worth opening, so that is what
 * the picker offers first - the whole point of this page is what happened,
 * not what is about to.
 */
export const PhotosView: React.FC<Props> = ({ meetings }) => {
  const { t } = useOrganizer();
  const [meetingId, setMeetingId] = useState('');

  // Finished meetings first: this page is about what happened, not about
  // what is coming. Held in a memo so the effect below is not re-run on
  // every render by a fresh array.
  const ordered = useMemo(
    () => [
      ...meetings.filter((m) => meetingState(m) === 'finished'),
      ...meetings.filter((m) => meetingState(m) !== 'finished'),
    ],
    [meetings]
  );

  useEffect(() => {
    if (!meetingId && ordered.length > 0) setMeetingId(ordered[0].id);
  }, [meetingId, ordered]);

  const meeting = meetings.find((m) => m.id === meetingId) ?? ordered[0] ?? null;

  return (
    <>
      <Head
        title={{ ne: 'तस्बिरहरू', en: 'Photos' }}
        lede={{
          ne: 'कार्यक्रमको दिनका तस्बिर — समूह फोटो, पुरस्कार वितरण, हल। बैठक सकिएपछि थप्न मिल्छ।',
          en: 'The day itself — the group photograph, the prize distribution, the hall. Added once the meeting has finished.',
        }}
      />

      {meetings.length === 0 ? (
        <Card>
          <Empty>{t({ ne: 'अझै कुनै बैठक छैन।', en: 'No meetings yet.' })}</Empty>
        </Card>
      ) : (
        <>
          {meetings.length > 1 && (
            <div className="mb-3.5">
              <label
                htmlFor="manch-photo-meeting"
                className="block text-[12.5px] text-[#6E7C8E] mb-1.5"
              >
                {t({ ne: 'कुन बैठक', en: 'Which meeting' })}
              </label>
              <select
                id="manch-photo-meeting"
                value={meeting?.id ?? ''}
                onChange={(e) => setMeetingId(e.target.value)}
                className="border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[13.5px] max-w-md w-full"
              >
                {ordered.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {meetingState(m) === 'finished'
                      ? ''
                      : t({ ne: ' (सकिएको छैन)', en: ' (not finished)' })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {meeting && <PhotoAlbums meetingRef={meeting.meeting_code} />}
        </>
      )}
    </>
  );
};
