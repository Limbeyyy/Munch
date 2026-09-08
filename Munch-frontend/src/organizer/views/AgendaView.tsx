import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EventProgramme, MeetingDraft, SessionDraft } from '../../types';
import { confirmSpacing } from '../confirmSpacing';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Btn, Card, Chip, Empty, Head, Panel } from '../ui';
import { SESSION_STATE_LABEL, SESSION_STATE_TONE, sessionState } from '../sessionState';
import { Modal } from '../OrganizerShell';
import {
  MeetingDraftFields, emptyMeeting, missingSpeakerDetails,
  toApiMeeting, toLocalInput as toLocalDay,
} from '../MeetingDraftFields';
import {
  GAP_MINUTES, MEETING_GAP_MINUTES, PlannedMeeting, PlannedSession,
  applyEdit, countChanges, hallsInUse, pendingChanges, reflowMeeting, setHall,
  swapSessions, toPlan, whyNotSwap,
} from '../schedule';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A local value for <input type="datetime-local">. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** The table's shape. Header and rows share it so they stay aligned. */
const COLUMNS = '28px minmax(200px,1fr) 150px 200px 84px 124px 112px 36px';
/** Narrower than this the columns would be squashed, so the table scrolls. */
const TABLE_MIN_WIDTH = 1004;

const gapBefore = (plan: PlannedMeeting[], index: number) =>
  index === 0 ? null : Math.round((plan[index].startsAt - plan[index - 1].endsAt) / 60000);

interface Props {
  onChanged: () => void;
}

/**
 * The running order, edited as sessions.
 *
 * Changing a start or a length reflows the rest of the day at once, so the
 * organizer sees the consequence before deciding to keep it. Nothing is
 * written until they say so.
 */
export const AgendaView: React.FC<Props> = ({ onChanged }) => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [eventId, setEventId] = useState('');
  const [plan, setPlan] = useState<PlannedMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** The session currently being removed, so only its own control locks. */
  const [removing, setRemoving] = useState<string | null>(null);
  const [newMeeting, setNewMeeting] = useState(false);
  /** The meeting a session is being added to, if any. */
  const [addingTo, setAddingTo] = useState<PlannedMeeting | null>(null);
  /** The session being dragged, and the row it is hovering over. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiClient.listEvents();
      setEvents(list);
      const chosen = list.find((e) => e.id === eventId) ?? list[0];
      setEventId(chosen?.id ?? '');
      setPlan(chosen ? toPlan(chosen.meetings) : []);
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the programme' }));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const event = events.find((e) => e.id === eventId) ?? null;
  const changes = countChanges(plan);

  const pickEvent = (id: string) => {
    if (changes > 0 && !window.confirm(
      t({ ne: 'नसेभ गरिएका परिवर्तन हराउँछन्। अघि बढ्ने?', en: 'Unsaved changes will be lost. Carry on?' })
    )) return;
    setEventId(id);
    const chosen = events.find((e) => e.id === id);
    setPlan(chosen ? toPlan(chosen.meetings) : []);
  };

  const revert = () => {
    setPlan(event ? toPlan(event.meetings) : []);
  };

  /** Write every row the reflow touched, then reload from the server. */
  const save = async () => {
    const { sessions, meetings } = pendingChanges(plan);
    if (sessions.length === 0 && meetings.length === 0) return;

    try {
      setSaving(true);
      // The whole rearrangement goes in one transaction. Meeting windows
      // follow their running order on the server, so they are not sent
      // separately - and cannot end up disagreeing with it.
      if (sessions.length > 0) {
        await apiClient.rescheduleSessions(
          sessions.map((s) => ({
            id: s.id,
            starts_at: new Date(s.startsAt).toISOString(),
            duration_minutes: s.durationMinutes,
            hall: s.hall,
          }))
        );
      }

      const changed = sessions.length + meetings.length;
      toast.success(
        t({
          ne: `${num(changed)} परिवर्तन सेभ भयो`,
          en: `${changed} change${changed === 1 ? '' : 's'} saved`,
        })
      );

      const list = await apiClient.listEvents();
      setEvents(list);
      const chosen = list.find((e) => e.id === eventId);
      setPlan(chosen ? toPlan(chosen.meetings) : []);
      onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सेभ गर्न सकिएन', en: 'Could not save' })));
    } finally { setSaving(false); }
  };

  /** Take a session out of the running order for good. */
  const removeSession = async (session: PlannedSession) => {
    const ok = window.confirm(
      t({
        ne: `“${session.title}” हटाउने?\n\nयसको उपस्थिति रेकर्ड पनि जान्छ।`,
        en: `Remove “${session.title}”?\n\nIts attendance record goes with it.`,
      })
    );
    if (!ok) return;
    try {
      setRemoving(session.id);
      await apiClient.deleteSession(session.id);
      toast.success(t({ ne: 'सत्र हटाइयो', en: 'Session removed' }));
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' }));
    } finally { setRemoving(null); }
  };

  const statusChip = (session: PlannedSession) => {
    const state = sessionState({
      status: session.status,
      starts_at: new Date(session.startsAt).toISOString(),
      duration_minutes: session.durationMinutes,
    });
    return <Chip tone={SESSION_STATE_TONE[state]}>{t(SESSION_STATE_LABEL[state])}</Chip>;
  };

  /**
   * Two sessions change places, each taking the other's slot.
   *
   * Refusals are spoken rather than silent: dropping a row somewhere it
   * cannot go looks broken otherwise, and the reason is never obvious from
   * the row itself.
   */
  const swap = (fromId: string, toId: string) => {
    const refusal = whyNotSwap(plan, fromId, toId);
    if (refusal === 'other-meeting') {
      toast.error(t({
        ne: 'सत्रहरू एउटै बैठकभित्र मात्र ठाउँ साट्न सक्छन्।',
        en: 'Sessions can only change places within the same meeting.',
      }));
      return;
    }
    if (refusal === 'settled') {
      toast.error(t({
        ne: 'चलिसकेको वा चलिरहेको सत्रको समय फेरिँदैन।',
        en: 'A session that has run, or is running, keeps its time.',
      }));
      return;
    }
    if (refusal !== null) return;

    const sessions = plan.flatMap((m) => m.sessions);
    const moved = sessions.find((s) => s.id === fromId);
    const other = sessions.find((s) => s.id === toId);
    setPlan((p) => swapSessions(p, fromId, toId));
    if (moved && other) {
      toast.success(t({
        ne: `“${moved.title}” र “${other.title}” ले ठाउँ साटे`,
        en: `“${moved.title}” and “${other.title}” changed places`,
      }));
    }
  };

  /** Alt with an arrow moves a row, for anybody not using a mouse. */
  const nudge = (meeting: PlannedMeeting, session: PlannedSession, by: -1 | 1) => {
    const order = meeting.sessions;
    const at = order.findIndex((s) => s.id === session.id);
    const neighbour = order[at + by];
    if (neighbour) swap(session.id, neighbour.id);
  };

  const sessionRow = (meeting: PlannedMeeting, session: PlannedSession) => {
    const locked = session.status === 'done';
    const fixed = locked || session.status === 'live';
    return (
      <div
        key={session.id}
        onDragOver={(e) => {
          if (!dragging || dragging === session.id) return;
          e.preventDefault();
          setOver(session.id);
        }}
        onDragLeave={() => setOver((id) => (id === session.id ? null : id))}
        onDrop={(e) => {
          e.preventDefault();
          const fromId = dragging || e.dataTransfer.getData('text/plain');
          setOver(null);
          setDragging(null);
          if (fromId) swap(fromId, session.id);
        }}
        className={`grid gap-2.5 items-center px-4 py-2.5 border-b border-navy-800/[.08] last:border-0 ${
          session.moved ? 'bg-amber/[.08]' : ''
        } ${over === session.id ? 'outline outline-2 -outline-offset-2 outline-amber' : ''} ${
          dragging === session.id ? 'opacity-50' : ''
        }`}
        style={{ gridTemplateColumns: COLUMNS, minWidth: TABLE_MIN_WIDTH }}
      >
        <button
          type="button"
          draggable={!fixed}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', session.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragging(session.id);
          }}
          onDragEnd={() => { setDragging(null); setOver(null); }}
          onKeyDown={(e) => {
            if (!e.altKey) return;
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(meeting, session, -1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(meeting, session, 1); }
          }}
          disabled={fixed}
          aria-label={t({
            ne: `“${session.title}” सार्नुहोस् — तानेर छोड्नुहोस्, वा Alt सँग तीर`,
            en: `Move “${session.title}” — drag it onto another session, or Alt with an arrow key`,
          })}
          title={t({
            ne: 'तानेर अर्को सत्रमा छोड्नुहोस् — दुवैले ठाउँ साट्छन्',
            en: 'Drag onto another session — the two change places',
          })}
          className={`w-6 h-7 rounded-md text-[#6E7C8E] leading-none text-[15px]
            ${fixed ? 'opacity-25' : 'cursor-grab hover:bg-navy-800/[.06] hover:text-navy-800'}`}
        >
          ⠿
        </button>

        <div className="min-w-0">
          <p className="text-[13.5px] font-medium truncate">{session.title}</p>
          <p className="text-[12px] text-[#6E7C8E] truncate">
            {session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
          </p>
        </div>

        <input
          list="manch-halls"
          value={session.hall}
          disabled={locked}
          placeholder={t({ ne: 'हल', en: 'Hall' })}
          onChange={(e) => setPlan((p) => setHall(p, session.id, e.target.value))}
          className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white disabled:opacity-50"
        />

        <input
          type="datetime-local"
          value={toLocalInput(session.startsAt)}
          disabled={locked}
          onChange={(e) => {
            const next = new Date(e.target.value).getTime();
            if (!Number.isNaN(next)) setPlan((p) => applyEdit(p, session.id, { startsAt: next }));
          }}
          className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white disabled:opacity-50"
        />

        <input
          type="number"
          min={5}
          step={5}
          value={session.durationMinutes}
          disabled={locked}
          onChange={(e) =>
            setPlan((p) => applyEdit(p, session.id, { durationMinutes: Number(e.target.value) || 5 }))
          }
          className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] text-center bg-white disabled:opacity-50"
        />

        <span className="text-[12.5px] text-[#6E7C8E] tabular-nums text-end whitespace-nowrap">
          {clock(session.startsAt)}–{clock(session.startsAt + session.durationMinutes * 60000)}
        </span>

        <span className="text-end">{statusChip(session)}</span>

        <span className="text-end">
          {session.status !== 'live' && (
            <button
              onClick={() => removeSession(session)}
              disabled={removing === session.id}
              aria-label={t({ ne: 'सत्र हटाउने', en: 'Remove session' })}
              title={t({ ne: 'सत्र हटाउने', en: 'Remove session' })}
              className="w-7 h-7 rounded-md text-[#6E7C8E] hover:text-live hover:bg-live/[.08] disabled:opacity-40"
            >
              ×
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <Head
        title={{ ne: 'सत्रहरू', en: 'Sessions' }}
        lede={{
          ne: 'एउटा सत्र तानेर अर्कोमा छोड्नुभयो भने दुवैले ठाउँ साट्छन्। अर्को सत्रकै समय राख्नुभयो भने पनि त्यही हुन्छ। अरू कुनै समय राख्दा त्यो सत्र सबैभन्दा नजिकको खाली समयमा बस्छ — बीचमा कम्तीमा १५ मिनेट।',
          en: `Drag a session onto another and the two change places. Give one the time another holds and they trade the same way. Any other time puts it at the nearest free point, with at least ${MEETING_GAP_MINUTES} minutes either side.`,
        }}
        actions={
          <>
            {changes > 0 && (
              <>
                <Btn onClick={revert} disabled={saving}>
                  {t({ ne: 'फिर्ता', en: 'Discard' })}
                </Btn>
                <Btn tone="solid" onClick={save} disabled={saving}>
                  {saving
                    ? t({ ne: 'सेभ हुँदै…', en: 'Saving…' })
                    : t({
                        ne: `${num(changes)} परिवर्तन सेभ गर्नुहोस्`,
                        en: `Save ${changes} change${changes === 1 ? '' : 's'}`,
                      })}
                </Btn>
              </>
            )}
            <Btn tone="amber" onClick={() => setNewMeeting(true)}>
              {t({ ne: '+ बैठक बनाउनुहोस्', en: '+ Create meeting' })}
            </Btn>
          </>
        }
      />

      {/* Halls already in use, so one is picked rather than retyped. */}
      <datalist id="manch-halls">
        {hallsInUse(plan).map((hall) => (
          <option key={hall} value={hall} />
        ))}
      </datalist>

      {loading ? (
        <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      ) : events.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({
              ne: 'अझै कुनै कार्यक्रम छैन। कार्यक्रम पानाबाट बनाउनुहोस्।',
              en: 'No programme yet. Build one from the Programme page.',
            })}
          </p>
        </Card>
      ) : (
        <>
          {events.length > 1 && (
            <select
              value={eventId}
              onChange={(e) => pickEvent(e.target.value)}
              className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px] mb-4"
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {new Date(e.event_date).toLocaleDateString()}
                </option>
              ))}
            </select>
          )}

          {changes > 0 && (
            <div className="mb-4 bg-amber/[.12] border border-amber/40 rounded-[10px] px-4 py-3 text-[13px] text-ink-2">
              {t({
                ne: `${num(changes)} पङ्क्ति सर्‍यो — पहेँलोमा देखिएका। सेभ नगरेसम्म सर्भरमा केही बदलिँदैन।`,
                en: `${changes} row${changes === 1 ? '' : 's'} moved, shown in amber. Nothing reaches the server until you save.`,
              })}
            </div>
          )}

          <div className="flex flex-col gap-3.5">
            {plan.length === 0 && (
              <Panel><Empty>{t({ ne: 'यो कार्यक्रममा बैठक छैन।', en: 'This event has no meetings.' })}</Empty></Panel>
            )}

            {plan.map((meeting, index) => {
              const gap = gapBefore(plan, index);
              return (
                <div key={meeting.id}>
                  {gap !== null && (
                    <p
                      className={`text-[12px] mb-1.5 ps-1 ${
                        gap < MEETING_GAP_MINUTES ? 'text-live' : 'text-[#6E7C8E]'
                      }`}
                    >
                      {t({
                        ne: `↕ ${num(gap)} मिनेटको खाली ठाउँ`,
                        en: `↕ ${gap} minute gap`,
                      })}
                    </p>
                  )}

                  <Panel
                    title={
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-[15.5px] font-semibold truncate">{meeting.title}</span>
                        <span className="text-[12px] font-mono text-navy-700">{meeting.meetingCode}</span>
                      </span>
                    }
                    aside={
                      <span className="flex items-center gap-2 text-[12.5px] text-[#6E7C8E]">
                        <span className="tabular-nums">
                          {clock(meeting.startsAt)}–{clock(meeting.endsAt)}
                        </span>
                        {meeting.moved && <Chip tone="warn">{t({ ne: 'सर्‍यो', en: 'Moved' })}</Chip>}
                        <Chip>{num(meeting.sessions.length)} {t({ ne: 'सत्र', en: 'sessions' })}</Chip>
                      </span>
                    }
                    actions={
                      <>
                      <Btn sm onClick={() => setAddingTo(meeting)}>
                        {t({ ne: '+ सत्र', en: '+ Session' })}
                      </Btn>
                      <input
                        type="datetime-local"
                        value={toLocalInput(meeting.startsAt)}
                        title={t({ ne: 'पूरा बैठक सार्नुहोस्', en: 'Move the whole meeting' })}
                        onChange={(e) => {
                          const next = new Date(e.target.value).getTime();
                          if (!Number.isNaN(next)) setPlan((p) => reflowMeeting(p, meeting.id, next));
                        }}
                        className="border border-navy-800/15 rounded-md px-2 py-1 text-[12.5px] bg-white"
                      />
                      </>
                    }
                  >
                    {meeting.sessions.length === 0 ? (
                      <Empty>{t({ ne: 'यो बैठकमा सत्र छैन।', en: 'No sessions in this meeting.' })}</Empty>
                    ) : (
                      <div className="overflow-x-auto">
                        <div
                          className="grid gap-2.5 px-4 py-2 bg-[#FBFAF6] border-b border-navy-800/15 text-xs text-[#6E7C8E] font-medium"
                          style={{ gridTemplateColumns: COLUMNS, minWidth: TABLE_MIN_WIDTH }}
                        >
                          <span className="sr-only">{t({ ne: 'क्रम', en: 'Order' })}</span>
                          <span>{t({ ne: 'सत्र', en: 'Session' })}</span>
                          <span>{t({ ne: 'हल', en: 'Hall' })}</span>
                          <span>{t({ ne: 'सुरु', en: 'Starts' })}</span>
                          <span className="text-center">{t({ ne: 'मिनेट', en: 'Mins' })}</span>
                          <span className="text-end">{t({ ne: 'अवधि', en: 'Runs' })}</span>
                          <span className="text-end">{t({ ne: 'अवस्था', en: 'Status' })}</span>
                          <span />
                        </div>
                        {meeting.sessions.map((s) => sessionRow(meeting, s))}
                      </div>
                    )}
                  </Panel>
                </div>
              );
            })}
          </div>
        </>
      )}

      {newMeeting && (
        <NewMeetingModal
          events={events}
          defaultEventId={eventId}
          onClose={() => setNewMeeting(false)}
          onCreated={async () => { setNewMeeting(false); await load(); onChanged(); }}
        />
      )}

      {addingTo && (
        <NewSessionModal
          meeting={addingTo}
          onClose={() => setAddingTo(null)}
          onCreated={async () => { setAddingTo(null); await load(); onChanged(); }}
        />
      )}
    </>
  );
};

/**
 * Create a meeting, inside a programme or on its own.
 *
 * The event is a choice rather than a requirement: a one-off briefing is a
 * meeting too, and does not need a day built around it.
 */
const NewMeetingModal: React.FC<{
  events: EventProgramme[];
  defaultEventId: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ events, defaultEventId, onClose, onCreated }) => {
  const { t } = useOrganizer();
  const [eventId, setEventId] = useState<string>(defaultEventId ?? '');
  const day =
    events.find((e) => e.id === eventId)?.event_date ?? toLocalDay(new Date()).slice(0, 10);
  const [meeting, setMeeting] = useState<MeetingDraft>(() => emptyMeeting(day, 9));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!meeting.title.trim()) {
      toast.error(t({ ne: 'बैठकको नाम लेख्नुहोस्', en: 'Give the meeting a name' }));
      return;
    }
    const named = meeting.sessions.filter((x) => x.title.trim());
    if (named.length === 0) {
      toast.error(
        t({
          ne: 'कम्तीमा एउटा सत्र चाहिन्छ',
          en: 'A meeting needs at least one session',
        })
      );
      return;
    }
    const incomplete = missingSpeakerDetails(meeting);
    if (incomplete.length > 0) {
      toast.error(
        t({
          ne: `वक्ताको नाम, इमेल र फोन चाहिन्छ: ${incomplete.join(', ')}`,
          en: `A speaker name, email and phone are needed for: ${incomplete.join(', ')}`,
        })
      );
      return;
    }

    // The gap is mandatory, so a running order typed too tight is put right
    // here - with the organizer agreeing to the new times - rather than
    // being bounced back by the server.
    const plan = confirmSpacing([meeting], window.confirm);
    if (!plan) return;

    try {
      setBusy(true);
      const created = await apiClient.createMeetingWithSessions(
        toApiMeeting(plan[0]),
        eventId || null
      );
      toast.success(
        t({
          ne: `${created.title} बन्यो (${created.meeting_code})`,
          en: `${created.title} created (${created.meeting_code})`,
        })
      );
      onCreated();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बनाउन सकिएन', en: 'Could not create it' })));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t({ ne: 'नयाँ बैठक', en: 'New meeting' })}
      lede={t({
        ne: 'बैठक कुनै कार्यक्रमभित्र राख्न सकिन्छ, वा एक्लै। सत्रचाहिँ कम्तीमा एउटा चाहिन्छ।',
        en: 'A meeting can sit inside a programme or stand on its own. Either way it needs at least one session.',
      })}
      footer={
        <>
          <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn tone="amber" onClick={save} disabled={busy}>
            {busy ? t({ ne: 'बन्दै…', en: 'Creating…' }) : t({ ne: 'बनाउनुहोस्', en: 'Create' })}
          </Btn>
        </>
      }
    >
      <label className="block text-[12px] text-[#6E7C8E] mb-1">
        {t({ ne: 'कुन कार्यक्रमभित्र', en: 'Part of which programme' })}
      </label>
      <select
        value={eventId}
        onChange={(e) => setEventId(e.target.value)}
        className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px] bg-white mb-3.5"
      >
        <option value="">
          {t({ ne: 'कुनै पनि होइन — एक्लै बैठक', en: 'None — a meeting on its own' })}
        </option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title} · {new Date(e.event_date).toLocaleDateString()}
          </option>
        ))}
      </select>

      <MeetingDraftFields meeting={meeting} onChange={setMeeting} />
    </Modal>
  );
};

/** Add one more session to a meeting that already exists. */
const NewSessionModal: React.FC<{
  meeting: PlannedMeeting;
  onClose: () => void;
  onCreated: () => void;
}> = ({ meeting, onClose, onCreated }) => {
  const { t } = useOrganizer();

  // A new session picks up after the last one has finished and the
  // mandatory gap has passed, in the same hall.
  const last = meeting.sessions[meeting.sessions.length - 1];
  const [draft, setDraft] = useState<SessionDraft>(() => ({
    title: '',
    speaker_name: '',
    speaker_email: '',
    speaker_phone: '',
    speaker_visibility: 'private',
    hall: last?.hall ?? '',
    starts_at: toLocalDay(
      new Date(
        last
          ? last.startsAt + (last.durationMinutes + GAP_MINUTES) * 60000
          : meeting.startsAt
      )
    ),
    duration_minutes: 30,
  }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.title.trim()) {
      toast.error(t({ ne: 'सत्रको नाम लेख्नुहोस्', en: 'Give the session a name' }));
      return;
    }
    if (!draft.speaker_name?.trim() || !draft.speaker_email?.trim() || !draft.speaker_phone?.trim()) {
      toast.error(
        t({
          ne: 'वक्ताको नाम, इमेल र फोन चाहिन्छ',
          en: 'A speaker name, email and phone are needed',
        })
      );
      return;
    }
    try {
      setBusy(true);
      await apiClient.createSession({
        meeting: meeting.id,
        title: draft.title.trim(),
        speaker_name: draft.speaker_name,
        speaker_email: draft.speaker_email,
        speaker_phone: draft.speaker_phone,
        speaker_visibility: draft.speaker_visibility,
        hall: draft.hall,
        starts_at: new Date(draft.starts_at).toISOString(),
        duration_minutes: draft.duration_minutes,
      });
      toast.success(t({ ne: 'सत्र थपियो', en: 'Session added' }));
      onCreated();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'थप्न सकिएन', en: 'Could not add it' })));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t({ ne: 'सत्र थप्नुहोस्', en: 'Add a session' })}
      lede={meeting.title}
      footer={
        <>
          <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn tone="amber" onClick={save} disabled={busy}>
            {busy ? t({ ne: 'थप्दै…', en: 'Adding…' }) : t({ ne: 'थप्नुहोस्', en: 'Add' })}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'सत्रको नाम', en: 'Session name' })}
          </label>
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
          />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'वक्ता', en: 'Speaker' })}
            </label>
            <input
              value={draft.speaker_name ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, speaker_name: e.target.value }))}
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'हल', en: 'Hall' })}
            </label>
            <input
              list="manch-halls"
              value={draft.hall ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, hall: e.target.value }))}
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
            />
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px]">
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'वक्ताको इमेल', en: "Speaker's email" })}
            </label>
            <input
              type="email"
              value={draft.speaker_email ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, speaker_email: e.target.value }))}
              placeholder="name@example.com"
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'फोन', en: 'Phone' })}
            </label>
            <input
              value={draft.speaker_phone ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, speaker_phone: e.target.value }))}
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'सम्पर्क कसरी', en: 'How they can be contacted' })}
          </label>
          <select
            value={draft.speaker_visibility ?? 'private'}
            onChange={(e) =>
              setDraft((d) => ({ ...d, speaker_visibility: e.target.value as 'public' | 'private' }))
            }
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px] bg-white"
          >
            <option value="private">
              {t({ ne: 'निजी — अनुरोध तपाईंकहाँ आउँछ', en: 'Private — requests come to you' })}
            </option>
            <option value="public">
              {t({ ne: 'सार्वजनिक — सत्र सकिएपछि सबैले देख्छन्', en: 'Public — anyone may see it once the session is over' })}
            </option>
          </select>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_110px]">
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'सुरु', en: 'Starts' })}
            </label>
            <input
              type="datetime-local"
              value={draft.starts_at}
              onChange={(e) => setDraft((d) => ({ ...d, starts_at: e.target.value }))}
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[13.5px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'मिनेट', en: 'Minutes' })}
            </label>
            <input
              type="number"
              min={5}
              step={5}
              value={draft.duration_minutes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, duration_minutes: Number(e.target.value) || 30 }))
              }
              className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px] text-center"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
