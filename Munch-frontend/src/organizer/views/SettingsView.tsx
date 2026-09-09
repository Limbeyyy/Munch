import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { SchedulingPrefs } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { forgetSessionGap } from '../sessionGap';
import { Btn, Card, Head, Switch, Tabs } from '../ui';

// Nothing here belongs to one meeting any more: the settings that did
// have gone to the live desk, where a meeting is in front of the host.

/**
 * How the programme runs: its spacing, its reminders, and the hall device.
 *
 * Three things that used to be here have gone where they are actually
 * used. The chat rules are a thing the host does to a session that is
 * running, so they sit with the live controls. Accessibility already has
 * its own button in the header, and the plan its own page - two ways to
 * change one setting is one more than anybody needs, and the second is
 * always the one that goes stale.
 */
export const SettingsView: React.FC = () => {
  const { t } = useOrganizer();
  const [tab, setTab] = useState('schedule');

  return (
    <>
      <Head
        title={{ ne: 'सेटिङ', en: 'Settings' }}
        lede={{
          ne: 'एक पटक मिलाए पछिका सत्रमा पनि यही रहन्छ।',
          en: 'Set once; the next session starts from here.',
        }}
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'schedule', label: { ne: 'तालिका', en: 'Scheduling' } },
          { id: 'notify', label: { ne: 'सूचना', en: 'Notifications' } },
          { id: 'device', label: { ne: 'हलको यन्त्र', en: 'Hall device' } },
        ]}
      />

      {tab === 'schedule' && <SchedulingPanel />}

      {tab === 'notify' && <NotificationPanel />}

      {tab === 'device' && (
        <Card className="max-w-[760px]">
          <h3 className="text-[15px] font-semibold mb-2">
            {t({ ne: 'हलको क्याप्चर यन्त्र', en: 'The hall capture device' })}
          </h3>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            {t({
              ne: 'हलमा राखिएको यन्त्रले आवाज सुन्छ, आफैँ पाठमा बदल्छ, र सर्भरमा पाठ मात्र पठाउँछ। कुनै अडियो वा भिडियो सर्भरमा आउँदैन।',
              en: 'The device in the hall listens, turns speech into text itself, and sends only the text to the server. No audio or video reaches the server.',
            })}
          </p>

          <div className="mt-4 bg-[#EEF3FA] border border-navy-500/20 rounded-[10px] p-3.5">
            <p className="text-[12.5px] text-ink-2 mb-2">
              {t({ ne: 'यन्त्रले यसरी पठाउँछ:', en: 'The device posts like this:' })}
            </p>
            <pre className="bg-navy-900 text-[#CFE0F7] rounded-lg p-3 text-[11.5px] leading-[1.7] overflow-x-auto">
{`POST /api/v1/meetings/<code>/transcription/
Authorization: Bearer <ingest token>

{"text": "…", "language": "ne-NP",
 "speaker_name": "Hall mic", "is_final": true}`}
            </pre>
            <p className="text-[12.5px] text-[#6E7C8E] mt-2">
              {t({
                ne: 'टोकन सर्भरको .env मा TRANSCRIPTION_INGEST_TOKEN बाट सेट हुन्छ।',
                en: 'The token is set on the server as TRANSCRIPTION_INGEST_TOKEN in .env.',
              })}
            </p>
          </div>
        </Card>
      )}

    </>
  );
};

/**
 * What the host is paying for, and how much of it is spent.
 *
 * The three numbers here are the ones a host actually runs into, so they are
 * shown as they are used rather than as a feature list; the pricing page is
 * one click away for whoever needs more room.
 */
/**
 * How much warning this host's programme gives, and whether it gives any.
 *
 * A meeting is called further ahead than a talk inside it, because people
 * travel to the first and walk down a corridor to the second. How much
 * further depends on the event, which is why these are fields rather than
 * the hour and quarter-hour that used to be written into the code.
 */
const NotificationPanel: React.FC = () => {
  const { t, num } = useOrganizer();
  const [prefs, setPrefs] = useState<SchedulingPrefs | null>(null);
  const [meetingLead, setMeetingLead] = useState('');
  const [sessionLead, setSessionLead] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .getSchedulingPrefs()
      .then((found) => {
        setPrefs(found);
        setMeetingLead(String(found.meeting_reminder_minutes));
        setSessionLead(String(found.session_reminder_minutes));
      })
      .catch(() => undefined);
  }, []);

  if (!prefs) {
    return (
      <Card className="max-w-[760px]">
        <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      </Card>
    );
  }

  const most = prefs.maximums.meeting_reminder_minutes;
  const reads = (raw: string) => {
    const n = Number(raw);
    return raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= most ? n : null;
  };
  const wantedMeeting = reads(meetingLead);
  const wantedSession = reads(sessionLead);
  const changed =
    (wantedMeeting !== null && wantedMeeting !== prefs.meeting_reminder_minutes) ||
    (wantedSession !== null && wantedSession !== prefs.session_reminder_minutes);
  const valid = wantedMeeting !== null && wantedSession !== null;

  const send = async (patch: Record<string, number | boolean>) => {
    try {
      setSaving(true);
      const saved = await apiClient.setSchedulingPrefs(patch);
      setPrefs(saved);
      setMeetingLead(String(saved.meeting_reminder_minutes));
      setSessionLead(String(saved.session_reminder_minutes));
      toast.success(t({ ne: 'सेभ भयो', en: 'Saved' }));
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error ?? t({ ne: 'सेभ हुन सकेन', en: 'Could not save' })
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (
    id: string,
    label: Pair,
    hint: Pair,
    value: string,
    onChange: (next: string) => void
  ) => (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium mb-1">
        {t(label)}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={0}
          max={most}
          step={5}
          value={value}
          disabled={!prefs.reminders_enabled}
          onChange={(e) => onChange(e.target.value)}
          className="border border-navy-800/15 rounded-[9px] px-3 py-2 w-[120px] bg-white disabled:opacity-50"
        />
        <span className="text-[13px] text-[#6E7C8E]">
          {t({ ne: 'मिनेट अघि', en: 'minutes before' })}
        </span>
      </div>
      <p className="text-[12.5px] text-[#6E7C8E] mt-1">{t(hint)}</p>
    </div>
  );

  return (
    <Card className="max-w-[760px]">
      <Switch
        on={prefs.reminders_enabled}
        disabled={saving}
        onToggle={() => send({ reminders_enabled: !prefs.reminders_enabled })}
        label={{ ne: 'सूचना पठाउने', en: 'Send reminders' }}
        hint={{
          ne: 'बन्द राखे यो कार्यक्रमबाट कुनै सम्झना जाँदैन।',
          en: 'With this off, this programme sends none at all.',
        }}
      />

      <div className="mt-5 pt-4 border-t border-navy-800/[.08] flex flex-col gap-4">
        {field(
          'manch-meeting-lead',
          { ne: 'बैठकभन्दा अघि', en: 'Before a meeting' },
          {
            ne: 'बैठक सुरु हुनुभन्दा कति अघि सम्झाउने।',
            en: 'How long before a meeting starts everybody is called.',
          },
          meetingLead,
          setMeetingLead
        )}
        {field(
          'manch-session-lead',
          { ne: 'सत्रभन्दा अघि', en: 'Before a session' },
          {
            ne: 'प्रत्येक सत्र सुरु हुनुभन्दा कति अघि सम्झाउने।',
            en: 'How long before each session on the programme.',
          },
          sessionLead,
          setSessionLead
        )}

        <div className="flex items-center gap-2.5 flex-wrap">
          <Btn
            tone="amber"
            disabled={!changed || !valid || saving || !prefs.reminders_enabled}
            onClick={() =>
              send({
                meeting_reminder_minutes: wantedMeeting as number,
                session_reminder_minutes: wantedSession as number,
              })
            }
          >
            {saving ? t({ ne: 'सेभ हुँदै…', en: 'Saving…' }) : t({ ne: 'सेभ', en: 'Save' })}
          </Btn>
          {!valid && (
            <span className="text-[12.5px] text-live">
              {t({
                ne: `० देखि ${num(most)} मिनेटसम्म।`,
                en: `Anything from 0 to ${most} minutes.`,
              })}
            </span>
          )}
        </div>
      </div>

      <p className="text-[12.5px] text-[#6E7C8E] mt-4 pt-3.5 border-t border-navy-800/[.08]">
        {t({
          ne: 'एउटा बैठक र त्यसका चार सत्र भए पाँच सम्झना जान्छन् — बैठकको एउटा, हरेक सत्रको आ-आफ्नै।',
          en: 'A meeting with four sessions sends five reminders: one for the meeting, and one apiece for the sessions.',
        })}
      </p>
    </Card>
  );
};

/**
 * How much room this host leaves between one session and the next.
 *
 * Fifteen minutes was the rule for everybody. A hall that has to be
 * cleared and re-laid needs longer than a panel changing chairs, so the
 * number is theirs - and it is the number the scheduler actually spaces
 * the day by, not a note about intentions.
 */
const SchedulingPanel: React.FC = () => {
  const { t, num } = useOrganizer();
  const [prefs, setPrefs] = useState<SchedulingPrefs | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .getSchedulingPrefs()
      .then((found) => {
        setPrefs(found);
        setDraft(String(found.session_gap_minutes));
      })
      .catch(() => undefined);
  }, []);

  if (!prefs) {
    return (
      <Card className="max-w-[760px]">
        <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      </Card>
    );
  }

  const wanted = Number(draft);
  const valid =
    draft.trim() !== '' &&
    Number.isFinite(wanted) &&
    Number.isInteger(wanted) &&
    wanted >= 0 &&
    wanted <= prefs.max_session_gap_minutes;
  const changed = valid && wanted !== prefs.session_gap_minutes;

  const save = async () => {
    if (!changed) return;
    try {
      setSaving(true);
      const saved = await apiClient.setSessionGap(wanted);
      setPrefs(saved);
      setDraft(String(saved.session_gap_minutes));
      // The agenda and the draft forms hold the old number; tell them.
      forgetSessionGap(saved.session_gap_minutes);
      toast.success(t({ ne: 'सेभ भयो', en: 'Saved' }));
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error ?? t({ ne: 'सेभ हुन सकेन', en: 'Could not save' })
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-[760px]">
      <h3 className="text-[15px] font-semibold mb-1">
        {t({ ne: 'सत्रबीचको अन्तराल', en: 'Interval between sessions' })}
      </h3>
      <p className="text-[13px] text-ink-2 leading-relaxed mb-3.5">
        {t({
          ne: 'एउटा सत्र सकिएपछि अर्को सुरु हुनुअघि कति समय चाहिन्छ। तालिका मिलाउँदा यही अन्तराल राखिन्छ।',
          en: 'How long one session needs after the last before it can begin. The agenda spaces every day by this number.',
        })}
      </p>

      <div className="flex items-end gap-2.5 flex-wrap">
        <div>
          <label
            htmlFor="manch-session-gap"
            className="block text-[12.5px] text-[#6E7C8E] mb-1.5"
          >
            {t({ ne: 'मिनेट', en: 'Minutes' })}
          </label>
          <input
            id="manch-session-gap"
            type="number"
            min={0}
            max={prefs.max_session_gap_minutes}
            step={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby="manch-session-gap-hint"
            className="border border-navy-800/15 rounded-[9px] px-3 py-2 w-[120px] bg-white"
          />
        </div>
        <Btn tone="amber" onClick={save} disabled={!changed || saving}>
          {saving ? t({ ne: 'सेभ हुँदै…', en: 'Saving…' }) : t({ ne: 'सेभ', en: 'Save' })}
        </Btn>
      </div>

      <p id="manch-session-gap-hint" className="text-[12.5px] text-[#6E7C8E] mt-2">
        {!valid
          ? t({
              ne: `० देखि ${num(prefs.max_session_gap_minutes)} मिनेटसम्म राख्न मिल्छ।`,
              en: `Anything from 0 to ${prefs.max_session_gap_minutes} minutes.`,
            })
          : wanted === 0
          ? t({
              ne: 'सत्रहरू लगातार चल्नेछन् — बीचमा खाली समय हुँदैन।',
              en: 'Sessions will run back to back, with no room in between.',
            })
          : t({
              ne: `पूर्वनिर्धारित ${num(prefs.default_session_gap_minutes)} मिनेट।`,
              en: `The default is ${prefs.default_session_gap_minutes} minutes.`,
            })}
      </p>
    </Card>
  );
};
