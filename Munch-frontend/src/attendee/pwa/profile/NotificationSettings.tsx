import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../../services/api';
import { NotificationPrefs } from '../../../types';
import { useOrganizer } from '../../../organizer/i18n';
import { errorText } from '../../../organizer/errors';
import { Block, Row, SubHead, Toggle } from './bits';

type Key = keyof NotificationPrefs;

const ALL_ON: NotificationPrefs = {
  event_reminders: true, new_sessions: true, event_updates: true,
  new_files: true, published_summaries: true, email_event_reminders: true,
  email_event_updates: false, email_weekly_digest: false,
};

/**
 * What this person wants to be told about.
 *
 * The host sets how much warning a programme gives; this is the other
 * half of it, and it belongs to the person being told. Each switch is
 * sent on its own the moment it is pressed - a settings screen with a
 * Save button is a settings screen people leave half-changed.
 */
export const NotificationSettings: React.FC<{ onBack: () => void }> = ({
  onBack,
}) => {
  const { t } = useOrganizer();
  const [prefs, setPrefs] = useState<NotificationPrefs>(ALL_ON);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    try {
      setPrefs(await apiClient.getNotificationPrefs());
    } catch {
      // Nothing read means nothing to change yet; the defaults stand.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { read(); }, [read]);

  const set = async (key: Key, on: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    try {
      setPrefs(await apiClient.setNotificationPrefs({ [key]: on }));
    } catch (e) {
      // Put it back rather than leave the switch lying about the answer.
      setPrefs(before);
      toast.error(errorText(e, t({
        ne: 'सेटिङ सुरक्षित भएन', en: 'That setting did not save',
      })));
    }
  };

  const push: { key: Key; title: string; under: string }[] = [
    {
      key: 'event_reminders',
      title: t({ ne: 'कार्यक्रमको सम्झना', en: 'Event reminders' }),
      under: t({
        ne: 'कार्यक्रम सुरु हुनुअघि जानकारी',
        en: 'Notified before your events start',
      }),
    },
    {
      key: 'event_updates',
      title: t({ ne: 'कार्यक्रमका परिवर्तन', en: 'Event updates' }),
      under: t({
        ne: 'तपाईं सहभागी हुने कार्यक्रममा भएका परिवर्तन',
        en: 'Changes to events you attend',
      }),
    },
    {
      key: 'new_sessions',
      title: t({ ne: 'नयाँ सत्र', en: 'New sessions' }),
      under: t({
        ne: 'कार्यसूची अद्यावधिक हुँदा', en: 'When the agenda is updated',
      }),
    },
    {
      key: 'new_files',
      title: t({ ne: 'नयाँ फाइल र सामग्री', en: 'New files & resources' }),
      under: t({
        ne: 'तपाईंसँग फाइल साझा हुँदा', en: 'When files are shared with you',
      }),
    },
    {
      key: 'published_summaries',
      title: t({ ne: 'प्रकाशित सारांश', en: 'Published summaries' }),
      under: t({
        ne: 'सत्रको सारांश तयार हुँदा', en: 'When session summaries are ready',
      }),
    },
  ];

  const email: { key: Key; title: string; under: string }[] = [
    {
      key: 'email_event_reminders',
      title: t({ ne: 'कार्यक्रमको सम्झना', en: 'Event reminders' }),
      under: t({
        ne: 'कार्यक्रम सुरु हुनु २४ घण्टाअघि',
        en: '24 hours before events start',
      }),
    },
    {
      key: 'email_event_updates',
      title: t({ ne: 'कार्यक्रमका परिवर्तन', en: 'Event updates' }),
      under: t({ ne: 'महत्त्वपूर्ण परिवर्तन मात्र', en: 'Important changes only' }),
    },
    {
      key: 'email_weekly_digest',
      title: t({ ne: 'साप्ताहिक सार', en: 'Weekly digest' }),
      under: t({
        ne: 'आउँदा कार्यक्रमहरूको सार',
        en: 'Summary of your upcoming events',
      }),
    },
  ];

  const rows = (list: typeof push) => list.map((one, i) => (
    <Row
      key={one.key}
      title={one.title}
      under={one.under}
      last={i === list.length - 1}
      trail={
        <Toggle
          on={prefs[one.key]}
          label={one.title}
          onChange={(on) => set(one.key, on)}
        />
      }
    />
  ));

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <SubHead title={t({ ne: 'सूचना', en: 'Notifications' })} onBack={onBack} />

      {loading ? (
        <p className="bg-white px-4 py-8 text-center text-[13px] text-[#94a3b8]">
          {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Block label={t({ ne: 'पुश सूचना', en: 'Push notifications' })}>
            {rows(push)}
          </Block>
          <Block label={t({ ne: 'इमेल सूचना', en: 'Email notifications' })}>
            {rows(email)}
          </Block>
        </div>
      )}
    </div>
  );
};
