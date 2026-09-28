import React from 'react';
import { Event } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useOrganizer } from '../../organizer/i18n';
import { ScreenHead } from './PhoneShell';

/** A readable name from whatever the account actually carries. */
const nameOf = (user: {
  first_name?: string; last_name?: string; email?: string;
} | null) => {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email || '';
};

/**
 * Who this is, which event they are in, and the way out.
 *
 * Deliberately thin. An attendee's account has nothing in it to manage -
 * they were invited to a room, not signed up to a product - so the page
 * says who they are and leaves.
 */
export const ProfileScreen: React.FC<{
  event: Event | null;
  events: Event[];
  onPickEvent: (id: string) => void;
}> = ({ event, events, onPickEvent }) => {
  const { t, lang, setLang } = useOrganizer();
  const { user, logout } = useAuthStore();
  const who = nameOf(user);

  return (
    <div>
      <ScreenHead title={t({ ne: 'प्रोफाइल', en: 'Profile' })} />

      <div className="p-4 flex items-center gap-3">
        <span className="size-14 rounded-full bg-[#12386e] text-white grid
          place-items-center text-[20px] font-semibold flex-none">
          {(who || '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[#111726] truncate">
            {who || t({ ne: 'अतिथि', en: 'Guest' })}
          </p>
          {user?.email && (
            <p className="text-[13px] text-[#8b90a0] truncate">{user.email}</p>
          )}
        </div>
      </div>

      {events.length > 1 && (
        <div className="px-4 pb-4">
          <label
            htmlFor="manch-pwa-event"
            className="block text-[12px] text-[#8b90a0] pb-1.5"
          >
            {t({ ne: 'कुन कार्यक्रम', en: 'Which event' })}
          </label>
          <select
            id="manch-pwa-event"
            value={event?.id ?? ''}
            onChange={(e) => onPickEvent(e.target.value)}
            className="w-full border border-[#e2e5ea] rounded-[10px] px-3 py-2.5
              text-[14px] text-[#111726] bg-white"
          >
            {events.map((one) => (
              <option key={one.id} value={one.id}>{one.title}</option>
            ))}
          </select>
        </div>
      )}

      <div className="px-4 pb-4">
        <p className="text-[12px] text-[#8b90a0] pb-1.5">
          {t({ ne: 'भाषा', en: 'Language' })}
        </p>
        <div className="flex gap-2">
          {([['ne', 'नेपाली'], ['en', 'English']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={lang === id}
              onClick={() => setLang(id)}
              className={`flex-1 rounded-[10px] py-2.5 text-[14px] ${
                lang === id
                  ? 'bg-[#12386e] text-white font-medium'
                  : 'bg-[#f2f3f5] text-[#2b3140]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        <button
          type="button"
          onClick={logout}
          className="w-full border border-[#f0c9c9] text-[#c0392b] rounded-[10px]
            py-3 text-[14px] font-medium"
        >
          {t({ ne: 'बाहिरिनुहोस्', en: 'Sign out' })}
        </button>
      </div>
    </div>
  );
};
