import React, { useMemo } from 'react';
import { Event } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useOrganizer } from '../../organizer/i18n';
import {
  CompletedEventCard, LiveEventCard, UpcomingEventCard,
} from './EventCard';
import { stateOf } from './HomeShell';

/** The first name, which is what a greeting uses. */
const firstName = (user: {
  first_name?: string; last_name?: string; email?: string;
} | null) => {
  if (!user) return '';
  if (user.first_name?.trim()) return user.first_name.trim();
  const email = user.email ?? '';
  return email.split('@')[0] || '';
};

/** Morning, afternoon or evening, by the reader's own clock. */
const greeting = (t: (pair: { ne: string; en: string }) => string) => {
  const hour = new Date().getHours();
  if (hour < 12) return t({ ne: 'शुभ प्रभात,', en: 'Good morning,' });
  if (hour < 17) return t({ ne: 'शुभ दिन,', en: 'Good afternoon,' });
  return t({ ne: 'शुभ सन्ध्या,', en: 'Good evening,' });
};

const Head: React.FC<{
  title: string;
  action?: { label: string; onGo: () => void };
}> = ({ title, action }) => (
  <div className="flex items-center justify-between gap-3">
    <h2 className="text-[13px] font-bold uppercase tracking-[0.78px]
      leading-[19.5px] text-[#64748b]">
      {title}
    </h2>
    {action && (
      <button
        type="button"
        onClick={action.onGo}
        className="text-[13px] font-semibold leading-[19.5px] text-[#2563eb]"
      >
        {action.label}
      </button>
    )}
  </div>
);

/**
 * Where somebody lands after signing in.
 *
 * Three questions in the order they get asked: is anything on now,
 * what is coming, and what was I at. Live is its own section rather
 * than the top of Upcoming, because the answer to it is not "read
 * about this later" but "go in".
 */
export const HomeScreen: React.FC<{
  events: Event[];
  onOpen: (event: Event) => void;
  onSeeAll: () => void;
  onJoinLive?: (event: Event) => void;
}> = ({ events, onOpen, onSeeAll, onJoinLive }) => {
  const { t } = useOrganizer();
  const { user } = useAuthStore();

  const { live, ahead, behind } = useMemo(() => {
    const byStart = (a: Event, b: Event) =>
      +new Date(a.scheduled_start) - +new Date(b.scheduled_start);

    return {
      live: events.filter((one) => stateOf(one) === 'live').sort(byStart),
      ahead: events.filter((one) => stateOf(one) === 'upcoming').sort(byStart),
      behind: events
        .filter((one) => stateOf(one) === 'completed')
        .sort((a, b) => -byStart(a, b)),
    };
  }, [events]);

  return (
    <div className="bg-white">
      <div
        className="mx-4 rounded-[18px] bg-[#12386e] text-white px-4 py-3"
        style={{ marginTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <p className="text-[13px] leading-[19.5px] text-[#f3f3f3]">
          {greeting(t)}
        </p>
        <p className="pt-0.5 text-[26px] font-extrabold leading-[31.2px]">
          {firstName(user) || t({ ne: 'नमस्ते', en: 'Hello' })} 👋
        </p>
        <p className="pt-1 text-[14px] leading-[21px]">
          {t({
            ne: 'आफ्ना कार्यक्रमको जानकारी यहीँ।',
            en: 'Stay up to date with your events.',
          })}
        </p>
      </div>

      <div className="px-4 pt-6 pb-6 flex flex-col gap-6">
        {live.length > 0 && (
          <section>
            <Head title={t({ ne: 'प्रत्यक्ष', en: 'Live' })} />
            <div className="pt-3 flex flex-col gap-3">
              {live.map((one) => (
                <LiveEventCard
                  key={one.id}
                  event={one}
                  onJoin={() => (onJoinLive ?? onOpen)(one)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <Head title={t({ ne: 'आउँदै', en: 'Upcoming' })} />
          {ahead.length === 0 ? (
            <p className="pt-3 text-[13px] text-[#94a3b8]">
              {t({ ne: 'आउँदो कार्यक्रम छैन।', en: 'Nothing coming up.' })}
            </p>
          ) : (
            <div className="pt-3 flex flex-col gap-3">
              {ahead.slice(0, 2).map((one) => (
                <UpcomingEventCard
                  key={one.id}
                  event={one}
                  onOpen={() => onOpen(one)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <Head
            title={t({ ne: 'भर्खरै सहभागी', en: 'Recently attended' })}
            action={behind.length > 0
              ? { label: t({ ne: 'सबै हेर्नुहोस्', en: 'View all' }), onGo: onSeeAll }
              : undefined}
          />
          {behind.length === 0 ? (
            <p className="pt-3 text-[13px] text-[#94a3b8]">
              {t({
                ne: 'तपाईं अझै कुनै कार्यक्रममा हुनुभएको छैन।',
                en: 'You have not been to one yet.',
              })}
            </p>
          ) : (
            <div className="pt-3 flex flex-col gap-3">
              {behind.slice(0, 3).map((one) => (
                <CompletedEventCard
                  key={one.id}
                  event={one}
                  onOpen={() => onOpen(one)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
