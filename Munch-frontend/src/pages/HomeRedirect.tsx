import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { OrganizerProvider, useOrganizer } from '../organizer/i18n';
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
    // A browser that refuses storage just means we ask again next time.
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
 * Signing in is the moment to ask which side of the house they want, even
 * for somebody who only has one - they may be about to take up the other.
 * Ordinary navigation back to "/" should not ask again, which is why this
 * is a one-shot mark rather than something read from the session.
 */
export const markFreshSignIn = () => {
  try {
    window.sessionStorage.setItem(FRESH_KEY, '1');
  } catch {
    // Without storage the chooser simply follows the usual rules.
  }
};

/**
 * Whether this arrival follows a sign-in.
 *
 * A pure read. Clearing the mark here instead would make the answer depend
 * on how many times the effect happens to run, and React runs them twice
 * in development - which is exactly how the chooser came to be mounted and
 * then immediately replaced. The mark is spent when the question is
 * answered, in `settle`, not when it is asked.
 */
const isFreshSignIn = (): boolean => {
  try {
    return window.sessionStorage.getItem(FRESH_KEY) === '1';
  } catch {
    return false;
  }
};

/** The question has been answered, so the mark has done its job. */
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

const Loading: React.FC = () => (
  <div className="min-h-screen bg-cream grid place-items-center">
    <p className="text-[#6E7C8E] font-sans">Loading…</p>
  </div>
);

/**
 * The card offered after signing in, when the answer is not obvious.
 *
 * Somebody can genuinely be both — an organizer is often on another
 * department's invitation list — so this asks rather than guesses. Someone
 * who is neither yet is still offered hosting: the free trial is how a
 * programme gets started at all.
 */
const Chooser: React.FC<{
  roles: UserRoles;
  onPick: (portal: Portal) => void;
}> = ({ roles, onPick }) => {
  const { t } = useOrganizer();
  const [busy, setBusy] = useState(false);

  const pickHost = async () => {
    if (roles.is_host) {
      onPick('host');
      return;
    }
    setBusy(true);
    try {
      await apiClient.startHosting();
      onPick('host');
    } catch {
      toast.error(t({ ne: 'सुरु गर्न सकिएन', en: 'Could not start hosting' }));
      setBusy(false);
    }
  };

  const trial = roles.plan && !roles.plan.paid;

  return (
    <div className="min-h-screen bg-cream grid place-items-center p-6 font-sans">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-navy-900">
          {t({ ne: 'तपाईं कसरी प्रवेश गर्नुहुन्छ?', en: 'How are you signing in?' })}
        </h1>
        <p className="mt-1 text-sm text-[#6E7C8E]">
          {t({
            ne: 'पछि जुनसुकै बेला अर्को प्यानलमा जान सकिन्छ।',
            en: 'You can move to the other panel at any time.',
          })}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={pickHost}
            className="text-left rounded-2xl border border-navy-900/10 bg-white p-5 hover:border-amber-500 hover:shadow-md transition disabled:opacity-60"
          >
            <div className="text-lg font-semibold text-navy-900">
              {t({ ne: 'आयोजकको रूपमा', en: 'Sign in as host' })}
            </div>
            <p className="mt-1 text-sm text-[#6E7C8E]">
              {t({
                ne: 'कार्यक्रम, बैठक र सत्रहरू सञ्चालन गर्नुहोस्।',
                en: 'Run events, meetings and the sessions inside them.',
              })}
            </p>
            {!roles.is_host && (
              <p className="mt-3 text-xs text-navy-700">
                {t({
                  ne: 'निःशुल्क परीक्षण: २ कार्यक्रम, प्रत्येकमा २ बैठक, प्रत्येकमा २ सत्र।',
                  en: 'Free trial: 2 events, 2 meetings each, 2 sessions each.',
                })}
              </p>
            )}
            {roles.is_host && roles.plan && (
              <p className="mt-3 text-xs text-navy-700">
                {roles.plan.name}
                {trial
                  ? ` · ${t({ ne: 'निःशुल्क परीक्षण', en: 'free trial' })}`
                  : ''}
              </p>
            )}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onPick('attendee')}
            className="text-left rounded-2xl border border-navy-900/10 bg-white p-5 hover:border-amber-500 hover:shadow-md transition disabled:opacity-60"
          >
            <div className="text-lg font-semibold text-navy-900">
              {t({ ne: 'सहभागीको रूपमा', en: 'Sign in as attendee' })}
            </div>
            <p className="mt-1 text-sm text-[#6E7C8E]">
              {t({
                ne: 'तपाईंलाई निम्त्याइएका बैठक र सत्रहरू हेर्नुहोस्।',
                en: 'See the meetings and sessions you have been asked to.',
              })}
            </p>
            {!roles.is_attendee && (
              <p className="mt-3 text-xs text-[#6E7C8E]">
                {t({
                  ne: 'अहिलेसम्म कुनै निमन्त्रणा छैन।',
                  en: 'No invitations on your name yet.',
                })}
              </p>
            )}
          </button>
        </div>

        <p className="mt-6 text-xs text-[#6E7C8E]">
          {t({
            ne: 'खाता नभएका पाहुनाहरू बैठक कोड वा QR मार्फत सामेल हुन्छन्।',
            en: 'Guests without an account join by meeting code or QR instead.',
          })}
        </p>
      </div>
    </div>
  );
};

/**
 * Sends people to the portal that fits what they do here.
 *
 * The database decides what is on offer — host standing, invitations, or
 * both — and the person decides between them. That choice is remembered so
 * the question is asked once, not on every visit.
 */
const HomeRedirectInner: React.FC = () => {
  const [roles, setRoles] = useState<UserRoles | null>(null);
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
      .then((found) => {
        if (cancelled) return;

        // Straight off a sign-in, always ask - even of somebody who only
        // holds one role today, since choosing host is how they take up
        // the other. Every other arrival here follows what they last said.
        if (justSignedIn) {
          setRoles(found);
          return;
        }

        const saved = rememberedPortal();
        // A remembered choice only holds while it is still true of them.
        if (saved && found.portals.includes(saved)) {
          setTarget(PATH[saved]);
          return;
        }
        if (found.portals.length === 1) {
          settle(found.portals[0]);
          return;
        }
        setRoles(found);
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
  if (roles) return <Chooser roles={roles} onPick={settle} />;
  return <Loading />;
};

export const HomeRedirect: React.FC = () => (
  <OrganizerProvider>
    <HomeRedirectInner />
  </OrganizerProvider>
);
