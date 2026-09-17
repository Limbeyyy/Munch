import { useEffect, useRef } from 'react';

/**
 * Listen to one event's room from a dashboard.
 *
 * A dashboard is not in the room, so it learned that a event had ended
 * only on its next poll - up to half a minute of showing a session as
 * running that the host had already finished. This opens the same socket
 * the room uses, read-only: nothing is ever sent on it, and the only thing
 * it does with what arrives is tell the caller to re-read.
 *
 * Deliberately narrow. It follows the one event that is live, and only
 * while one is, so an idle dashboard holds no connection at all.
 */
export const useEventPulse = (
  eventCode: string | null | undefined,
  onChange: () => void
) => {
  const changed = useRef(onChange);

  useEffect(() => { changed.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!eventCode) return;

    const apiUrl = new URL(
      process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1'
    );
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const socket = new WebSocket(
      `${protocol}//${apiUrl.host}/ws/event/${eventCode}/` +
        `?token=${encodeURIComponent(token)}`
    );

    socket.onmessage = (message) => {
      let data: any;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }

      // What a dashboard cares about: the running order moving on, the
      // room filling or emptying, and the event finishing. Chat is the
      // room's business and is ignored here.
      const worthReading =
        data.type === 'event_ended' ||
        data.type === 'event_started' ||
        data.type === 'state_update' ||
        data.type === 'roster_update' ||
        data.type === 'attendance_update';

      if (worthReading) changed.current();
    };

    return () => {
      // Closing a socket that is still connecting throws in some browsers.
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else socket.onopen = () => socket.close();
    };
  }, [eventCode]);
};
