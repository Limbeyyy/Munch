import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import { onDesktop } from '../services/device';
import { useAuthStore } from '../store/authStore';
import { OrganizerProvider } from '../organizer/i18n';
import type { UserRoles } from '../types';

/** Where a returning person's last choice is kept. */
const CHOICE_KEY = 'manch.portal';
/** Set the moment a sign-in completes, and read once on the way in. */
const FRESH_KEY = 'manch.justSignedIn';

export type Portal = 'host' | 'attendee';

const PATH: Record<Portal, string> = { host: '/organizer', attendee: '/app' };

/** Remember which side of the house someone works on, so we stop asking. */
export const rememberPortal = (portal: Portal) => {
  try {
    window.localStorage.setItem(CHOICE_KEY, portal);
  } catch {
    // A browser that refuses storage just means we decide again next time.
  }
};

export const forgetPortal = () => {
  try {
    window.localStorage.removeItem(CHOICE_KEY);
  } catch {
    /* nothing to undo */
  }
};

/**
 * Say that somebody has just signed in.
 *
 * Signing in is the moment the portal is decided, even for somebody who
 * only has one - they may be about to take up the other. Ordinary
 * navigation back to "/" should not decide again, which is why this is a
 * one-shot mark rather than something read from the session.
 */
export const markFreshSignIn = () => {
  try {
    window.sessionStorage.setItem(FRESH_KEY, '1');
  } catch {
    // Without storage the arrival simply follows the usual rules.
  }
};

/** The decision has been made, so the mark has done its job. */
const clearFreshSignIn = () => {
  try {
    window.sessionStorage.removeItem(FRESH_KEY);
  } catch {
    /* nothing to undo */
  }
};

/*
 * Nothing reads the remembered portal any more.
 *
 * It is still written, because the two portals are still two places and
 * knowing which somebody last worked in may matter again. It is no
 * longer consulted on the way in: the device decides that, and a
 * preference the routes would immediately overturn is not a preference.
 */

/**
 * Whether this is a machine somebody sits at.
 *
 * Kept under this name because it is what this module's callers and
 * their tests already say; the answer itself now comes from the one
 * place that decides it, so the routes and this redirect cannot
 * disagree about what somebody is holding.
 */
export const looksLikeDesktop = (): boolean => onDesktop();

/**
 * Which portal this arrival should land in.
 *
 * At a desk, the host portal - and if they are not a host yet, they
 * become one. Signing in from a laptop is taken as saying you are
 * here to run something, which is what the free trial is for.
 *
 * On a phone, the attendee app, because following a programme is what
 * a phone is for. Here the device cannot grant anything: somebody who
 * only hosts goes to the host portal whatever they are holding,
 * because the alternative is a portal with nothing in it.
 */
export const portalFor = (roles: UserRoles, desktop: boolean): Portal => {
  // The device decides, both ways. It used to decide only one: a phone
  // sent somebody who hosts and nothing else to the host portal, on the
  // reasoning that the attendee app would be empty for them. But the
  // host portal is drawn for a desk, so what they actually got was a
  // dashboard they could not use - and now that /organizer turns a
  // phone away, landing them there would be a redirect loop.
  if (desktop) return 'host';
  return 'attendee';
};

const Loading: React.FC = () => (
  <div className="min-h-screen bg-page grid place-items-center">
    <p className="text-[#6E7C8E] font-sans">Loading…</p>
  </div>
);

/**
 * Sends people to the portal that fits what they do here.
 *
 * There used to be a card asking which. It was a question almost nobody
 * needed: the device already says it. Somebody at a desk is nearly
 * always there to run something, somebody on a phone to follow one, and
 * the few who are both can switch once they are inside - which is
 * remembered, so they are not sent back.
 */
const HomeRedirectInner: React.FC = () => {
  const [target, setTarget] = useState<string | null>(null);
  const userId = useAuthStore((state) => state.user?.id);

  const settle = useCallback((portal: Portal, destination = PATH[portal]) => {
    clearFreshSignIn();
    rememberPortal(portal);
    setTarget(destination);
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .getMyRoles()
      .then(async (found) => {
        if (cancelled) return;

        /*
         * The device, and only the device.
         *
         * A remembered choice used to win on an ordinary visit, which
         * meant somebody who had once picked the attendee app was sent
         * to /app from their laptop ever after. /app now turns a laptop
         * away, so that preference would bounce them straight back -
         * and a preference that cannot be honoured is not one.
         */
        const desktop = looksLikeDesktop();
        const portal: Portal = portalFor(found, desktop);

        let active: Awaited<ReturnType<typeof apiClient.getActiveEvents>> = [];
        try {
          active = await apiClient.getActiveEvents();
        } catch {
          // A room lookup must not prevent somebody from reaching a portal.
        }

        let preferredCode = '';
        try {
          preferredCode = sessionStorage.getItem('manch.pending_live_event') ?? '';
          sessionStorage.removeItem('manch.pending_live_event');
        } catch {
          // Continue with the active room list.
        }
        const preferred = active.find(
          (event) => event.code.toUpperCase() === preferredCode.toUpperCase()
        );
        const live = preferred
          ?? active.find((event) => String(event.host?.id ?? '') === String(userId ?? ''))
          ?? active[0];

        if (live) {
          if (desktop && String(live.host?.id ?? '') === String(userId ?? '')) {
            if (!cancelled) settle('host', `/event/${live.code}`);
          } else if (!desktop) {
            // A phone goes to the app, which finds the running event
            // itself. The host's room is drawn for a desk.
            try {
              sessionStorage.setItem('manch.pending_live_event', live.code);
            } catch {
              // The attendee room will select the first live event.
            }
            if (!cancelled) settle('attendee');
          } else if (found.portals.includes('attendee')) {
            try {
              sessionStorage.setItem('manch.pending_live_event', live.code);
            } catch {
              // The attendee room will select the first live event.
            }
            if (!cancelled) settle('attendee');
          } else if (!cancelled) {
            settle(portal, `/event/${live.code}`);
          }
          return;
        }

        // Sending somebody to the host portal who is not a host yet has
        // to actually make them one, or they arrive at a locked door.
        if (portal === 'host' && !found.is_host) {
          try {
            await apiClient.startHosting();
          } catch {
            // The trial could not be opened, so the host side has
            // nothing to show. The attendee app explains how to join.
            if (!cancelled) settle('attendee');
            return;
          }
        }

        if (!cancelled) settle(portal);
      })
      .catch(() => {
        // Cannot tell, so send them to the attendee app, which is the safer
        // default: it explains how to join rather than assuming they run things.
        if (!cancelled) setTarget('/app');
      });

    return () => {
      cancelled = true;
    };
  }, [settle, userId]);

  if (target) return <Navigate to={target} replace />;
  return <Loading />;
};

export const HomeRedirect: React.FC = () => (
  <OrganizerProvider>
    <HomeRedirectInner />
  </OrganizerProvider>
);
