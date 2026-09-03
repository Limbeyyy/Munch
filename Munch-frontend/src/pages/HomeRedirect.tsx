import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiClient } from '../services/api';

/**
 * Sends people to the app that fits what they do here.
 *
 * Somebody who runs a programme lands in the organizer panel; everybody
 * else lands in the attendee app. Both carry a link to the other, so the
 * choice is a starting point rather than a lock.
 */
export const HomeRedirect: React.FC = () => {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listEvents()
      .then((events) => {
        if (!cancelled) setTarget(events.length > 0 ? '/organizer' : '/app');
      })
      .catch(() => {
        // Cannot tell, so send them to the attendee app, which is the safer
        // default: it explains how to join rather than assuming they run things.
        if (!cancelled) setTarget('/app');
      });
    return () => { cancelled = true; };
  }, []);

  if (!target) {
    return (
      <div className="min-h-screen bg-cream grid place-items-center">
        <p className="text-[#6E7C8E] font-sans">Loading…</p>
      </div>
    );
  }
  return <Navigate to={target} replace />;
};
