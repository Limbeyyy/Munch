import React, { useMemo, useState } from 'react';
import { Reminder, ReminderPage } from '../types';
import { announcePermission, askToAnnounce, canAnnounce } from './nudges';
import { Pair, useOrganizer } from './i18n';
import { Btn, Chip, Empty, Head, Panel } from './ui';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** How far off something is, in words rather than a raw stamp. */
const away = (iso: string, t: (p: Pair) => string): string => {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins < -90) return t({ ne: 'सकियो', en: 'past' });
  if (mins < 0) return t({ ne: 'भइरहेको', en: 'under way' });
  if (mins < 60) return t({ ne: `${mins} मिनेटमा`, en: `in ${mins} min` });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t({ ne: `${hours} घण्टामा`, en: `in ${hours} h` });
  const days = Math.round(hours / 24);
  return t({ ne: `${days} दिनमा`, en: `in ${days} d` });
};

const Row: React.FC<{ reminder: Reminder; onRead: (id: string) => void }> = ({
  reminder,
  onRead,
}) => {
  const { t } = useOrganizer();
  const isSession = reminder.kind === 'session';
  const title = isSession ? reminder.session_title || reminder.meeting_title : reminder.meeting_title;

  return (
    <li
      className={`flex gap-3 items-start px-3.5 py-3 border-b border-navy-800/[.08] last:border-0
        ${reminder.read ? '' : 'bg-saffron-50/60'}`}
    >
      <span
        aria-hidden
        className={`mt-1 w-1.5 h-1.5 rounded-full flex-none ${
          reminder.read ? 'bg-transparent' : 'bg-saffron-500'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip tone={isSession ? 'default' : 'ok'}>
            {isSession ? t({ ne: 'सत्र', en: 'Session' }) : t({ ne: 'बैठक', en: 'Meeting' })}
          </Chip>
          <h4 className="text-[14px] font-semibold truncate">{title}</h4>
          {!reminder.read && (
            <span className="sr-only">{t({ ne: 'नपढेको', en: 'unread' })}</span>
          )}
        </div>

        <p className="text-[12.5px] text-[#6E7C8E] mt-1">
          {day(reminder.starts_at)} · {clock(reminder.starts_at)}–{clock(reminder.ends_at)}
          {isSession && reminder.session_title ? ` · ${reminder.meeting_title}` : ''}
          {reminder.hall ? ` · ${reminder.hall}` : ''}
          {reminder.speaker_name ? ` · ${reminder.speaker_name}` : ''}
        </p>

        <p className="text-[12px] text-[#6E7C8E] mt-0.5">
          {t({
            ne: `${reminder.lead_minutes} मिनेट अघि सम्झाइन्छ — ${away(reminder.due_at, t)}`,
            en: `Reminds ${reminder.lead_minutes} min before — ${away(reminder.due_at, t)}`,
          })}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1.5 flex-none">
        <a
          href={reminder.calendar_url}
          target="_blank"
          rel="noreferrer"
          className="text-[12.5px] px-2.5 py-1 rounded-lg border border-navy-800/15 hover:bg-navy-800/[.04] whitespace-nowrap"
        >
          {t({ ne: 'गुगल क्यालेन्डरमा', en: 'Add to Google Calendar' })}
        </a>
        {!reminder.read && (
          <Btn sm onClick={() => onRead(reminder.id)}>
            {t({ ne: 'पढेँ', en: 'Mark read' })}
          </Btn>
        )}
      </div>
    </li>
  );
};

type Tab = 'upcoming' | 'all';

/**
 * Everything this person is owed a nudge about, in one list.
 *
 * A meeting is called an hour ahead and each of its sessions a quarter of
 * an hour ahead, so a meeting with four sessions shows five rows here -
 * one for the meeting and one apiece for the sessions, not an hour's
 * warning repeated five times.
 */
export const RemindersView: React.FC<{
  page: ReminderPage | null;
  loading: boolean;
  onRead: (id?: string) => void;
}> = ({ page, loading, onRead }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [permission, setPermission] = useState(announcePermission);

  const shown = useMemo(() => {
    const all = page?.reminders ?? [];
    if (tab === 'all') return all;
    const now = Date.now();
    return all.filter((r) => new Date(r.ends_at).getTime() >= now);
  }, [page, tab]);

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }

  const meetingLead = page?.meeting_lead_minutes ?? 60;
  const sessionLead = page?.session_lead_minutes ?? 15;

  return (
    <>
      <Head
        title={{ ne: 'सूचना र सम्झना', en: 'Notifications & reminders' }}
        lede={{
          ne: `बैठक सुरु हुनु ${num(meetingLead)} मिनेट अघि, र प्रत्येक सत्र सुरु हुनु ${num(sessionLead)} मिनेट अघि।`,
          en: `A meeting is called ${meetingLead} minutes ahead, and each session ${sessionLead} minutes ahead.`,
        }}
      />

      {canAnnounce() && permission !== 'granted' && (
        <div className="mb-3 bg-[#EEF3FA] border border-navy-500/20 rounded-[10px] px-3.5 py-3 flex items-center gap-3 flex-wrap">
          <p className="text-[13px] flex-1 min-w-[220px]">
            {permission === 'denied'
              ? t({
                  ne: 'ब्राउजरले सूचना रोकेको छ। सम्झना यही पानामा र किनारामा देखिन्छ।',
                  en: 'Your browser is blocking alerts. Reminders still appear here and on the rail.',
                })
              : t({
                  ne: 'यो ट्याब खुला रहँदा सम्झना ब्राउजर सूचनाबाट पनि आउन सक्छ।',
                  en: 'Let the browser show these while this tab is open.',
                })}
          </p>
          {permission === 'default' && (
            <Btn
              sm
              onClick={async () => setPermission(await askToAnnounce())}
            >
              {t({ ne: 'सूचना खोल्नुहोस्', en: 'Turn on alerts' })}
            </Btn>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1.5" role="tablist">
          {(
            [
              ['upcoming', { ne: 'आउँदै', en: 'Upcoming' }],
              ['all', { ne: 'सबै', en: 'All' }],
            ] as [Tab, Pair][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`text-[13px] px-3 py-1.5 rounded-lg border ${
                tab === key
                  ? 'border-navy-700 bg-navy-700 text-white'
                  : 'border-navy-800/15 hover:bg-navy-800/[.04]'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {(page?.unread ?? 0) > 0 && (
          <div className="flex items-center gap-2.5">
            <Chip tone="warn">
              {t({
                ne: `${num(page!.unread)} नपढेको`,
                en: `${page!.unread} unread`,
              })}
            </Chip>
            <Btn sm onClick={() => onRead()}>
              {t({ ne: 'सबै पढेँ', en: 'Mark all read' })}
            </Btn>
          </div>
        )}
      </div>

      <Panel>
        {shown.length === 0 ? (
          <Empty>
            {tab === 'upcoming'
              ? t({
                  ne: 'अहिले सम्झाउनु पर्ने कुनै बैठक वा सत्र छैन।',
                  en: 'Nothing coming up to remind you about.',
                })
              : t({ ne: 'कुनै सम्झना छैन।', en: 'No reminders yet.' })}
          </Empty>
        ) : (
          <ul>
            {shown.map((r) => (
              <Row key={r.id} reminder={r} onRead={onRead} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
};
