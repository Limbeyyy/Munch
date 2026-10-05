import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { RESOURCE_POLL_MS } from '../services/polling';
import { Event, GuestResource, Session } from '../types';
import { OrganizerProvider } from '../organizer/i18n';
import { API_BASE_URL } from '../services/apiConfig';
import { PhoneShell, Section } from '../attendee/pwa/PhoneShell';
import { TranscriptScreen } from '../attendee/pwa/TranscriptScreen';
import { AgendaScreen } from '../attendee/pwa/AgendaScreen';
import { BoardScreen } from '../attendee/pwa/BoardScreen';
import { FilesScreen } from '../attendee/pwa/FilesScreen';

const normalizeGuestSession = (
  session: any,
  eventId: string,
  index: number,
  liveId: string | null,
  liveStartedAt: string | null,
): Session => ({
  ...session,
  event: eventId,
  description: session.description ?? '',
  speaker_name: session.speaker_name ?? '',
  speaker_visibility: 'public',
  duration_minutes: session.duration_minutes ?? 0,
  ends_at: session.ends_at ?? new Date(
    +new Date(session.starts_at)
    + (session.duration_minutes ?? 0) * 60000
  ).toISOString(),
  position: session.position ?? index,
  status: (session.id === liveId
    ? 'live'
    : session.status ?? 'scheduled') as Session['status'],
  started_at: session.id === liveId
    ? liveStartedAt
    : session.started_at ?? null,
  ended_at: session.ended_at ?? null,
  attendance_count: session.attendance_count ?? 0,
  created_at: session.created_at ?? '',
  updated_at: session.updated_at ?? '',
});

/**
 * The event as a guest sees it.
 *
 * Guests use the same phone screens as signed-in attendees; their pass is
 * supplied to those screens' read and write requests instead of an account.
 */
const GuestEventRoom: React.FC = () => {
  const navigate = useNavigate();
  const token = sessionStorage.getItem('guest_token');
  const eventCode = sessionStorage.getItem('guest_event_code') ?? '';
  const [section, setSection] = useState<Section>('transcript');
  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [resources, setResources] = useState<GuestResource[]>([]);
  const [agendaDetailOpen, setAgendaDetailOpen] = useState(false);
  const [photoFolderOpen, setPhotoFolderOpen] = useState(false);
  const lastOnStage = useRef('');

  const passIsDead = useCallback((error: any) => {
    if (error?.response?.status !== 401) return false;
    sessionStorage.clear();
    toast('That event pass is no longer valid. Ask to join again.', {
      icon: '\uD83D\uDD11', duration: 8000,
    });
    navigate('/login');
    return true;
  }, [navigate]);

  const leave = useCallback(async (clearGuestSession = false) => {
    if (token) {
      try {
        await apiClient.guestLeave(token);
      } catch {
        // Best-effort.
      }
    }
    if (clearGuestSession) sessionStorage.clear();
    navigate('/login');
  }, [token, navigate]);

  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const fetchEvent = async () => {
      try {
        const { event: responseEvent } = await apiClient.guestStatus(token);
        if (cancelled) return;
        const current = responseEvent.current_session;
        const nextSessions = (responseEvent.sessions ?? []).map(
          (session: any, index: number) => normalizeGuestSession(
            session,
            responseEvent.id,
            index,
            current?.id ?? null,
            current?.started_at ?? null
          )
        );
        const nextEvent = {
          ...responseEvent,
          description: responseEvent.description ?? '',
          scheduled_end: responseEvent.scheduled_end ?? responseEvent.scheduled_start,
          participant_count: responseEvent.participant_count ?? 0,
          created_at: responseEvent.created_at ?? '',
          updated_at: responseEvent.updated_at ?? '',
          current_session: current,
          sessions: nextSessions,
        } as Event;
        setSessions(nextSessions);
        setEvent(nextEvent);
      } catch (error) {
        passIsDead(error);
      }
    };

    fetchEvent();
    const id = window.setInterval(fetchEvent, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, passIsDead]);

  useEffect(() => {
    if (!token || !eventCode) return;

    const apiUrl = new URL(API_BASE_URL);
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new window.WebSocket(
      `${protocol}//${apiUrl.host}/ws/event/${eventCode}/?guest_token=${encodeURIComponent(token)}`
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
      if (data.type === 'event_ended') {
        toast('The host ended the event', { icon: '👋' });
        leave(true);
      } else if (data.type === 'idle_evicted') {
        sessionStorage.clear();
        toast('You were away, so the room let you go', { icon: '💤' });
        navigate('/login');
      }
    };

    return () => {
      watched.forEach((name) => window.removeEventListener(name, beat));
      document.removeEventListener('visibilitychange', beat);
      socket.close();
    };
  }, [token, eventCode, leave, navigate]);

  const loadResources = useCallback(async () => {
    if (!token) return;
    try {
      setResources(await apiClient.guestResources(token));
    } catch {
      // Files are supplementary; a failed refresh is not worth a toast.
    }
  }, [token]);

  useEffect(() => {
    loadResources();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadResources();
    }, RESOURCE_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadResources]);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(async () => {
      try {
        const { guest, event: currentEvent } = await apiClient.guestStatus(token);
        if (currentEvent?.status === 'ended') {
          toast('The event has ended');
          leave(true);
        } else if (guest.status === 'pending' || guest.status === 'denied') {
          // Only the host taking the admission back, not the room
          // noting where somebody is. `left` is written when the page
          // is closed and by the sweep that lets go of an idle tab,
          // and treating it as a withdrawal threw a guest out of a
          // room they were still sitting in - then marked them gone
          // on the way, so coming back did it again.
          toast('You are no longer in this event');
          leave();
        }
      } catch (error) {
        passIsDead(error);
      }
    }, 15000);
    return () => window.clearInterval(id);
  }, [token, leave, passIsDead]);

  const live = useMemo(
    () => sessions.find((one) => one.status === 'live') ?? null,
    [sessions]
  );
  const onStageTitle = live?.title ?? '';

  useEffect(() => {
    const before = lastOnStage.current;
    lastOnStage.current = onStageTitle;
    if (before && !onStageTitle) {
      toast(`“${before}” has finished. The room stays open.`, {
        icon: '\u2705',
        duration: 4000,
      });
    }
  }, [onStageTitle]);

  if (!event) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-white">
        <p className="text-[14px] text-[#8b90a0]">Loading…</p>
      </div>
    );
  }

  return (
    <OrganizerProvider>
      <PhoneShell
        at={section}
        onGo={setSection}
        eventTitle={event.title}
        hideProfile
        hideSectionHeader={
          (section === 'agenda' && agendaDetailOpen)
          || (section === 'files' && photoFolderOpen)
        }
      >
        {section === 'transcript' && (
          <TranscriptScreen
            event={event}
            live={live}
            onLeave={() => leave()}
            guestToken={token ?? undefined}
          />
        )}
        {section === 'agenda' && (
          <AgendaScreen
            event={event}
            sessions={sessions}
            live={live}
            guestToken={token ?? undefined}
            guestResources={resources}
            onDetailChange={setAgendaDetailOpen}
          />
        )}
        {section === 'board' && (
          <BoardScreen
            event={event}
            sessions={sessions}
            guestToken={token ?? undefined}
          />
        )}
        {section === 'files' && (
          <FilesScreen
            event={event}
            sessions={sessions}
            guestToken={token ?? undefined}
            guestResources={resources}
            onFolderOpenChange={setPhotoFolderOpen}
          />
        )}
      </PhoneShell>
    </OrganizerProvider>
  );
};

export const GuestEventPage: React.FC = () => <GuestEventRoom />;
