import React, { useMemo } from 'react';
import { Event } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useOrganizer } from '../../organizer/i18n';
import { EventCard } from './EventCard';
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

/**
 * Where somebody lands after signing in.
 *
 * Two questions, in the order they are asked: what is coming, and what
 * was I at. Anything running is put at the top of the first, because a
 * person opening this while an event is on is opening it for that.
 */
export const HomeScreen: React.FC<{
  events: Event[];
  onOpen: (event: Event) => void;
  onSeeAll: () => void;
}> = ({ events, onOpen, onSeeAll }) => {
  const { t } = useOrganizer();
  const { user } = useAuthStore();

  const { ahead, behind } = useMemo(() => {
    const byStart = (a: Event, b: Event) =>
      +new Date(a.scheduled_start) - +new Date(b.scheduled_start);

    const live = events.filter((one) => stateOf(one) === 'live').sort(byStart);
    const upcoming = events
      .filter((one) => stateOf(one) === 'upcoming')
      .sort(byStart);
    const done = events
      .filter((one) => stateOf(one) === 'completed')
      .sort((a, b) => -byStart(a, b));

    return { ahead: [...live, ...upcoming], behind: done };
  }, [events]);

  return (
    <div className="pb-4">
      <div
        className="mx-4 mt-3 rounded-[14px] bg-[#12386e] text-white px-5 py-5"
        style={{ marginTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <p className="text-[13px] text-white/80">{greeting(t)}</p>
        <p className="pt-0.5 text-[24px] font-semibold leading-tight">
          {firstName(user) || t({ ne: 'नमस्ते', en: 'Hello' })} 👋
        </p>
        <p className="pt-1.5 text-[13px] text-white/80">
          {t({
            ne: 'आफ्ना कार्यक्रमको जानकारी यहीँ।',
            en: 'Stay up to date with your events.',
          })}
        </p>
      </div>

      <section className="pt-5">
        <h2 className="px-4 text-[12px] font-semibold tracking-[.08em]
          text-[#8b90a0] uppercase">
          {t({ ne: 'आउँदै', en: 'Upcoming' })}
        </h2>
        {ahead.length === 0 ? (
          <p className="px-4 pt-3 text-[13px] text-[#8b90a0]">
            {t({ ne: 'आउँदो कार्यक्रम छैन।', en: 'Nothing coming up.' })}
          </p>
        ) : (
          <div className="px-4 pt-3 flex flex-col gap-3">
            {ahead.slice(0, 2).map((one) => (
              <EventCard key={one.id} event={one} onOpen={() => onOpen(one)} />
            ))}
          </div>
        )}
      </section>

      <section className="pt-6">
        <div className="px-4 flex items-baseline gap-3">
          <h2 className="flex-1 text-[12px] font-semibold tracking-[.08em]
            text-[#8b90a0] uppercase">
            {t({ ne: 'भर्खरै सहभागी', en: 'Recently attended' })}
          </h2>
          {behind.length > 0 && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-[13px] font-medium text-[#2440c9]"
            >
              {t({ ne: 'सबै हेर्नुहोस्', en: 'View all' })}
            </button>
          )}
        </div>
        {behind.length === 0 ? (
          <p className="px-4 pt-3 text-[13px] text-[#8b90a0]">
            {t({
              ne: 'तपाईं अझै कुनै कार्यक्रममा हुनुभएको छैन।',
              en: 'You have not been to one yet.',
            })}
          </p>
        ) : (
          <div className="px-4 pt-3 flex flex-col gap-3">
            {behind.slice(0, 3).map((one) => (
              <EventCard key={one.id} event={one} onOpen={() => onOpen(one)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
