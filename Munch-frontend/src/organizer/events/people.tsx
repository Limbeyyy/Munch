import React from 'react';
import { Pair, useOrganizer } from '../i18n';

/*
 * Everybody on an event, on one list.
 *
 * The same pieces draw it wherever it appears - the form that builds an
 * event, and the event opened afterwards - so the two cannot drift into
 * looking like different products.
 */

/** The initials a face falls back to, from a name or failing that an address. */
export const initialsOf = (name: string, email = ''): string => {
  const from = (name || email.split('@')[0] || '?').trim();
  const parts = from.split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : from.slice(0, 2);
  return two.toUpperCase();
};

/** A section label over the list, with an optional link on the right. */
export const PeopleHeading: React.FC<{
  label: Pair;
  action?: { label: Pair; onClick: () => void };
}> = ({ label, action }) => {
  const { t } = useOrganizer();
  return (
    <div className="flex items-center justify-between pt-6 first:pt-0">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.6px] text-faint leading-4">
        {t(label)}
      </h3>
      {action && (
        <button
          onClick={action.onClick}
          className="text-[12px] text-[#155dfc] leading-4 hover:underline"
        >
          {t(action.label)}
        </button>
      )}
    </div>
  );
};

/** One person on the list: a face, who they are, and what may be done. */
export const PersonRow: React.FC<{
  initials: string;
  name: string;
  suffix?: string;
  email: string;
  tag?: string;
  dark?: boolean;
  onRemove?: () => void;
}> = ({ initials, name, suffix, email, tag, dark, onRemove }) => {
  const { t } = useOrganizer();
  return (
    <div className="flex gap-3 items-center pt-5 pb-2">
      <span
        className={`w-8 h-8 rounded-full grid place-items-center flex-none text-[12px]
          font-semibold ${dark ? 'bg-head text-white' : 'bg-line text-body'}`}
        aria-hidden
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-head leading-5 truncate">
          {name}
          {suffix && <span className="font-normal text-faint">{` ${suffix}`}</span>}
        </p>
        <p className="text-[12px] text-subtle leading-4 truncate">{email}</p>
      </div>
      {tag && (
        <span className="bg-[#f3f4f6] text-faint rounded-[4px] px-2 py-0.5
          text-[12px] leading-4 flex-none">
          {tag}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ps-2 text-[12px] text-[#fb2c36] leading-4 flex-none hover:underline"
        >
          {t({ ne: 'हटाउनुहोस्', en: 'Remove' })}
        </button>
      )}
    </div>
  );
};

/** What a section says when there is nobody in it yet. */
export const PeopleEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[13px] text-subtle pt-4 pb-2">{children}</p>
);
