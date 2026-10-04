import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { API_BASE_URL } from '../../services/apiConfig';

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
  const leaveRef = useRef(onLeave);
  const joinedEventIdRef = useRef('');

  useEffect(() => { leaveRef.current = onLeave; }, [onLeave]);

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
  const code = event?.code ?? '';
  const idleTimeoutMinutes = event?.idle_timeout_minutes ?? 15;

  useEffect(() => {
    if (!code) return undefined;

    const apiUrl = new URL(API_BASE_URL);
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('access_token');
    if (!token) return undefined;

    const socket = new window.WebSocket(
      `${protocol}//${apiUrl.host}/ws/event/${code}/?token=${encodeURIComponent(token)}`
    );
    let lastBeat = 0;
    const beat = () => {
      const now = Date.now();
      if (now - lastBeat < 15000 || socket.readyState !== WebSocket.OPEN) return;
      lastBeat = now;
      socket.send(JSON.stringify({ type: 'heartbeat' }));
    };
    const watched: (keyof WindowEventMap)[] = [
      'pointerdown', 'keydown', 'wheel', 'touchstart', 'focus',
    ];
    watched.forEach((name) => window.addEventListener(name, beat));
    document.addEventListener('visibilitychange', beat);
    socket.onopen = beat;
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.type === 'event_ended') leaveRef.current();
      if (data.type === 'idle_evicted') {
        toast(t({
          ne: 'तपाईं निष्क्रिय रहनुभयो, त्यसैले कोठाबाट बाहिरिनुभयो।',
          en: 'You were away, so the room let you go.',
        }));
        leaveRef.current();
      }
    };
    socket.onerror = (error) => {
      console.error('Attendee room WebSocket error:', error);
    };

    return () => {
      watched.forEach((name) => window.removeEventListener(name, beat));
      document.removeEventListener('visibilitychange', beat);
      socket.close();
    };
  }, [code, t]);

  useEffect(() => {
    if (event?.status === 'ended') leaveRef.current();
  }, [event?.status]);

  /**
   * Say that somebody is here.
   *
   * Opening the room on a phone used to tell the server nothing at
   * all - only the desktop room announced itself - so an attendee who
   * sat through the whole event never appeared among the participants
   * and was counted absent afterwards. Being in the room is the thing
   * attendance is made of, and it has to be said out loud.
   *
   * Idempotent on the server, so a reconnection or a second tab adds
   * nobody twice.
   */
  useEffect(() => {
    if (!code) return undefined;
    let gone = false;

    joinedEventIdRef.current = '';
    apiClient.joinEvent(code).then(() => {
      if (!gone) joinedEventIdRef.current = eventId;
    }).catch(() => {
      // The room may not be open yet, or the network may have gone.
      // Neither is a reason to keep somebody out of a screen that
      // reads perfectly well without it.
    });

    return () => {
      gone = true;
      if (joinedEventIdRef.current === eventId) joinedEventIdRef.current = '';
      // Said on the way out as well, so "in the room" means in the
      // room rather than "was here at some point today".
      if (gone) apiClient.leaveEvent(eventId).catch(() => undefined);
    };
  }, [code, eventId]);

  useEffect(() => {
    if (!eventId || idleTimeoutMinutes <= 0) return undefined;
    const id = window.setInterval(async () => {
      if (joinedEventIdRef.current !== eventId) return;
      try {
        const activeEvents = await apiClient.getActiveEvents();
        if (!activeEvents.some((activeEvent) => activeEvent.id === eventId)) {
          leaveRef.current();
        }
      } catch (error) {
        console.error('Could not verify attendee room membership:', error);
      }
    }, idleTimeoutMinutes * 60 * 1000);
    return () => window.clearInterval(id);
  }, [eventId, idleTimeoutMinutes]);

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
      {at === 'board' && <BoardScreen event={event} sessions={sessions} />}
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
