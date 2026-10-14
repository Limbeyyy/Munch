import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { Pair, useOrganizer } from './i18n';

/**
 * What a free account is told, wherever it is standing.
 *
 * Two reminders, both aimed at the same place: a line across the top of
 * every screen, and a card at the foot of the rail. They are deliberately
 * quiet about anything else - a host is here to run a day, not to be sold
 * to - but they are on every screen because a limit reached halfway
 * through building a programme is worse than a line read on the way in.
 *
 * Neither appears on the billing screen. Somebody already reading the
 * plans does not need to be sent to the plans.
 */

/** Whether this account has paid, once the server has said. */
export const usePaidPlan = (): boolean | null => {
  const [paid, setPaid] = useState<boolean | null>(null);

  useEffect(() => {
    let dropped = false;
    // Optional-called: this runs inside the shell, which several tests
    // render against a cut-down client that has no roles endpoint on it.
    Promise.resolve(apiClient.getMyRoles?.())
      .then((roles) => {
        if (dropped || !roles) return;
        setPaid(Boolean(roles.plan?.paid));
      })
      .catch(() => undefined);
    return () => { dropped = true; };
  }, []);

  return paid;
};

const SAYS: Pair = {
  ne: 'तपाईं अहिले निःशुल्क योजनामा हुनुहुन्छ। मन्चका सबै सुविधा चलाउन प्रो संस्करणमा जानुहोस्।',
  en: 'You are using free plan as of now. To use the manch feature fully, '
    + 'please upgrade to pro version.',
};

const NOW: Pair = { ne: 'अहिले नै अपग्रेड गर्नुहोस्!', en: 'Upgrade Now!' };

/**
 * The line across the top of the page.
 *
 * Underneath the header rather than inside it, so it scrolls away with
 * the page: it is a standing fact about the account, not a control, and
 * a sticky one would cost a row of screen on every screen all day.
 */
export const FreePlanBanner: React.FC<{ onUpgrade: () => void }> = ({ onUpgrade }) => {
  const { t } = useOrganizer();
  return (
    <div
      role="status"
      className="bg-white border-b-[0.5px] border-black/10 px-5 sm:px-7 py-2
        flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <span className="text-[12.5px] italic underline text-[#c2410c]">
        {t(SAYS)}
      </span>
      <button
        type="button"
        onClick={onUpgrade}
        className="text-[12.5px] italic underline text-[#1447e6] hover:text-navy-800"
      >
        {t(NOW)}
      </button>
    </div>
  );
};

/** The sparkle on the rail's button, as the design draws it. */
const Sparkle: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z" />
    <path d="M19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6L19 15z" />
  </svg>
);

/**
 * The card at the foot of the rail.
 *
 * Above the mark rather than below it: the mark closes the rail, and
 * anything under it reads as a footnote to the product rather than a
 * thing to press.
 */
export const GetProCard: React.FC<{ onUpgrade: () => void }> = ({ onUpgrade }) => {
  const { t } = useOrganizer();
  return (
    <div className="mt-auto pt-4">
      <div className="bg-navy-800 rounded-[12px] p-3 flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-white leading-5">
          {t({ ne: 'प्रो पहुँच लिनुहोस्', en: 'Get Pro Access' })}
        </p>
        <p className="text-[11px] text-white/70 leading-4">
          {t({
            ne: 'उन्नत उपकरणमा पहुँच पाउनुहोस्, अपग्रेड गरेर आफ्नो अनुभव बढाउनुहोस्।',
            en: 'Get access to advanced tools, upgrade and maximize your experience',
          })}
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className="mt-2 w-full bg-white rounded-[8px] py-1.5 flex items-center
            justify-center gap-1.5 text-[12.5px] font-medium text-navy-800
            hover:bg-white/90"
        >
          <Sparkle />
          {t({ ne: 'अपग्रेड', en: 'Upgrade' })}
        </button>
      </div>
    </div>
  );
};
