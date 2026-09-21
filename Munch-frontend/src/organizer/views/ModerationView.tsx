import React, { useEffect, useState } from 'react';
import { QUEUE_POLL_MS } from '../../services/polling';
import { Event } from '../../types';
import { MessageBoard } from '../MessageBoard';
import { useOrganizer } from '../i18n';
import { Empty, Head, Panel } from '../ui';

interface Props { events: Event[]; }

/**
 * What the host has put up, for everybody to read.
 *
 * This screen used to be three: a queue of messages waiting to be let
 * through, a queue of guests waiting at the door, and the board. The
 * first two belonged to a chat, and there is no chat - what somebody
 * writes is put to the host inside the room, and the host either puts it
 * up on the board there or does not. Nothing waits here in between.
 *
 * So what is left is the board itself: the questions and the suggestions
 * of one event, which is the only thing this screen ever published.
 */
export const ModerationView: React.FC<Props> = ({ events }) => {
  const { t } = useOrganizer();
  const [boardEvent, setBoardEvent] = useState('');

  useEffect(() => {
    setBoardEvent((was) => was || events[0]?.id || '');
  }, [events]);

  return (
    <>
      <Head
        title={{ ne: 'मडेरेसन', en: 'Moderation' }}
        lede={{
          ne: 'आयोजकले राखेका प्रश्न र सुझाव — सबैले पढ्नलाई।',
          en: 'What the host has put up, for everybody to read.',
        }}
      />

      {events.length === 0 ? (
        <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No events.' })}</Empty></Panel>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* One board at a time. Drawing every event's at once meant
              polling all of them at once, which is a lot of traffic for
              boards nobody is looking at. */}
          {events.length > 1 && (
            <div>
              <label
                htmlFor="manch-board-event"
                className="block text-[12.5px] text-[#6E7C8E] mb-1.5"
              >
                {t({ ne: 'कुन बैठक', en: 'Which event' })}
              </label>
              <select
                id="manch-board-event"
                value={boardEvent}
                onChange={(e) => setBoardEvent(e.target.value)}
                className="w-full max-w-md border border-navy-800/15 rounded-[9px]
                  px-3 py-2 bg-white text-[14px]"
              >
                {events.map((one) => (
                  <option key={one.id} value={one.id}>{one.title}</option>
                ))}
              </select>
            </div>
          )}

          <MessageBoard
            eventId={boardEvent || events[0].id}
            refreshMs={QUEUE_POLL_MS}
            canAnswer
          />
        </div>
      )}
    </>
  );
};
