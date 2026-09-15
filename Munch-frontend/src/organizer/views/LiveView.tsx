import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ACTIVE_POLL_MS } from '../../services/polling';
import { deskSession, startableNow } from '../sessionState';
import { ChatRules } from '../ChatRules';
import { DashboardView } from '../../attendee/views/DashboardView';
import { SpineItem } from '../../attendee/Spine';
import {
  AttendanceReport, ChatMessage, GuestAttendee, Meeting, MeetingParticipant,
  Session,
} from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Card, Empty, Head, Kpi, Panel } from '../ui';


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
   * The desk follows the clock, so the running order moves on by itself.
   *
   * A meeting is a morning; a session is the thing that starts, runs and
   * ends. Which one the desk holds is worked out in one place and shared
   * with the attendee's panel, so the two cannot disagree about what is
   * happening.
   */
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const desk = deskSession(sessions, tick);
  const stage = desk.session;
  const isLive = desk.state === 'live';
  /** Its slot contains this moment. */
  const isDue = desk.state === 'due';
  /**
   * Whether the host may put it on stage.
   *
   * Its hour need not have come. Starting early means the talk - and the
   * rest of the day behind it - is brought forward to now, so the button
   * works before the hour and says what it will do. Only something set for
   * another day is refused, which the server says too.
   */
  const canGoOnStage = !!stage && startableNow(stage.starts_at, tick);
  const onStage = isLive ? stage : undefined;

  /**
   * When the room opens for whatever is on the desk, and what may be done
   * yet. The upcoming session is shown however far off it is - eight hours
   * or eight minutes - because the desk is where the host looks to see
   * what is next. What changes with the clock is not whether it is shown
   * but whether the buttons do anything: going in early is refused by the
   * server, and a button that only produces that refusal reads as broken.
   */
  // Going back into the room is the dashboard's own button now, and it
  // knows when the door is open.

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

  /**
   * The day as the dashboard draws it, from what this desk already has.
   *
   * The host's live control and the attendee's dashboard are the same
   * screen - what is on stage, what is being said, what the day has come
   * to - so it is the same component rather than a second copy of it that
   * would drift. What the host gets on top are the things only a host
   * does: the people asking to come in, the messages waiting to be
   * sorted, and the switches for the talk that is running.
   */
  const items: SpineItem[] = sessions.map((one) => ({
    session: one,
    meeting: current as any,
  }));
  const liveItem = onStage
    ? items.find((i) => i.session.id === onStage.id) ?? null
    : null;

  return (
    <DashboardView
      event={null}
      items={items}
      live={liveItem}
      attendedIds={new Set()}
      onOpen={() => onNavigate('agenda')}
      onNavigate={onNavigate}
      onJoinRoom={(m) => navigate(`/meeting/${m.meeting_code}`)}
      elapsed={elapsed}
      heading={{
        title: { ne: 'लाइभ नियन्त्रण', en: 'Live control' },
        lede: {
          ne: 'सत्र सुरु/अन्त्य, हलको गणना, र सन्देशको लाइन — सबै यहीँबाट।',
          en: 'Start and end sessions, watch the room, clear the queue — all from here.',
        },
      }}
      stageActions={
        isLive ? (
          <Btn sm tone="danger" disabled={busy} onClick={end}>
            {t({ ne: 'सत्र सकियो', en: 'End session' })}
          </Btn>
        ) : stage ? (
          <Btn
            sm
            tone="solid"
            disabled={busy || !canGoOnStage}
            onClick={start}
            title={
              !canGoOnStage
                ? t({
                    ne: 'अर्को दिनका लागि राखिएको सत्र यहाँबाट सुरु हुँदैन — पहिले समय मिलाउनुहोस्',
                    en: 'This is set for another day. Give it a new time first.',
                  })
                : isDue
                ? undefined
                : t({
                    ne: 'तोकिएको समयभन्दा अघि सुरु गर्दा बाँकी कार्यक्रम पनि अघि सर्छ',
                    en: 'Starting before its hour brings the rest of the day forward with it',
                  })
            }
          >
            {t({ ne: 'सत्र सुरु गर्नुहोस्', en: 'Start session' })}
          </Btn>
        ) : null
      }
      extras={
        <>
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
                    <p className="text-[12.5px] text-[#6E7C8E]">
                      {t({ ne: 'पाहुनाका रूपमा', en: 'Joining as a guest' })}
                    </p>
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

          {/* The chat is something the host does to a session that is
              running - closing the floor for a speaker, opening direct
              messages for a question round - so the switches live here
              while one is on stage. */}
          {isLive && (
            <Panel title={t({ ne: 'च्याट नियम', en: 'Chat rules' })}>
              <div className="px-4 py-3.5">
                <ChatRules meetingId={current.id} />
              </div>
            </Panel>
          )}
        </>
      }
    />
  );
};
