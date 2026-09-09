import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ACTIVE_POLL_MS } from '../../services/polling';
import { doorway, howFarOff } from '../sessionState';
import { ChatRules } from '../ChatRules';
import {
  AttendanceReport, ChatMessage, GuestAttendee, Meeting, MeetingParticipant,
  Session,
} from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Card, Empty, Head, Kpi, Panel, Switch } from '../ui';

const formatElapsed = (seconds: number) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
};

interface Props {
  meetings: Meeting[];
  onChanged: () => void;
  onNavigate: (view: string) => void;
}

/**
 * The desk you run the event from: what is on stage now, who is in the room,
 * and the queue waiting on a decision.
 */
export const LiveView: React.FC<Props> = ({ meetings, onChanged, onNavigate }) => {
  const { t, num } = useOrganizer();
  const navigate = useNavigate();

  // Which part of the day we are in. The desk itself is about the session
  // inside it - that is what runs, and what is started and ended.
  const live = meetings.find((m) => m.status === 'active');
  const next = meetings
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))[0];
  const current = live ?? next;

  const [sessions, setSessions] = useState<Session[]>([]);

  /**
   * The session on the desk: whatever is on stage, or the next one due.
   *
   * A meeting is a morning; a session is the thing that starts, runs and
   * ends. Everything on this screen used to say "session" and act on the
   * meeting, which is why starting from here started the whole morning.
   */
  const onStage = sessions.find((x) => x.status === 'live');
  const upNext = sessions
    .filter((x) => x.status === 'scheduled')
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0];
  const stage = onStage ?? upNext;
  const isLive = !!onStage;

  /**
   * When the room opens for whatever is on the desk, and what may be done
   * yet. The upcoming session is shown however far off it is - eight hours
   * or eight minutes - because the desk is where the host looks to see
   * what is next. What changes with the clock is not whether it is shown
   * but whether the buttons do anything: going in early is refused by the
   * server, and a button that only produces that refusal reads as broken.
   */
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const door = doorway(stage?.starts_at, tick);
  const away = stage ? howFarOff(stage.starts_at, tick) : null;
  const awayText = (): string => {
    if (!away) return '';
    const { amount, unit } = away;
    if (unit === 'minute') {
      return t({ ne: `${num(amount)} मिनेटमा`, en: `in ${amount} min` });
    }
    if (unit === 'hour') {
      return t({ ne: `${num(amount)} घण्टामा`, en: `in ${amount} h` });
    }
    return t({ ne: `${num(amount)} दिनमा`, en: `in ${amount} d` });
  };

  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [knocking, setKnocking] = useState<GuestAttendee[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);

  /**
   * Let somebody in, or turn them away.
   *
   * A guest can knock from the moment the room opens, whether or not
   * anybody is here to answer. The requests wait in this list rather than
   * in a notification that has already gone, so a host arriving late still
   * finds everyone who came early.
   */
  const decideGuest = async (guest: GuestAttendee, admit: boolean) => {
    if (!current) return;
    try {
      setDeciding(guest.id);
      await apiClient.admitGuest(current.id, guest.id, admit ? 'admit' : 'deny');
      setKnocking((prev) => prev.filter((g) => g.id !== guest.id));
      toast.success(
        admit
          ? t({ ne: `${guest.full_name} भित्रिए`, en: `${guest.full_name} is in` })
          : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' })
      );
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setDeciding(null); }
  };

  // Everything on this screen belongs to the meeting that is running.
  const load = React.useCallback(async () => {
    if (!current) return;
      const [p, a, q, g, x] = await Promise.allSettled([
        apiClient.getParticipants(current.id),
        apiClient.getAttendance(current.id),
        apiClient.getPendingMessages(current.id),
        apiClient.getGuests(current.id),
        apiClient.listSessions(current.id),
      ]);
      if (p.status === 'fulfilled') setParticipants(p.value);
      if (a.status === 'fulfilled') setAttendance(a.value);
      if (q.status === 'fulfilled') setPending(q.value);
      if (g.status === 'fulfilled') {
        setKnocking(g.value.filter((guest) => guest.status === 'pending'));
      }
      if (x.status === 'fulfilled') setSessions(x.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    load();
    const id = setInterval(load, ACTIVE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The clock is anchored to the server's start time, so every screen agrees.
  useEffect(() => {
    // The clock counts the session on stage, not the whole morning.
    if (!onStage?.started_at) { setElapsed(0); return; }
    const origin = new Date(onStage.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [onStage?.started_at]);

  const start = async () => {
    if (!stage) return;
    try {
      setBusy(true);
      await apiClient.startSession(stage.id);
      toast.success(t({ ne: 'सत्र सुरु भयो', en: 'Session started' }));
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'सुरु गर्न सकिएन', en: 'Could not start' }));
    } finally { setBusy(false); }
  };

  const end = async () => {
    if (!onStage) return;
    const ok = window.confirm(t({
      ne: `“${onStage.title}” सबैका लागि सकाउने?`,
      en: `End “${onStage.title}” for everyone?`,
    }));
    if (!ok) return;
    try {
      setBusy(true);
      await apiClient.endSession(onStage.id);
      toast.success(t({ ne: 'सत्र सकियो', en: 'Session ended' }));
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'अन्त्य गर्न सकिएन', en: 'Could not end' }));
    } finally { setBusy(false); }
  };

  const moderate = async (message: ChatMessage, action: 'approve' | 'decline') => {
    if (!live) return;
    try {
      await apiClient.moderateMessage(live.id, message.id, action);
      setPending((prev) => prev.filter((m) => m.id !== message.id));
      toast.success(action === 'approve'
        ? t({ ne: 'सन्देश पठाइयो', en: 'Message delivered' })
        : t({ ne: 'सन्देश अस्वीकृत', en: 'Message declined' }));
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    }
  };

  if (!current) {
    return (
      <>
        <Head
          title={{ ne: 'लाइभ नियन्त्रण', en: 'Live control' }}
          lede={{
            ne: 'सत्र सुरु/अन्त्य, हलको गणना, र सन्देशको लाइन — सबै यहीँबाट।',
            en: 'Start and end sessions, watch the room, clear the queue — all from here.',
          }}
        />
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({
              ne: 'कुनै सत्र तालिकामा छैन। एजेन्डाबाट थप्नुहोस्।',
              en: 'Nothing is scheduled. Add a session from the agenda.',
            })}
          </p>
          <Btn tone="amber" className="mt-4" onClick={() => onNavigate('agenda')}>
            {t({ ne: 'एजेन्डा खोल्नुहोस्', en: 'Open the agenda' })}
          </Btn>
        </Card>
      </>
    );
  }

  const activeCount = participants.filter((p) => p.is_active).length;
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && m.id !== current.id);

  return (
    <>
      <Head
        title={{ ne: 'लाइभ नियन्त्रण', en: 'Live control' }}
        lede={{
          ne: 'सत्र सुरु/अन्त्य, हलको गणना, र सन्देशको लाइन — सबै यहीँबाट।',
          en: 'Start and end sessions, watch the room, clear the queue — all from here.',
        }}
        actions={
          <Btn
            onClick={() => navigate(`/meeting/${current.meeting_code}`)}
            disabled={!!stage && !door.canEnter}
            title={
              stage && !door.canEnter
                ? t({
                    ne: `कोठा ${new Date(door.opensAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} बजे खुल्छ`,
                    en: `The room opens at ${new Date(door.opensAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  })
                : undefined
            }
          >
            {t({ ne: 'कोठामा जानुहोस्', en: 'Enter the room' })}
          </Btn>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {/* Stage */}
          <div
            className="bg-navy-800 text-white rounded-[18px] p-5"
            style={{ backgroundImage: 'radial-gradient(circle at 90% -10%,rgba(240,162,43,.28),transparent 55%)' }}
          >
            <div className="flex items-center gap-2.5 flex-wrap">
              {isLive && <span className="w-2.5 h-2.5 rounded-full bg-amber animate-pulse" />}
              <span className="text-[12.5px] text-amber font-semibold">
                {isLive
                  ? t({ ne: 'चलिरहेको सत्र', en: 'On stage now' })
                  : t({ ne: 'अर्को सत्र', en: 'Up next' })}
              </span>
              {!isLive && stage && (
                <span className="text-[12px] text-[#C9DAF1] bg-white/[.14] rounded-full px-2.5 leading-[20px]">
                  {awayText()}
                </span>
              )}
              <span className="ml-auto text-[12.5px] text-[#AFC6E6]">
                {stage ? (() => {
                  const from = new Date(stage.starts_at);
                  const to = new Date(+from + stage.duration_minutes * 60000);
                  const hm = (d: Date) =>
                    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return `${hm(from)} – ${hm(to)}`;
                })() : '—'}
              </span>
            </div>

            <h2 className="text-[21px] font-semibold mt-2.5 mb-1">
              {stage?.title ?? t({ ne: 'कुनै सत्र बाँकी छैन', en: 'No session left to run' })}
            </h2>
            <p className="text-[13.5px] text-[#C9DAF1]">
              {[
                stage?.speaker_name,
                stage?.hall,
                current.title,
              ].filter(Boolean).join(' · ')}
              {' · '}
              {t({ ne: 'कोड', en: 'Code' })} {current.meeting_code}
            </p>

            <div className="flex items-center gap-4 flex-wrap mt-4">
              <div>
                <div className="text-[34px] font-semibold tabular-nums tracking-tight">
                  {isLive ? formatElapsed(elapsed) : '—'}
                </div>
                <p className="text-xs text-[#AFC6E6]">
                  {isLive
                    ? t({ ne: 'चलेको समय', en: 'Running for' })
                    : t({ ne: 'सुरु हुन बाँकी', en: 'Not started' })}
                </p>
              </div>

              <div className="ml-auto flex gap-2 flex-wrap">
                {isLive ? (
                  <button
                    onClick={end}
                    disabled={busy}
                    className="px-3.5 py-2 rounded-[9px] bg-white text-live font-semibold text-[13.5px] disabled:opacity-50"
                  >
                    {t({ ne: 'सत्र सकियो', en: 'End session' })}
                  </button>
                ) : stage ? (
                  <button
                    onClick={start}
                    disabled={busy || !door.canStart}
                    title={
                      door.canStart
                        ? undefined
                        : t({
                            ne: 'सत्रको समय आएपछि मात्र सुरु गर्न मिल्छ',
                            en: 'A session can only be started once its time has come',
                          })
                    }
                    className="px-3.5 py-2 rounded-[9px] bg-amber text-[#20160A] font-semibold text-[13.5px] disabled:opacity-50"
                  >
                    {t({ ne: 'सत्र सुरु गर्नुहोस्', en: 'Start session' })}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <Kpi
            items={[
              { value: num(activeCount), label: { ne: 'अहिले हलमा', en: 'In the room' } },
              {
                value: attendance
                  ? `${num(attendance.attended_count)}/${num(attendance.expected_total || attendance.attended_count)}`
                  : '—',
                label: { ne: 'आज चेक-इन', en: 'Checked in today' },
              },
              { value: num(pending.length), label: { ne: 'सन्देश लाइनमा', en: 'Messages queued' } },
              {
                value: num(attendance?.guests_admitted ?? 0),
                label: { ne: 'पाहुना भित्रिएका', en: 'Guests admitted' },
              },
            ]}
          />

          {/* The chat is something the host does to a session that is
              running - closing the floor for a speaker, opening direct
              messages for a question round - so the switches live here
              while one is on stage rather than in settings, where they
              were a preference nobody was setting. */}
          {isLive && (
            <Panel title={t({ ne: 'च्याट नियम', en: 'Chat rules' })}>
              <div className="px-4 py-3.5">
                <ChatRules meetingId={current.id} />
              </div>
            </Panel>
          )}

          {/* Guests knock from the moment the room opens, whether or not
              anybody is here to answer. They wait here rather than in a
              notification that has already gone. */}
          <Panel
            title={t({ ne: 'भित्र आउन अनुरोध', en: 'Asking to come in' })}
            aside={
              knocking.length > 0
                ? <Chip tone="warn">{num(knocking.length)} {t({ ne: 'पर्खिरहेका', en: 'waiting' })}</Chip>
                : <span className="text-[12.5px] text-[#6E7C8E]">
                    {t({ ne: 'कोही पर्खिरहेको छैन', en: 'Nobody waiting' })}
                  </span>
            }
          >
            <div className="px-4">
              {knocking.length === 0 ? (
                <Empty>
                  {t({
                    ne: 'पाहुनाले बैठक कोडबाट अनुरोध पठाएपछि यहाँ देखिन्छ — ढिलो आए पनि सूची यहीँ रहन्छ।',
                    en: 'A guest who used the meeting code appears here. The list keeps them, however late you arrive.',
                  })}
                </Empty>
              ) : (
                knocking.map((guest) => (
                  <div
                    key={guest.id}
                    className="flex items-center gap-3 py-3 border-b border-navy-800/[.08] last:border-0"
                  >
                    <span className="w-8 h-8 rounded-full bg-navy-700 text-white grid place-items-center text-xs font-semibold flex-none">
                      {guest.full_name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium truncate">{guest.full_name}</p>
                      <p className="text-[12.5px] text-[#6E7C8E]">{guest.phone}</p>
                    </div>
                    <span className="ml-auto flex gap-1.5 flex-none">
                      <Btn sm tone="solid" disabled={deciding === guest.id}
                           onClick={() => decideGuest(guest, true)}>
                        {t({ ne: 'भित्र', en: 'Let in' })}
                      </Btn>
                      <Btn sm tone="danger" disabled={deciding === guest.id}
                           onClick={() => decideGuest(guest, false)}>
                        {t({ ne: 'अस्वीकार', en: 'Decline' })}
                      </Btn>
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel
            title={t({ ne: 'सन्देशको लाइन', en: 'Message queue' })}
            aside={<Chip tone="warn">{num(pending.length)} {t({ ne: 'पर्खिरहेका', en: 'waiting' })}</Chip>}
            actions={<Btn sm onClick={() => onNavigate('moderation')}>{t({ ne: 'सबै हेर्नुहोस्', en: 'See all' })}</Btn>}
          >
            <div className="px-4">
              {pending.length === 0 ? (
                <Empty>{t({ ne: 'लाइन सफा छ।', en: 'The queue is clear.' })}</Empty>
              ) : (
                pending.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex gap-3 py-3 border-b border-navy-800/[.08] last:border-0 items-start">
                    <div className="min-w-0">
                      <p className="text-[13.5px]">{m.body}</p>
                      <p className="text-[12.5px] text-[#6E7C8E]">
                        {m.sender_name} &rarr; {m.recipient_name}
                      </p>
                    </div>
                    <span className="ml-auto flex gap-1.5 flex-none">
                      <Btn sm tone="solid" onClick={() => moderate(m, 'approve')}>
                        {t({ ne: 'पठाउने', en: 'Deliver' })}
                      </Btn>
                      <Btn sm tone="danger" onClick={() => moderate(m, 'decline')}>
                        {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                      </Btn>
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title={t({ ne: 'अबको क्रम', en: 'Run sheet' })}>
            <div className="px-4 py-1">
              {upcoming.length === 0 ? (
                <Empty>{t({ ne: 'यसपछि केही तालिकामा छैन।', en: 'Nothing scheduled after this.' })}</Empty>
              ) : (
                upcoming.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex gap-3 py-3 border-b border-navy-800/[.08] last:border-0 items-center">
                    <span className="text-center w-[52px] flex-none">
                      <b className="block text-[15px] tabular-nums">
                        {new Date(m.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </b>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] truncate">{m.title}</p>
                      <p className="text-[12.5px] text-[#6E7C8E] truncate">{m.host?.email}</p>
                    </div>
                    <span className="ml-auto">
                      <Btn sm onClick={() => onNavigate('agenda')}>{t({ ne: 'खोल्नुहोस्', en: 'Open' })}</Btn>
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card>
            <h3 className="text-[15px] font-semibold mb-2.5">
              {t({ ne: 'अहिलेका नियम', en: 'Live switches' })}
            </h3>
            <LiveSwitches meeting={current} />
          </Card>

          <Card>
            <h3 className="text-[15px] font-semibold">
              {t({ ne: 'हलको ट्रान्सक्रिप्ट', en: 'Room transcript' })}
            </h3>
            <p className="text-[12.5px] text-[#6E7C8E] mt-1 mb-2.5">
              {t({
                ne: 'हलको यन्त्रले बोलेको कुरा पाठमा पठाउँछ — सबैको पर्दामा उही देखिन्छ।',
                en: 'The hall device sends what is said as text — every screen shows the same lines.',
              })}
            </p>
            <Btn tone="solid" className="w-full justify-center"
                 onClick={() => navigate(`/meeting/${current.meeting_code}`)}>
              {t({ ne: 'ट्रान्सक्रिप्ट हेर्नुहोस्', en: 'Watch the transcript' })}
            </Btn>
          </Card>
        </div>
      </div>
    </>
  );
};

/** Chat and direct-message switches, saved straight to the meeting. */
const LiveSwitches: React.FC<{ meeting: Meeting }> = ({ meeting }) => {
  const { t } = useOrganizer();
  const [settings, setSettings] = useState({
    chat_enabled: !!meeting.chat_enabled,
    direct_messages_enabled: !!meeting.direct_messages_enabled,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.getChatSettings(meeting.id).then(setSettings).catch(() => undefined);
  }, [meeting.id]);

  const toggle = async (patch: Partial<typeof settings>) => {
    try {
      setSaving(true);
      setSettings(await apiClient.updateChatSettings(meeting.id, patch));
    } catch {
      toast.error(t({ ne: 'सेटिङ बदल्न सकिएन', en: 'Could not change that setting' }));
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <Switch
        on={settings.chat_enabled}
        disabled={saving}
        onToggle={() => toggle({ chat_enabled: !settings.chat_enabled })}
        label={{ ne: 'च्याट कोठा खुला', en: 'Chat room open' }}
      />
      <Switch
        on={settings.direct_messages_enabled}
        disabled={saving}
        onToggle={() => toggle({ direct_messages_enabled: !settings.direct_messages_enabled })}
        label={{ ne: 'सिधा सन्देश लिने', en: 'Accept direct messages' }}
        hint={{
          ne: 'सहभागीका सिधा सन्देश तपाईंको स्वीकृतिपछि मात्र पुग्छन्।',
          en: 'Attendee messages reach presenters only after you approve them.',
        }}
      />
    </div>
  );
};
