import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EventProgramme } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Card, Chip, Empty, Head, Panel } from '../ui';
import {
  MEETING_GAP_MINUTES, PlannedMeeting, PlannedSession,
  applyEdit, countChanges, hallsInUse, pendingChanges, reflowMeeting, setHall, toPlan,
} from '../schedule';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A local value for <input type="datetime-local">. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

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
      const results = await Promise.allSettled([
        ...sessions.map((s) =>
          apiClient.updateSession(s.id, {
            starts_at: new Date(s.startsAt).toISOString(),
            duration_minutes: s.durationMinutes,
            hall: s.hall,
          })
        ),
        ...meetings.map((m) =>
          apiClient.updateMeeting(m.id, {
            scheduled_start: new Date(m.startsAt).toISOString(),
            scheduled_end: new Date(m.endsAt).toISOString(),
          })
        ),
      ]);

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(
          t({
            ne: `${num(failed)} परिवर्तन सेभ भएन`,
            en: `${failed} change${failed === 1 ? '' : 's'} could not be saved`,
          })
        );
      } else {
        toast.success(
          t({
            ne: `${num(sessions.length + meetings.length)} परिवर्तन सेभ भयो`,
            en: `${sessions.length + meetings.length} change${sessions.length + meetings.length === 1 ? '' : 's'} saved`,
          })
        );
      }

      const list = await apiClient.listEvents();
      setEvents(list);
      const chosen = list.find((e) => e.id === eventId);
      setPlan(chosen ? toPlan(chosen.meetings) : []);
      onChanged();
    } catch {
      toast.error(t({ ne: 'सेभ गर्न सकिएन', en: 'Could not save' }));
    } finally { setSaving(false); }
  };

  const statusChip = (status: PlannedSession['status']) => {
    if (status === 'live') return <Chip tone="live">{t({ ne: 'सुरु भयो', en: 'Started' })}</Chip>;
    if (status === 'done') return <Chip tone="ok">{t({ ne: 'सकियो', en: 'Finished' })}</Chip>;
    if (status === 'skipped') return <Chip tone="draft">{t({ ne: 'छाडियो', en: 'Skipped' })}</Chip>;
    return <Chip tone="warn">{t({ ne: 'आउँदै', en: 'Upcoming' })}</Chip>;
  };

  const sessionRow = (meeting: PlannedMeeting, session: PlannedSession) => {
    const locked = session.status === 'done';
    return (
      <div
        key={session.id}
        className={`grid gap-2.5 items-center px-4 py-2.5 border-b border-navy-800/[.08] last:border-0 ${
          session.moved ? 'bg-amber/[.08]' : ''
        }`}
        style={{ gridTemplateColumns: 'minmax(0,1fr) 150px 172px 84px 92px 112px' }}
      >
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

        <span className="text-[12.5px] text-[#6E7C8E] tabular-nums text-end">
          {clock(session.startsAt)}–{clock(session.startsAt + session.durationMinutes * 60000)}
        </span>

        <span className="text-end">{statusChip(session.status)}</span>
      </div>
    );
  };

  return (
    <>
      <Head
        title={{ ne: 'सत्रहरू', en: 'Sessions' }}
        lede={{
          ne: 'अर्को सत्रकै समय राख्नुभयो भने दुवैले ठाउँ साट्छन्। अरू कुनै समय राख्दा त्यो सत्र सबैभन्दा नजिकको खाली समयमा बस्छ — बीचमा कम्तीमा १५ मिनेट।',
          en: `Give a session the time another one holds and the two trade places. Any other time puts it at the nearest free point, with at least ${MEETING_GAP_MINUTES} minutes either side.`,
        }}
        actions={
          <>
            {changes > 0 && (
              <Btn onClick={revert} disabled={saving}>
                {t({ ne: 'फिर्ता', en: 'Discard' })}
              </Btn>
            )}
            <Btn tone="amber" onClick={save} disabled={changes === 0 || saving}>
              {saving
                ? t({ ne: 'सेभ हुँदै…', en: 'Saving…' })
                : changes > 0
                ? t({
                    ne: `${num(changes)} परिवर्तन सेभ गर्नुहोस्`,
                    en: `Save ${changes} change${changes === 1 ? '' : 's'}`,
                  })
                : t({ ne: 'सेभ गर्न केही छैन', en: 'Nothing to save' })}
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
                    }
                  >
                    {meeting.sessions.length === 0 ? (
                      <Empty>{t({ ne: 'यो बैठकमा सत्र छैन।', en: 'No sessions in this meeting.' })}</Empty>
                    ) : (
                      <>
                        <div
                          className="grid gap-2.5 px-4 py-2 bg-[#FBFAF6] border-b border-navy-800/15 text-xs text-[#6E7C8E] font-medium"
                          style={{ gridTemplateColumns: 'minmax(0,1fr) 150px 172px 84px 92px 112px' }}
                        >
                          <span>{t({ ne: 'सत्र', en: 'Session' })}</span>
                          <span>{t({ ne: 'सुरु', en: 'Starts' })}</span>
                          <span className="text-center">{t({ ne: 'मिनेट', en: 'Mins' })}</span>
                          <span className="text-end">{t({ ne: 'अवधि', en: 'Runs' })}</span>
                        </div>
                        {meeting.sessions.map((s) => sessionRow(meeting, s))}
                      </>
                    )}
                  </Panel>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
};
