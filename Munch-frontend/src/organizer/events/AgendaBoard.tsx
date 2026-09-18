import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Artifact, Event } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { useSessionGap } from '../sessionGap';
import { Btn } from '../ui';
import { FileBadge } from './fileKinds';
import {
  PlannedEvent, PlannedSession,
  applyEdit, countChanges, pendingChanges, swapSessions, toPlan, whyNotSwap,
} from '../schedule';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A session already run, or running, keeps the time it actually had. */
const settled = (s: PlannedSession) => s.status !== 'scheduled';

/** The card's own ordinal: 01, 02, 03, the way the design numbers them. */
const ordinal = (at: number) => String(at + 1).padStart(2, '0');

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
  /**
   * The files shared against each talk, for the column the design puts
   * down the right of a card.
   *
   * Decoration rather than substance: an event being typed for the first
   * time has none, and a board that cannot reach them is still a board -
   * so a refusal here leaves the column off rather than the screen.
   */
  const [documents, setDocuments] = useState<Record<string, Artifact[]>>({});

  // The server moves the day about too - a session started early brings
  // the rest forward - so the board follows what it last said.
  useEffect(() => { setPlan(toPlan([event])); }, [event]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const all = await apiClient.getResources(event.id);
        if (!live) return;
        const bySession: Record<string, Artifact[]> = {};
        all.forEach((one) => {
          if (!one.session) return;
          bySession[one.session] = [...(bySession[one.session] ?? []), one];
        });
        setDocuments(bySession);
      } catch {
        if (live) setDocuments({});
      }
    })();
    return () => { live = false; };
  }, [event.id]);

  const day = plan[0];
  const sessions = day?.sessions ?? [];
  const changes = countChanges(plan);

  /** What the plan does not carry: a talk's own words, and its speaker's. */
  const detailOf = (id: string) => (event.sessions ?? []).find((s) => s.id === id);

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

      <ul className="flex flex-col gap-3">
        {sessions.map((one, at) => {
          const fixed = settled(one);
          const ends = one.startsAt + one.durationMinutes * 60000;
          // The plan carries what the scheduler needs; the words a talk
          // was written with come from the event itself.
          const more = detailOf(one.id);
          const files = documents[one.id] ?? [];
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
              className={`bg-white border-[0.6px] border-line rounded-[12px] p-5
                flex items-start gap-4
                shadow-[0px_1px_1px_rgba(0,0,0,0.11),0px_1px_1.5px_rgba(0,0,0,0.15)]
                ${fixed ? 'opacity-70' : 'cursor-grab'}
                ${dragging === one.id ? 'border-navy-500' : ''}`}
            >
              {/* Where this talk comes in the order, and the grip that moves it. */}
              <div className="flex-none w-8 flex flex-col items-start pt-0.5">
                <span className="text-[24px] font-light leading-8 text-[#959595] tabular-nums">
                  {num(ordinal(at))}
                </span>
                <span
                  aria-hidden
                  className={`text-[14px] leading-none ${fixed ? 'text-line' : 'text-faint'}`}
                  title={fixed ? undefined : t({ ne: 'तान्नुहोस्', en: 'Drag to reorder' })}
                >
                  ⠿
                </span>
              </div>

              <div className="min-w-0 flex-1 flex flex-col">
                <p className="font-mono text-[12px] leading-4 text-faint tabular-nums">
                  {clock(one.startsAt)} – {clock(ends)}
                </p>
                <p className="pt-1 text-[15px] font-semibold text-head leading-[22.5px] truncate">
                  {one.title}
                </p>

                <div className="pt-2 flex flex-col items-start">
                  {one.speaker_name ? (
                    <>
                      <span className="text-[12px] leading-4 text-faint">
                        {t({ ne: 'वक्ता', en: 'Speaker' })}
                      </span>
                      <span className="pt-0.5 text-[14px] leading-5 font-medium text-[#364153]">
                        {one.speaker_name}
                      </span>
                      {more?.speaker_role && (
                        <span className="text-[12px] leading-4 text-subtle">
                          {more.speaker_role}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[12px] leading-4 italic text-faint">
                      {t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker assigned' })}
                    </span>
                  )}
                  {/* The speaker is written on the same form the talk is,
                      so this is a way into it rather than a second one. */}
                  {onEdit && (
                    <button
                      onClick={() => onEdit(one.id)}
                      className="pt-1.5 text-[12px] leading-4 text-[#155DFC] hover:underline"
                    >
                      {one.speaker_name
                        ? t({ ne: 'वक्ता फेर्नुहोस्', en: 'Change speaker' })
                        : t({ ne: 'वक्ता थप्नुहोस्', en: 'Add speaker' })}
                    </button>
                  )}
                </div>

                {more?.description && (
                  <p className="pt-2 text-[12px] leading-[19.5px] text-subtle">
                    {more.description}
                  </p>
                )}

                {/* How long it runs, which reflows what follows. When it
                    starts is read off the card rather than typed into it:
                    the hour belongs to the talk, and the talk is changed
                    on the form the Edit button opens. */}
                <div className="pt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
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
                        text-head w-[68px] disabled:opacity-50"
                    />
                    <span className="text-[12.5px] text-subtle">
                      {t({ ne: 'मिनेट', en: 'min' })}
                    </span>
                  </label>

                  {one.moved && (
                    <span className="bg-[#FEF6E7] text-[#B26A00] rounded-[4px] px-2 py-0.5
                      text-[12px] leading-4">
                      {t({ ne: 'सारिएको', en: 'Moved' })}
                    </span>
                  )}
                  {fixed && (
                    <span className="bg-[#F3F4F6] text-faint rounded-[4px] px-2 py-0.5
                      text-[12px] leading-4">
                      {one.status === 'live'
                        ? t({ ne: 'मञ्चमा', en: 'On stage' })
                        : t({ ne: 'सकियो', en: 'Run' })}
                    </span>
                  )}
                </div>
              </div>

              {/* What was shared against this talk. Left off where there is
                  nothing yet, rather than drawn as an empty column. */}
              {files.length > 0 && (
                <div className="flex-none w-[157px] flex flex-col gap-1 pt-11">
                  <span className="text-[12px] leading-4 text-faint pb-0.5">
                    {t({ ne: 'कागजात', en: 'Documents' })}
                  </span>
                  {files.map((file) => (
                    <span key={file.id} className="flex items-center gap-2">
                      <FileBadge name={file.display_name} />
                      <span className="text-[12px] leading-4 text-body truncate">
                        {file.display_name}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex-none flex items-center gap-2">
                {onEdit && (
                  <button
                    onClick={() => onEdit(one.id)}
                    className="bg-white border-[0.6px] border-[#5B94E4] rounded-[8px]
                      px-3 py-1.5 text-[12px] leading-4 text-navy-800 hover:bg-tagbg"
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
                  className="w-7 h-7 rounded-md text-faint
                    hover:text-live hover:bg-live/[.08] disabled:opacity-40"
                >
                  ×
                </button>
              </div>
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
