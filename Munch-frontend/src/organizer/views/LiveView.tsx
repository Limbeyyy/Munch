import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ACTIVE_POLL_MS } from '../../services/polling';
import { deskSession, startableNow } from '../sessionState';
import { ChatRules } from '../ChatRules';
import { RequestButton, RequestCard, RequestRow } from '../RequestCard';
import { LiveDashboard } from '../LiveDashboard';
import { ChatMessage, GuestAttendee, Event, Session } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Card, Head, Panel } from '../ui';


interface Props {
  events: Event[];
  onChanged: () => void;
  onNavigate: (view: string) => void;
}

/**
 * The desk you run the event from: what is on stage now, who is in the room,
 * and the queue waiting on a decision.
 */
export const LiveView: React.FC<Props> = ({ events, onChanged, onNavigate }) => {
  const { t } = useOrganizer();
  const navigate = useNavigate();

  // Which part of the day we are in. The desk itself is about the session
  // inside it - that is what runs, and what is started and ended.
  const live = events.find((m) => m.status === 'active');
  const next = events
    .filter((m) => m.status === 'scheduled')
    .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))[0];
  const current = live ?? next;

  const [sessions, setSessions] = useState<Session[]>([]);

  /**
   * The desk follows the clock, so the running order moves on by itself.
   *
   * A event is a morning; a session is the thing that starts, runs and
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

  const [pending, setPending] = useState<ChatMessage[]>([]);
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

  // Everything on this screen belongs to the event that is running.
  const load = React.useCallback(async () => {
    if (!current) return;
      const [q, g, x] = await Promise.allSettled([
        apiClient.getPendingMessages(current.id),
        apiClient.getGuests(current.id),
        apiClient.listSessions(current.id),
      ]);
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

  // The running clock that used to sit on the stage card is gone with the
  // layout it belonged to: the design gives the card the session's hours
  // rather than a counter. The times themselves still come from the
  // server, so every screen still agrees about them.

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

  /**
   * Let a message through, and say where it belongs while doing it.
   *
   * The two are one decision - a question the room should see, or a
   * suggestion - so they are one press rather than approving here and
   * filing it on another screen.
   */
  const moderate = async (
    message: ChatMessage,
    action: 'approve' | 'decline',
    topic?: 'faq' | 'suggestion'
  ) => {
    if (!current) return;
    try {
      await apiClient.moderateMessage(current.id, message.id, action, topic);
      setPending((prev) => prev.filter((m) => m.id !== message.id));
      toast.success(
        topic === 'faq'
          ? t({ ne: 'प्रश्नमा राखियो', en: 'Up as a question' })
          : topic === 'suggestion'
          ? t({ ne: 'सुझावमा राखियो', en: 'Up as a suggestion' })
          : action === 'approve'
          ? t({ ne: 'सन्देश पठाइयो', en: 'Message delivered' })
          : t({ ne: 'सन्देश अस्वीकृत', en: 'Message declined' })
      );
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
              ne: 'कुनै सत्र तालिकामा छैन। कार्यक्रमभित्रबाट थप्नुहोस्।',
              en: 'Nothing is scheduled. Add a session from inside the event.',
            })}
          </p>
          <Btn tone="amber" className="mt-4" onClick={() => onNavigate('events')}>
            {t({ ne: 'कार्यक्रम खोल्नुहोस्', en: 'Open the event' })}
          </Btn>
        </Card>
      </>
    );
  }

  return (
    <LiveDashboard
      event={current}
      sessions={sessions}
      live={onStage ?? null}
      onBackToRoom={() => navigate(`/event/${current.code}`)}
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
      queues={
        <>
          {/* The counters that were here said what the rest of the
              screen already shows, in numbers nobody was acting on. The
              queue below says how many are waiting; the attendance page
              says who came. */}
        <RequestCard
          title={{ ne: 'भित्र आउन अनुरोध', en: 'Join Request' }}
          count={knocking.length}
          empty={{
            ne: 'पाहुनाले बैठक कोडबाट अनुरोध पठाएपछि यहाँ देखिन्छ।',
            en: 'A guest who used the event code appears here.',
          }}
        >
          {knocking.map((guest) => (
            <RequestRow
              key={guest.id}
              name={guest.full_name}
              under={t({ ne: 'पाहुनाका रूपमा', en: 'Joining as Guest' })}
              actions={
                <>
                  <RequestButton
                    tone="accept"
                    disabled={deciding === guest.id}
                    onClick={() => decideGuest(guest, true)}
                  >
                    {t({ ne: 'स्वीकार', en: 'Accept' })}
                  </RequestButton>
                  <RequestButton
                    tone="decline"
                    disabled={deciding === guest.id}
                    onClick={() => decideGuest(guest, false)}
                  >
                    {t({ ne: 'अस्वीकार', en: 'Decline' })}
                  </RequestButton>
                </>
              }
            />
          ))}
        </RequestCard>

        {/* What has been written to the front of the room, and the only
            question worth asking about it: which board it belongs on. */}
        <RequestCard
          title={{ ne: 'सन्देश अनुरोध', en: 'Message Request' }}
          count={pending.length}
          empty={{ ne: 'लाइन सफा छ।', en: 'The queue is clear.' }}
        >
          {pending.map((m) => (
            <RequestRow
              key={m.id}
              name={m.body}
              under={m.sender_name}
              actions={
                <>
                  <RequestButton
                    tone="accept"
                    onClick={() => moderate(m, 'approve', 'faq')}
                  >
                    {t({ ne: 'प्रश्न', en: 'Question' })}
                  </RequestButton>
                  <RequestButton
                    tone="quiet"
                    onClick={() => moderate(m, 'approve', 'suggestion')}
                  >
                    {t({ ne: 'सुझाव', en: 'Suggestions' })}
                  </RequestButton>
                </>
              }
            />
          ))}
        </RequestCard>

          {/* The chat is something the host does to a session that is
              running - closing the floor for a speaker, opening direct
              messages for a question round - so the switches live here
              while one is on stage. */}
          {isLive && (
            <Panel title={t({ ne: 'च्याट नियम', en: 'Chat rules' })}>
              <div className="px-4 py-3.5">
                <ChatRules eventId={current.id} />
              </div>
            </Panel>
          )}
        </>
      }
    />
  );
};
