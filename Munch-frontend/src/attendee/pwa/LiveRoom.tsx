import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { LIST_POLL_MS } from '../../services/polling';
import { Event, Session } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { PhoneShell, Section } from './PhoneShell';
import { TranscriptScreen } from './TranscriptScreen';
import { AgendaScreen } from './AgendaScreen';
import { BoardScreen } from './BoardScreen';
import { FilesScreen } from './FilesScreen';
import { Settings } from './profile/Settings';

/**
 * The live room, on a phone.
 *
 * Five things somebody in a hall actually does: follow what is being
 * said, look up what is next, ask something, take a copy of the
 * handouts, and see who they are signed in as. One event at a time,
 * because a person in a room is in one room.
 *
 * The host's screens are a different app in the same bundle and are
 * left exactly as they were: a host works at a desk and needs the rail,
 * the tables and the forms.
 */
export const LiveRoom: React.FC<{ onLeave: () => void }> = ({ onLeave }) => {
  const { t } = useOrganizer();

  const [at, setAt] = useState<Section>('transcript');
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agendaDetailOpen, setAgendaDetailOpen] = useState(false);
  const [photoFolderOpen, setPhotoFolderOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await apiClient.listEvents('attendee');
      setEvents(list);
      // Whichever is running, failing that whichever is first: somebody
      // opening this in a hall is almost always in the live one.
      setEventId((was) => was
        || list.find((one) => one.status === 'active')?.id
        || list[0]?.id
        || '');
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the event' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const event = events.find((one) => one.id === eventId) ?? null;

  const readSessions = useCallback(async () => {
    if (!eventId) { setSessions([]); return; }
    try {
      setSessions(await apiClient.listSessions(eventId));
    } catch {
      setSessions([]);
    }
  }, [eventId]);

  useEffect(() => {
    readSessions();
    // The running order moves while somebody is looking at it: a talk
    // ends early, the next starts, and the screen should say so without
    // being reopened.
    const id = setInterval(readSessions, 15000);
    return () => clearInterval(id);
  }, [readSessions]);

  const live = useMemo(
    () => sessions.find((one) => one.status === 'live') ?? null,
    [sessions]
  );

  if (loading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-white">
        <p className="text-[14px] text-[#8b90a0]">
          {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
        </p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-white px-8">
        <p className="text-center text-[14px] text-[#8b90a0]">
          {t({
            ne: 'तपाईं कुनै कार्यक्रममा हुनुहुन्न।',
            en: 'You are not in any event yet.',
          })}
        </p>
      </div>
    );
  }

  return (
    <PhoneShell
      at={at}
      onGo={setAt}
      hideSectionHeader={
        (at === 'agenda' && agendaDetailOpen)
        || (at === 'files' && photoFolderOpen)
      }
      eventTitle={event.title}
    >
      {at === 'transcript' && (
        <TranscriptScreen event={event} live={live} onLeave={onLeave} />
      )}
      {at === 'agenda' && (
        <AgendaScreen
          event={event}
          sessions={sessions}
          live={live}
          onDetailChange={setAgendaDetailOpen}
        />
      )}
      {at === 'board' && <BoardScreen event={event} />}
      {at === 'files' && (
        <FilesScreen
          event={event}
          sessions={sessions}
          onFolderOpenChange={setPhotoFolderOpen}
        />
      )}
      {at === 'profile' && <Settings />}
    </PhoneShell>
  );
};
