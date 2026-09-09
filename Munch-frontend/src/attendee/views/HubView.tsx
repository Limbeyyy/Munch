import React, { useState } from 'react';
import { EventMeeting } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { Card, Empty, Tabs } from '../../organizer/ui';
import { QUEUE_POLL_MS } from '../../services/polling';
import { MessageBoard } from '../../organizer/MessageBoard';
import { PhotoAlbums } from '../../organizer/Photos';

interface Props {
  meetings: EventMeeting[];
  /** Guests read through their signed token rather than an account. */
  guestToken?: string;
  myName: string;
}

/**
 * What the meeting put up for everyone to read.
 *
 * Two things, and no composer: the questions and suggestions the host has
 * answered, and the photographs of the day. Asking happens in the room,
 * where the host is watching the queue - a message sent from a dashboard
 * hours after the fact has nobody attending to it, and the board is the
 * record of what came of the ones that were.
 */
export const HubView: React.FC<Props> = ({ meetings, guestToken }) => {
  const { t } = useOrganizer();

  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '');
  const meeting = meetings.find((m) => m.id === meetingId) ?? meetings[0];
  const [tab, setTab] = useState<'board' | 'photos'>('board');

  if (!meeting && !guestToken) {
    return (
      <Card>
        <Empty>
          {t({
            ne: 'तपाईंको कुनै कार्यक्रम छैन।',
            en: 'You are not on any programme yet.',
          })}
        </Empty>
      </Card>
    );
  }

  return (
    <>
      {meetings.length > 1 && (
        <div className="mb-3.5">
          <label
            htmlFor="manch-hub-meeting"
            className="block text-[12.5px] text-[#6E7C8E] mb-1.5"
          >
            {t({ ne: 'कुन बैठक', en: 'Which meeting' })}
          </label>
          <select
            id="manch-hub-meeting"
            value={meeting?.id ?? ''}
            onChange={(e) => setMeetingId(e.target.value)}
            className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{m.title} · {m.meeting_code}</option>
            ))}
          </select>
        </div>
      )}

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as 'board' | 'photos')}
        tabs={[
          { id: 'board', label: { ne: 'प्रश्न र सुझाव', en: 'Questions & suggestions' } },
          { id: 'photos', label: { ne: 'फोटो', en: 'Photos' } },
        ]}
      />

      {/* Looking, and nothing else: photographs are the record the host
          keeps, so adding to them is done from their side - even by
          somebody who presents elsewhere on the programme. */}
      {tab === 'photos' ? (
        meeting ? (
          <PhotoAlbums meetingRef={meeting.meeting_code} canManage={false} />
        ) : (
          <Card><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No meeting yet.' })}</Empty></Card>
        )
      ) : (
        <MessageBoard
          meetingId={guestToken ? undefined : meeting?.id}
          guestToken={guestToken}
          refreshMs={QUEUE_POLL_MS}
        />
      )}
    </>
  );
};
