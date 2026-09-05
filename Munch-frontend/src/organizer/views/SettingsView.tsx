import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Meeting, UserRoles } from '../../types';
import { useOrganizer } from '../i18n';
import { BarRow, Btn, Card, Head, Switch, Tabs } from '../ui';

interface Props { meetings: Meeting[]; }

/** Event-wide preferences: chat rules, accessibility, and where data sits. */
export const SettingsView: React.FC<Props> = ({ meetings }) => {
  const { t, lang, setLang, a11y, setA11y } = useOrganizer();
  const [tab, setTab] = useState('rules');
  const [selected, setSelected] = useState(meetings[0]?.id ?? '');
  const [settings, setSettings] = useState({ chat_enabled: false, direct_messages_enabled: false });
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<UserRoles | null>(null);

  useEffect(() => {
    apiClient.getMyRoles().then(setRoles).catch(() => undefined);
  }, []);

  const meeting = meetings.find((m) => m.id === selected) ?? meetings[0];

  useEffect(() => {
    if (!meeting) return;
    apiClient.getChatSettings(meeting.id).then(setSettings).catch(() => undefined);
  }, [meeting]);

  const toggle = async (patch: Partial<typeof settings>) => {
    if (!meeting) return;
    try {
      setSaving(true);
      setSettings(await apiClient.updateChatSettings(meeting.id, patch));
      toast.success(t({ ne: 'सेभ भयो', en: 'Saved' }));
    } catch {
      toast.error(t({ ne: 'सेभ हुन सकेन', en: 'Could not save' }));
    } finally { setSaving(false); }
  };

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
          { id: 'rules', label: { ne: 'च्याट नियम', en: 'Chat rules' } },
          { id: 'device', label: { ne: 'हलको यन्त्र', en: 'Hall device' } },
          { id: 'acc', label: { ne: 'पहुँच', en: 'Accessibility' } },
          { id: 'plan', label: { ne: 'योजना', en: 'Plan' } },
        ]}
      />

      {tab === 'rules' && (
        <Card className="max-w-[760px]">
          {meetings.length > 1 && (
            <div className="mb-4">
              <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
                {t({ ne: 'कुन सत्र', en: 'Which session' })}
              </label>
              <select
                value={meeting?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
              >
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>{m.title} · {m.meeting_code}</option>
                ))}
              </select>
            </div>
          )}

          {!meeting ? (
            <p className="text-[12.5px] text-[#6E7C8E]">
              {t({ ne: 'पहिले एउटा सत्र बनाउनुहोस्।', en: 'Create a session first.' })}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <Switch
                on={settings.chat_enabled}
                disabled={saving}
                onToggle={() => toggle({ chat_enabled: !settings.chat_enabled })}
                label={{ ne: 'च्याट कोठा खुला राख्ने', en: 'Keep the chat room open' }}
                hint={{
                  ne: 'बन्द राखे कसैले पनि सन्देश पठाउन पाउँदैनन्।',
                  en: 'With this off, nobody can send messages at all.',
                }}
              />
              <Switch
                on={settings.direct_messages_enabled}
                disabled={saving}
                onToggle={() => toggle({ direct_messages_enabled: !settings.direct_messages_enabled })}
                label={{ ne: 'सिधा सन्देश लिने', en: 'Accept direct messages' }}
                hint={{
                  ne: 'सहभागीले प्रस्तोतालाई पठाएको सन्देश तपाईंको स्वीकृतिपछि मात्र पुग्छ।',
                  en: 'A message to a presenter reaches them only after you approve it.',
                }}
              />
            </div>
          )}
        </Card>
      )}

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

      {tab === 'acc' && (
        <Card className="max-w-[760px]">
          <p className="text-[12.5px] text-[#6E7C8E]">
            {t({
              ne: 'यी छनोट यही ब्राउजरमा सुरक्षित हुन्छन्।',
              en: 'These choices are remembered in this browser.',
            })}
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <Switch
              on={a11y.big}
              onToggle={() => setA11y((v) => ({ ...v, big: !v.big }))}
              label={{ ne: 'ठूलो अक्षर', en: 'Larger text' }}
              hint={{ ne: 'सबै लेखाइ ठूलो हुन्छ।', en: 'Bigger type throughout.' }}
            />
            <Switch
              on={a11y.contrast}
              onToggle={() => setA11y((v) => ({ ...v, contrast: !v.contrast }))}
              label={{ ne: 'गाढा किनारा', en: 'Stronger borders' }}
              hint={{ ne: 'हल्का धर्का गाढा हुन्छन्।', en: 'Faint lines become solid.' }}
            />
            <Switch
              on={a11y.calm}
              onToggle={() => setA11y((v) => ({ ...v, calm: !v.calm }))}
              label={{ ne: 'चलायमान कम', en: 'Reduce motion' }}
              hint={{ ne: 'एनिमेसन बन्द हुन्छ।', en: 'Turns off animation.' }}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-navy-800/[.08]">
            <p className="text-[12.5px] text-[#6E7C8E] mb-2">{t({ ne: 'भाषा', en: 'Language' })}</p>
            <div className="flex gap-2">
              <Btn tone={lang === 'ne' ? 'solid' : 'plain'} onClick={() => setLang('ne')}>नेपाली</Btn>
              <Btn tone={lang === 'en' ? 'solid' : 'plain'} onClick={() => setLang('en')}>English</Btn>
            </div>
          </div>
        </Card>
      )}

      {tab === 'plan' && <PlanPanel roles={roles} />}
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
const PlanPanel: React.FC<{ roles: UserRoles | null }> = ({ roles }) => {
  const { t, num } = useOrganizer();

  if (!roles?.plan || !roles.usage) {
    return (
      <Card className="max-w-[760px]">
        <p className="text-[13px] text-[#6E7C8E]">
          {t({ ne: 'योजनाको विवरण ल्याउँदै…', en: 'Fetching your plan…' })}
        </p>
      </Card>
    );
  }

  const { plan, usage } = roles;
  // A per-meeting ceiling has no single figure to spend, so it is stated
  // rather than drawn as a bar.
  const rows: { label: string; used: number | null; cap: number | null }[] = [
    { label: t({ ne: 'कार्यक्रम', en: 'Events' }), used: usage.events, cap: plan.limits.events },
    { label: t({ ne: 'बैठक', en: 'Meetings' }), used: usage.meetings, cap: plan.limits.meetings },
    {
      label: t({ ne: 'प्रति बैठक सत्र', en: 'Sessions per meeting' }),
      used: null,
      cap: plan.limits.sessions_per_meeting,
    },
  ];

  return (
    <Card className="max-w-[760px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[15px] font-semibold text-navy-900">
            {plan.name}
            {!plan.paid && (
              <span className="ml-2 text-[12px] font-normal text-[#6E7C8E]">
                {t({ ne: 'निःशुल्क परीक्षण', en: 'free trial' })}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-[#6E7C8E]">
            {plan.paid
              ? t({ ne: 'तपाईंको सदस्यता सक्रिय छ।', en: 'Your subscription is active.' })
              : t({
                  ne: 'परीक्षणमा २ कार्यक्रम, प्रत्येकमा २ बैठक, प्रत्येकमा २ सत्र।',
                  en: 'The trial covers 2 events, 2 meetings each, 2 sessions each.',
                })}
          </p>
        </div>
        <Btn onClick={() => window.open('/pricing', '_blank')}>
          {t({ ne: 'योजना हेर्नुहोस्', en: 'See plans' })}
        </Btn>
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row) =>
          row.cap === null ? (
            <div key={row.label} className="flex justify-between text-[13px]">
              <span className="text-navy-900">{row.label}</span>
              <span className="text-[#6E7C8E]">{t({ ne: 'असीमित', en: 'Unlimited' })}</span>
            </div>
          ) : row.used === null ? (
            <div key={row.label} className="flex justify-between text-[13px]">
              <span className="text-navy-900">{row.label}</span>
              <span className="text-[#6E7C8E]">{t({ ne: 'सम्म', en: 'up to' })} {num(row.cap)}</span>
            </div>
          ) : (
            <BarRow
              key={row.label}
              label={row.label}
              pct={Math.min(100, Math.round((row.used / row.cap) * 100))}
              right={`${num(row.used)} / ${num(row.cap)}`}
            />
          )
        )}
      </div>
    </Card>
  );
};
