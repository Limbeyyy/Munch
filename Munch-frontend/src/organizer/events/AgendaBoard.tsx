import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { useSessionGap } from '../sessionGap';
import { Btn } from '../ui';
import {
  PlannedEvent, PlannedSession,
  applyEdit, countChanges, pendingChanges, setHall, swapSessions, toPlan, whyNotSwap,
} from '../schedule';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A local value for <input type="datetime-local">. */
const toLocalInput = (ms: number) => {
  const at = new Date(ms);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
};

/** A session already run, or running, keeps the time it actually had. */
const settled = (s: PlannedSession) => s.status !== 'scheduled';

interface Props {
  event: Event;
  /** Re-read the event once the running order has been written. */
  onChanged: () => Promise<void> | void;
  /** Offered where there is nothing to arrange yet. */
  onAdd?: () => void;
  /** Open one to change its name, speaker or notes. */
  onEdit?: (sessionId: string) => void;
}

/**
 * The running order, arranged in place.
 *
 * Dragging a talk onto another swaps the two; changing a time or a length
 * pushes what follows out of the way. Both go through the same engine the
 * agenda screen uses, so the rules only exist once: the gap between talks
 * is kept, the first talk stays pinned to the hour the event opens, and
 * anything that has already run keeps the time it actually had.
 *
 * Nothing is written until it is saved, so a rearrangement can be thought
 * about and abandoned. Nothing is *started* from here either: putting a
 * talk on stage belongs to the room and to live control, where whoever
 * does it is watching the room at the time.
 */
export const AgendaBoard: React.FC<Props> = ({ event, onChanged, onAdd, onEdit }) => {
  const { t, num } = useOrganizer();
  const gapMinutes = useSessionGap();

  const [plan, setPlan] = useState<PlannedEvent[]>(() => toPlan([event]));
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The server moves the day about too - a session started early brings
  // the rest forward - so the board follows what it last said.
  useEffect(() => { setPlan(toPlan([event])); }, [event]);

  const day = plan[0];
  const sessions = day?.sessions ?? [];
  const changes = countChanges(plan);

  /**
   * Two talks change places, each taking the other's slot.
   *
   * Refusals are spoken rather than silent: a row that will not go where
   * it was dropped looks broken otherwise, and the reason is never
   * obvious from the row itself.
   */
  const swap = (fromId: string, toId: string) => {
    const refusal = whyNotSwap(plan, fromId, toId);
    if (refusal === 'settled') {
      toast.error(t({
        ne: 'चलिसकेको वा चलिरहेको सत्रको समय फेरिँदैन।',
        en: 'A session that has run, or is running, keeps its time.',
      }));
      return;
    }
    if (refusal !== null) return;

    const moved = sessions.find((s) => s.id === fromId);
    const other = sessions.find((s) => s.id === toId);
    setPlan((p) => swapSessions(p, fromId, toId, gapMinutes));
    if (moved && other) {
      toast.success(t({
        ne: `“${moved.title}” र “${other.title}” ले ठाउँ साटे`,
        en: `“${moved.title}” and “${other.title}” changed places`,
      }));
    }
  };

  /** Alt with an arrow moves a row, for anybody not using a mouse. */
  const nudge = (session: PlannedSession, by: -1 | 1) => {
    const at = sessions.findIndex((s) => s.id === session.id);
    const neighbour = sessions[at + by];
    if (neighbour) swap(session.id, neighbour.id);
  };

  const revert = () => setPlan(toPlan([event]));

  /** Take a talk out of the running order for good. */
  const remove = async (session: PlannedSession) => {
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
      await onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' })));
    } finally {
      setRemoving(null);
    }
  };

  /** Write every row the reflow touched, then read the day back. */
  const save = async () => {
    const { sessions: touched } = pendingChanges(plan);
    if (touched.length === 0) return;

    try {
      setSaving(true);
      // The whole rearrangement goes in one transaction. The event's own
      // window follows its running order on the server, so it is not sent
      // separately and cannot end up disagreeing with it.
      await apiClient.rescheduleSessions(
        touched.map((s) => ({
          id: s.id,
          starts_at: new Date(s.startsAt).toISOString(),
          duration_minutes: s.durationMinutes,
          hall: s.hall,
        }))
      );
      toast.success(t({
        ne: `${num(touched.length)} परिवर्तन सेभ भयो`,
        en: `${touched.length} change${touched.length === 1 ? '' : 's'} saved`,
      }));
      await onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सेभ गर्न सकिएन', en: 'Could not save' })));
    } finally {
      setSaving(false);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[14px] text-head">
          {t({ ne: 'अझै सत्र छैन।', en: 'Nothing on the running order yet.' })}
        </p>
        {onAdd && (
          <Btn tone="solid" className="mt-4" onClick={onAdd}>
            {t({ ne: 'सत्र थप्नुहोस्', en: 'Add a session' })}
          </Btn>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="text-[12.5px] text-subtle pb-3">
        {t({
          ne: 'क्रम मिलाउन तान्नुहोस्। समय वा अवधि बदल्दा पछिका सत्र आफैँ सर्छन्।',
          en: 'Drag to reorder. Changing a time or a length moves what follows.',
        })}
      </p>

      <ul className="flex flex-col">
        {sessions.map((one, at) => {
          const fixed = settled(one);
          const ends = one.startsAt + one.durationMinutes * 60000;
          return (
            <li
              key={one.id}
              draggable={!fixed}
              aria-grabbed={dragging === one.id}
              onDragStart={(e) => {
                setDragging(one.id);
                e.dataTransfer.setData('text/plain', one.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                if (!fixed && dragging && dragging !== one.id) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData('text/plain') || dragging;
                setDragging(null);
                if (fromId && fromId !== one.id) swap(fromId, one.id);
              }}
              onKeyDown={(e) => {
                // Alt with an arrow, so the keyboard can do what the mouse can.
                if (!e.altKey) return;
                if (e.key === 'ArrowUp') { e.preventDefault(); nudge(one, -1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); nudge(one, 1); }
              }}
              tabIndex={fixed ? -1 : 0}
              className={`flex items-center gap-3 py-3 border-b border-line last:border-0
                ${fixed ? 'opacity-70' : 'cursor-grab'}
                ${dragging === one.id ? 'bg-[#eff6ff]' : ''}`}
            >
              <span
                aria-hidden
                className={`text-[14px] leading-none flex-none w-4 text-center
                  ${fixed ? 'text-line' : 'text-faint'}`}
                title={fixed ? undefined : t({ ne: 'तान्नुहोस्', en: 'Drag to reorder' })}
              >
                ⠿
              </span>

              <span className="font-mono text-[12.5px] text-subtle tabular-nums flex-none">
                {clock(one.startsAt)}–{clock(ends)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-head truncate">
                  {one.title}
                </span>
                <span className="text-[12.5px] text-subtle truncate">
                  {num(one.durationMinutes)}′
                  {one.speaker_name && ` · ${one.speaker_name}`}
                </span>
              </span>

              {/* When it starts, and how long for. Both reflow the rest. */}
              <input
                type="datetime-local"
                aria-label={t({ ne: 'सुरु', en: 'Starts' })}
                disabled={fixed}
                value={toLocalInput(one.startsAt)}
                onChange={(e) => {
                  const next = +new Date(e.target.value);
                  if (!Number.isNaN(next)) {
                    setPlan((p) => applyEdit(p, one.id, { startsAt: next }, gapMinutes));
                  }
                }}
                className="border border-line rounded-[8px] px-2 py-1 text-[12.5px]
                  text-head flex-none disabled:opacity-50"
              />
              <input
                aria-label={t({ ne: 'हल', en: 'Hall' })}
                placeholder={t({ ne: 'हल', en: 'Hall' })}
                value={one.hall}
                onChange={(e) => setPlan((p) => setHall(p, one.id, e.target.value))}
                className="border border-line rounded-[8px] px-2 py-1 text-[12.5px]
                  text-head w-[92px] flex-none"
              />
              <input
                type="number"
                min={5}
                step={5}
                aria-label={t({ ne: 'मिनेट', en: 'Minutes' })}
                disabled={fixed}
                value={one.durationMinutes}
                onChange={(e) =>
                  setPlan((p) => applyEdit(
                    p, one.id, { durationMinutes: Number(e.target.value) || 5 }, gapMinutes
                  ))
                }
                className="border border-line rounded-[8px] px-2 py-1 text-[12.5px]
                  text-head w-[68px] flex-none disabled:opacity-50"
              />

              {one.moved && (
                <span className="bg-[#FEF6E7] text-[#B26A00] rounded-[4px] px-2 py-0.5
                  text-[12px] leading-4 flex-none">
                  {t({ ne: 'सारिएको', en: 'Moved' })}
                </span>
              )}
              {fixed && (
                <span className="bg-[#F3F4F6] text-faint rounded-[4px] px-2 py-0.5
                  text-[12px] leading-4 flex-none">
                  {one.status === 'live'
                    ? t({ ne: 'मञ्चमा', en: 'On stage' })
                    : t({ ne: 'सकियो', en: 'Run' })}
                </span>
              )}

              {onEdit && (
                <button
                  onClick={() => onEdit(one.id)}
                  className="text-[13px] text-tagink hover:underline flex-none"
                >
                  {t({ ne: 'सम्पादन', en: 'Edit' })}
                </button>
              )}
              {/* The only way off the running order, so it asks first
                  and says what else goes with it. */}
              <button
                onClick={() => remove(one)}
                disabled={removing === one.id || one.status === 'live'}
                aria-label={t({ ne: 'सत्र हटाउने', en: 'Remove session' })}
                title={t({ ne: 'सत्र हटाउने', en: 'Remove session' })}
                className="w-7 h-7 rounded-md text-faint flex-none
                  hover:text-live hover:bg-live/[.08] disabled:opacity-40"
              >
                ×
              </button>
              <span className="sr-only">{num(at + 1)}</span>
            </li>
          );
        })}
      </ul>

      {/* Nothing is written until it is asked for, so a rearrangement can
          be thought about and abandoned. */}
      {changes > 0 && (
        <div className="flex items-center gap-3 pt-4">
          <p className="text-[13px] text-subtle flex-1">
            {t({
              ne: `${num(changes)} परिवर्तन सेभ बाँकी`,
              en: `${changes} unsaved change${changes === 1 ? '' : 's'}`,
            })}
          </p>
          <Btn onClick={revert} disabled={saving}>
            {t({ ne: 'उल्टाउनुहोस्', en: 'Revert' })}
          </Btn>
          <Btn tone="solid" onClick={save} disabled={saving}>
            {saving
              ? t({ ne: 'सेभ गर्दै…', en: 'Saving…' })
              : t({ ne: 'क्रम सेभ गर्नुहोस्', en: 'Save the order' })}
          </Btn>
        </div>
      )}
    </div>
  );
};
