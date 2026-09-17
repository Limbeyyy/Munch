import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import { GuestStatus } from '../types';
import toast from 'react-hot-toast';

const POLL_MS = 4000;

/**
 * Where a guest waits for the host's decision.
 *
 * The websocket delivers the decision instantly; polling is a fallback for
 * when that connection cannot be established.
 */
export const GuestWaitingPage: React.FC = () => {
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);

  const token = sessionStorage.getItem('guest_token');
  const eventCode = sessionStorage.getItem('guest_event_code');
  const eventTitle = sessionStorage.getItem('guest_event_title') ?? '';
  const guestName = sessionStorage.getItem('guest_name') ?? '';

  const [status, setStatus] = useState<GuestStatus>('pending');

  const handleStatus = useCallback((next: GuestStatus) => {
    setStatus(next);
    if (next === 'admitted') {
      toast.success('The host let you in');
      navigate('/guest/event');
    }
  }, [navigate]);

  useEffect(() => {
    if (!token || !eventCode) {
      navigate('/login');
    }
  }, [token, eventCode, navigate]);

  // Instant path: the host's decision arrives over the socket.
  useEffect(() => {
    if (!token || !eventCode) return;

    const apiUrl = new URL(process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1');
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${apiUrl.host}/ws/event/${eventCode}/?guest_token=${encodeURIComponent(token)}`
    );
    wsRef.current = ws;

    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.type === 'guest_decision') handleStatus(data.status);
    };

    return () => ws.close();
  }, [token, eventCode, handleStatus]);

  /**
   * A pass that is no longer good for anything.
   *
   * A guest's pass belongs to one event and lasts as long as it does.
   * When that event ends everybody in it is forgotten, so the pass stops
   * naming anybody - and a browser still holding one used to sit here
   * retrying a socket that would never open, saying nothing. Better to say
   * it plainly and send them back to the door.
   */
  const passIsDead = useCallback((error: any) => {
    if (error?.response?.status !== 401) return false;
    sessionStorage.clear();
    toast('That event pass is no longer valid. Ask to join again.', {
      icon: '\uD83D\uDD11', duration: 8000,
    });
    navigate('/login');
    return true;
  }, [navigate]);

  // Check once immediately: a decision may already have been made before
  // this screen mounted, and waiting a full poll interval to notice is wrong.
  useEffect(() => {
    if (!token) return;
    apiClient
      .guestStatus(token)
      .then(({ guest }) => {
        if (guest.status !== 'pending') handleStatus(guest.status);
      })
      .catch(passIsDead);
  }, [token, handleStatus, passIsDead]);

  // Fallback path.
  useEffect(() => {
    if (!token || status !== 'pending') return;

    const id = setInterval(async () => {
      try {
        const { guest } = await apiClient.guestStatus(token);
        if (guest.status !== 'pending') handleStatus(guest.status);
      } catch (error) {
        // A failed poll is not a decision - but a pass that names nobody
        // is not going to start naming somebody.
        passIsDead(error);
      }
    }, POLL_MS);

    return () => clearInterval(id);
  }, [token, status, handleStatus, passIsDead]);

  const leave = async () => {
    if (token) {
      try {
        await apiClient.guestLeave(token);
      } catch {
        // Leaving is best-effort.
      }
    }
    sessionStorage.clear();
    navigate('/login');
  };

  if (status === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-lg shadow p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4" aria-hidden="true">&#128683;</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            The host did not admit you
          </h1>
          <p className="text-gray-600 text-sm mb-6">
            You can ask the host directly, then try the event code again.
          </p>
          <button
            onClick={leave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full text-center">
        <div className="flex justify-center mb-6" aria-hidden="true">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          Waiting for the host to let you in
        </h1>
        {eventTitle && (
          <p className="text-gray-700 font-medium mb-1">{eventTitle}</p>
        )}
        <p className="text-gray-500 text-sm mb-6">
          {guestName} &middot; code {eventCode}
        </p>
        <p className="text-gray-600 text-sm mb-6">
          The host can see your name, and will admit you shortly.
        </p>
        <button
          onClick={leave}
          className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 py-2 rounded-lg font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
