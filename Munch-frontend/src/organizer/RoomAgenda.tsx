import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Meeting, Session } from '../types';
import { errorText } from './errors';
import { useOrganizer } from './i18n';
import { useSessionGap } from './sessionGap';
import { PlannedMeeting, PlannedSession, swapSessions, toPlan, whyNotSwap } from './schedule';

const MS = 60000;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  /** The meeting the room is holding. */
  meeting: Meeting;
  /** Its running order, as the server last gave it. */
  sessions: Session[];
  /** What is on stage, if anything. */
  liveSessionId?: string | null;
  /** Whether this pair of hands may rearrange it. The host's, and no other. */
  canEdit: boolean;
  /** Re-read the running order, once the server has a new one. */
  onChanged: () => void;
}

/**
 * The running order, live, inside the room.
 *
 * The agenda screen has always let the host drag one session onto another
 * to change their places. That was for beforehand, though - a day being
 * planned - and the room had a read-only list of titles with no times on
 * it at all. It is the wrong way round: the running order matters most
 * while the meeting is happening, when a speaker has not arrived and the
 * one after them is standing in the hall.
 *
 * So this is the same operation in the place it is needed, with the times
 * on show. Drag a talk onto another and the two change places; the day
 * reflows around whatever has already run, and the change is written down
 * at once so every other screen in the room sees it - which is what makes
 * the times underneath live rather than a plan somebody typed this
 * morning. A talk that has run, or is on stage, keeps its time and cannot
 * be dragged.
 *
 * Everybody in the room sees this list. Only the host can move anything in
 * it: for everyone else it is the same times, read-only, following along.
 */
export const RoomAgenda: React.FC<Props> = ({
  meeting, sessions, liveSessionId, canEdit, onChanged,
}) => {
  const { t, num } = useOrganizer();
  const gapMinutes = useSessionGap();

  /** The running order as it stands, in the shape the schedule engine uses. */
  const fromServer = useMemo<PlannedMeeting[]>(
    () => toPlan([{
      ...(meeting as any),
      sessions: sessions as any,
    }]),
    [meeting, sessions]
  );

  const [plan, setPlan] = useState<PlannedMeeting[]>(fromServer);
  useEffect(() => { setPlan(fromServer); }, [fromServer]);

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * The clock, so "twenty minutes over" stays true without a reload.
   *
   * Only the wording depends on it; the times themselves come from the
   * server, which is the one clock everybody in the room shares.
   */
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const rows: PlannedSession[] = plan[0]?.sessions ?? [];

  /**
   * Two talks change places, and the day is written down as it now stands.
   *
   * Saved on the drop rather than behind a button: the host is standing in
   * the room deciding who speaks next, and a running order that is only
   * true on their screen is worse than none.
   */
  const swap = useCallback(async (fromId: string, toId: string) => {
    const refusal = whyNotSwap(plan, fromId, toId);
    if (refusal === 'settled') {
      toast.error(t({
        ne: 'चलिसकेको वा चलिरहेको सत्रको समय फेरिँदैन।',
        en: 'A session that has run, or is running, keeps its time.',
      }));
      return;
    }
    if (refusal !== null) return;

    const before = plan;
    const next = swapSessions(plan, fromId, toId, gapMinutes);
    setPlan(next);

    const moved = next.flatMap((m) => m.sessions).filter((s) => s.moved);
    if (moved.length === 0) return;

    try {
      setSaving(true);
      await apiClient.rescheduleSessions(
        moved.map((s) => ({
          id: s.id,
          starts_at: new Date(s.startsAt).toISOString(),
          duration_minutes: s.durationMinutes,
        }))
      );
      onChanged();
    } catch (e: any) {
      setPlan(before);
      toast.error(errorText(e, t({ ne: 'सेभ गर्न सकिएन', en: 'Could not save that' })));
    } finally {
      setSaving(false);
    }
  }, [plan, gapMinutes, onChanged, t]);

  /** Alt with an arrow moves a talk, for anybody not using a mouse. */
  const nudge = (session: PlannedSession, by: -1 | 1) => {
    const at = rows.findIndex((s) => s.id === session.id);
    const neighbour = rows[at + by];
    if (neighbour) swap(session.id, neighbour.id);
  };

  /*
   * What the meeting comes to as it stands.
   *
   * Not what was advertised: the running order is what the day is, and it
   * moves. The host watching a talk overrun should see the hour the
   * meeting now finishes at, and see it come back down again when the next
   * one is short.
   */
  const lastEnd = rows.length
    ? Math.max(...rows.map((s) => s.startsAt + s.durationMinutes * MS))
    : null;
  const advertised = +new Date(meeting.scheduled_end);
  const drift = lastEnd === null ? 0 : Math.round((lastEnd - advertised) / MS);
  const firstStart = rows.length
    ? Math.min(...rows.map((s) => s.startsAt))
    : +new Date(meeting.scheduled_start);

  const driftLine = () => {
    if (lastEnd === null || Math.abs(drift) < 1) return null;
    if (drift > 0) {
      return t({
        ne: `तालिकाभन्दा ${num(drift)} मिनेट लामो`,
        en: `${drift} min past the hour it was set to finish`,
      });
    }
    return t({
      ne: `तालिकाभन्दा ${num(-drift)} मिनेट छिटो`,
      en: `${-drift} min earlier than it was set to finish`,
    });
  };

  const stateOf = (session: PlannedSession) => {
    if (session.id === liveSessionId || session.status === 'live') return 'live';
    if (session.status === 'done') return 'done';
    if (session.status === 'skipped') return 'skipped';
    return 'ahead';
  };

  const row = (session: PlannedSession) => {
    const state = stateOf(session);
    const onStage = state === 'live';
    const fixed = state !== 'ahead';
    const running = onStage && session.startsAt + session.durationMinutes * MS < tick;

    return (
      <li
        key={session.id}
        aria-current={onStage}
        onDragOver={(e) => {
          if (!canEdit || !dragging || dragging === session.id) return;
          e.preventDefault();
          setOver(session.id);
        }}
        onDragLeave={() => setOver((id) => (id === session.id ? null : id))}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          const fromId = dragging || e.dataTransfer.getData('text/plain');
          setOver(null);
          setDragging(null);
          if (fromId) swap(fromId, session.id);
        }}
        className={`flex items-center gap-2 px-2 py-2 border-b-[0.5px] border-[#b3b3b3]
          last:border-0 ${onStage ? 'bg-[#007092] text-white' : 'bg-[#fcfcfc]'}
          ${over === session.id ? 'outline outline-2 -outline-offset-2 outline-amber' : ''}
          ${dragging === session.id ? 'opacity-50' : ''}`}
      >
        {canEdit && (
          <button
            type="button"
            draggable={!fixed && !saving}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', session.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragging(session.id);
            }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onKeyDown={(e) => {
              if (!e.altKey) return;
              if (e.key === 'ArrowUp') { e.preventDefault(); nudge(session, -1); }
              if (e.key === 'ArrowDown') { e.preventDefault(); nudge(session, 1); }
            }}
            disabled={fixed || saving}
            aria-label={t({
              ne: `“${session.title}” सार्नुहोस्`,
              en: `Move “${session.title}”`,
            })}
            title={t({
              ne: 'तानेर अर्को सत्रमा छोड्नुहोस् — दुवैले ठाउँ साट्छन्',
              en: 'Drag onto another session — the two change places',
            })}
            className={`w-5 h-7 flex-none rounded-md leading-none text-[15px]
              ${onStage ? 'text-white/70' : 'text-[#6E7C8E]'}
              ${fixed ? 'opacity-25' : 'cursor-grab hover:bg-navy-800/[.06]'}`}
          >
            ⠿
          </button>
        )}

        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-medium leading-[1.2] truncate
            ${onStage ? 'text-white' : 'text-black'}`}>
            {session.title}
          </p>
          <p className={`text-[13px] leading-[1.5] truncate
            ${onStage ? 'text-white/85' : 'text-[#4a5567]'}`}>
            {session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
          </p>
        </div>

        <div className="flex-none text-end">
          <p className={`text-[13px] tabular-nums whitespace-nowrap
            ${onStage ? 'text-white' : 'text-[#030712]'}`}>
            {clock(session.startsAt)}–{clock(session.startsAt + session.durationMinutes * MS)}
          </p>
          <p className={`text-[12px] whitespace-nowrap
            ${onStage ? 'text-white/85' : 'text-[#656565]'}`}>
            {state === 'done'
              ? t({ ne: 'सकियो', en: 'Finished' })
              : state === 'skipped'
              ? t({ ne: 'छाडियो', en: 'Skipped' })
              : running
              ? t({ ne: 'समय नाघेको', en: 'Running over' })
              : onStage
              ? t({ ne: 'चलिरहेको', en: 'On stage' })
              : t({ ne: `${num(session.durationMinutes)} मिनेट`, en: `${session.durationMinutes} min` })}
          </p>
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="bg-[#fcfcfc] px-4 py-2 border-b border-[#e3e8ef]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-medium text-black leading-[1.2]">
            {t({ ne: 'कार्यसूची', en: 'Agenda Summary' })}
          </h2>
          <span className="text-[13px] tabular-nums text-[#4a5567] whitespace-nowrap">
            {rows.length > 0 && lastEnd !== null
              ? `${clock(firstStart)}–${clock(lastEnd)}`
              : ''}
          </span>
        </div>
        {driftLine() && (
          <p className={`text-[12px] mt-0.5 ${drift > 0 ? 'text-amber-700' : 'text-ok'}`}>
            {driftLine()}
          </p>
        )}
        <p className="text-[11px] text-[#656565] mt-0.5">
          {canEdit
            ? t({
                ne: 'एउटा सत्र तानेर अर्कोमा छोड्नुहोस् — दुवैले ठाउँ साट्छन्, र समय सबैलाई तुरुन्तै देखिन्छ।',
                en: 'Drag a session onto another to change their places. Everybody in the room sees the new times at once.',
              })
            : t({
                ne: 'सञ्चालकले तालिका मिलाउँदा यहाँ तुरुन्तै देखिन्छ।',
                en: 'These times follow the host as they rearrange the day.',
              })}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[14px] text-[#656565] px-4 py-3">
          {t({ ne: 'कार्यसूचीमा केही छैन।', en: 'Nothing in the running order yet.' })}
        </p>
      ) : (
        <ul
          aria-label={t({ ne: 'कार्यसूची', en: 'Running order' })}
          className="max-h-[458px] overflow-y-auto"
        >
          {rows.map(row)}
        </ul>
      )}
    </>
  );
};
