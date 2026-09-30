import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiClient } from '../services/api';
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

/**
 * Whether this arrival follows a sign-in.
 *
 * A pure read. Clearing the mark here instead would make the answer depend
 * on how many times the effect happens to run, and React runs them twice
 * in development. The mark is spent when the decision is made, in
 * `settle`, not when it is taken.
 */
const isFreshSignIn = (): boolean => {
  try {
    return window.sessionStorage.getItem(FRESH_KEY) === '1';
  } catch {
    return false;
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

const rememberedPortal = (): Portal | null => {
  try {
    const saved = window.localStorage.getItem(CHOICE_KEY);
    return saved === 'host' || saved === 'attendee' ? saved : null;
  } catch {
    return null;
  }
};

/**
 * Whether this is a machine somebody sits at.
 *
 * A mouse is what actually separates a desk from a hand: a pointer fine
 * enough to aim and able to hover. Screen width is the wrong question -
 * a narrowed window on a laptop is still a laptop, and a tablet held in
 * landscape is still not one. A touchscreen laptop reports a fine
 * primary pointer, which is the answer we want from it.
 *
 * The user agent is only the fallback, for a browser too old to answer.
 */
export const looksLikeDesktop = (): boolean => {
  try {
    const fine = window.matchMedia?.('(pointer: fine)');
    const hovers = window.matchMedia?.('(hover: hover)');
    if (fine && hovers) return fine.matches && hovers.matches;
  } catch {
    // Fall through to the user agent.
  }
  return !/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(
    window.navigator?.userAgent ?? ''
  );
};

/**
 * Which portal this arrival should land in.
 *
 * The device answers first, because it is the better guess about what
 * somebody is here to do: running a programme is desk work - tables,
 * forms, a rail down the side - and following one is a thing done
 * standing in a hall. But the device cannot grant a role. Somebody who
 * only holds one of them goes there whatever they are holding, because
 * the alternative is landing them in a portal with nothing in it.
 */
export const portalFor = (roles: UserRoles, desktop: boolean): Portal => {
  const wanted: Portal = desktop ? 'host' : 'attendee';
  if (roles.portals.includes(wanted)) return wanted;
  if (roles.portals.length > 0) return roles.portals[0] as Portal;
  // Neither yet. On a desk that means hosting, which is the only thing
  // a new account can actually do; on a phone it means the attendee app,
  // which at least explains how to join with a code.
  return wanted;
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

  const settle = useCallback((portal: Portal) => {
    clearFreshSignIn();
    rememberPortal(portal);
    setTarget(PATH[portal]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const justSignedIn = isFreshSignIn();

    apiClient
      .getMyRoles()
      .then(async (found) => {
        if (cancelled) return;

        // Anything other than a fresh sign-in follows what they last
        // said, while it is still true of them: somebody who switched
        // portals should not be sent back on the next visit.
        if (!justSignedIn) {
          const saved = rememberedPortal();
          if (saved && found.portals.includes(saved)) {
            setTarget(PATH[saved]);
            return;
          }
        }

        const portal = portalFor(found, looksLikeDesktop());

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
  }, [settle]);

  if (target) return <Navigate to={target} replace />;
  return <Loading />;
};

export const HomeRedirect: React.FC = () => (
  <OrganizerProvider>
    <HomeRedirectInner />
  </OrganizerProvider>
);
