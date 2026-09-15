import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ChatSettings } from '../types';
import { useOrganizer } from './i18n';
import { Switch } from './ui';

/**
 * Whether the room may talk, and whether it may talk privately.
 *
 * Lives beside the live controls rather than in settings: it is a thing
 * the host does to a session that is running - closing the chat when a
 * speaker needs the floor, opening direct messages for a question round -
 * and not a preference set once and forgotten. A setting that only ever
 * matters while something is on stage belongs where the stage is.
 */
export const ChatRules: React.FC<{
  meetingId: string;
  /** The meeting room is dark; the dashboards are not. */
  tone?: 'light' | 'dark';
}> = ({ meetingId, tone = 'light' }) => {
  const { t } = useOrganizer();
  const dark = tone === 'dark';
  const [settings, setSettings] = useState<ChatSettings>({
    chat_enabled: false,
    direct_messages_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await apiClient.getChatSettings(meetingId));
    } catch {
      // The switches simply stay as they were.
    } finally {
      setLoaded(true);
    }
  }, [meetingId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (patch: Partial<ChatSettings>) => {
    try {
      setSaving(true);
      setSettings(await apiClient.updateChatSettings(meetingId, patch));
      toast.success(t({ ne: 'सेभ भयो', en: 'Saved' }));
    } catch {
      toast.error(t({ ne: 'सेभ हुन सकेन', en: 'Could not save' }));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className={`flex flex-col gap-3.5 ${dark ? 'text-white' : ''}`}>
      {/* The room itself is not a thing to be opened any more: there is no
          room-wide thread, so everything written in it goes to one person
          and the only rule worth a switch is the one below. */}
      <Switch
        on={settings.direct_messages_enabled}
        disabled={saving}
        onToggle={() =>
          toggle({ direct_messages_enabled: !settings.direct_messages_enabled })
        }
        label={{ ne: 'सिधा सन्देश लिने', en: 'Accept direct messages' }}
        hint={{
          ne: 'बन्द राखे कोठा देखिन्छ तर कसैले पठाउन पाउँदैन। सहभागीले पठाएको सन्देश तपाईंको स्वीकृतिपछि मात्र पुग्छ।',
          en: 'With this off the room is still there to read, but nobody can send. What an attendee writes reaches its reader only after you approve it.',
        }}
      />
    </div>
  );
};
