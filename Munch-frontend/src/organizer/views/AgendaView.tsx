import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Meeting } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';
import { Modal } from '../OrganizerShell';

interface Props {
  meetings: Meeting[];
  onChanged: () => void;
  onOpenSession: (meeting: Meeting) => void;
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};

/**
 * The running order. Times are edited in place, and moving one session
 * offers to move everything after it on the same day.
 */
export const AgendaView: React.FC<Props> = ({ meetings, onChanged, onOpenSession }) => {
  const { t, num } = useOrganizer();
  const [saving, setSaving] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftFrom, setShiftFrom] = useState('');
  const [shiftMins, setShiftMins] = useState(15);

  const sorted = useMemo(
    () => [...meetings].sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start)),
    [meetings]
  );

  const days = useMemo(() => {
    const seen: string[] = [];
    sorted.forEach((m) => {
      const k = dayKey(m.scheduled_start);
      if (!seen.includes(k)) seen.push(k);
    });
    return seen;
  }, [sorted]);

  const [day, setDay] = useState(days[0] ?? '');
  const activeDay = days.includes(day) ? day : days[0] ?? '';
  const rows = sorted.filter((m) => dayKey(m.scheduled_start) === activeDay);

  /** Save a new start, keeping the session's original length. */
  const setStart = async (meeting: Meeting, localValue: string) => {
    const newStart = new Date(localValue);
    if (Number.isNaN(newStart.getTime())) return;
    const length = +new Date(meeting.scheduled_end) - +new Date(meeting.scheduled_start);
    const shiftMs = +newStart - +new Date(meeting.scheduled_start);

    try {
      setSaving(meeting.id);
      await apiClient.updateMeeting(meeting.id, {
        scheduled_start: newStart.toISOString(),
        scheduled_end: new Date(+newStart + length).toISOString(),
      });

      // Moving one session usually means the rest of the day moves too.
      const later = rows.filter(
        (m) => +new Date(m.scheduled_start) > +new Date(meeting.scheduled_start)
      );
      if (shiftMs !== 0 && later.length > 0) {
        const mins = Math.round(shiftMs / 60000);
        const ok = window.confirm(
          t({
            ne: `पछिका ${num(later.length)} सत्र पनि ${num(Math.abs(mins))} मिनेट ${mins > 0 ? 'पछाडि' : 'अगाडि'} सार्ने?`,
            en: `Move the ${later.length} later session${later.length === 1 ? '' : 's'} by ${Math.abs(mins)} minutes too?`,
          })
        );
        if (ok) await shiftAll(later, mins);
      }
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'समय बदल्न सकिएन', en: 'Could not change the time' }));
    } finally { setSaving(null); }
  };

  /** Save a new length, keeping the start where it is. */
  const setDuration = async (meeting: Meeting, minutes: number) => {
    if (!minutes || minutes < 5) return;
    try {
      setSaving(meeting.id);
      await apiClient.updateMeeting(meeting.id, {
        scheduled_end: new Date(+new Date(meeting.scheduled_start) + minutes * 60000).toISOString(),
      });
      onChanged();
    } catch {
      toast.error(t({ ne: 'अवधि बदल्न सकिएन', en: 'Could not change the length' }));
    } finally { setSaving(null); }
  };

  const shiftAll = async (list: Meeting[], minutes: number) => {
    await Promise.allSettled(
      list.map((m) =>
        apiClient.updateMeeting(m.id, {
          scheduled_start: new Date(+new Date(m.scheduled_start) + minutes * 60000).toISOString(),
          scheduled_end: new Date(+new Date(m.scheduled_end) + minutes * 60000).toISOString(),
        })
      )
    );
  };

  const applyShift = async () => {
    const index = rows.findIndex((m) => m.id === shiftFrom);
    if (index < 0) return;
    try {
      await shiftAll(rows.slice(index), shiftMins);
      toast.success(
        t({
          ne: `${num(Math.abs(shiftMins))} मिनेट ${shiftMins >= 0 ? 'पछाडि' : 'अगाडि'} सारियो`,
          en: `Moved by ${Math.abs(shiftMins)} minutes`,
        })
      );
      setShiftOpen(false);
      onChanged();
    } catch {
      toast.error(t({ ne: 'सार्न सकिएन', en: 'Could not shift the times' }));
    }
  };

  const statusChip = (m: Meeting) =>
    m.status === 'active' ? <Chip tone="live">{t({ ne: 'चलिरहेको', en: 'Live' })}</Chip>
    : m.status === 'ended' ? <Chip tone="ok">{t({ ne: 'सकियो', en: 'Finished' })}</Chip>
    : <Chip tone="draft">{t({ ne: 'आउँदै', en: 'Upcoming' })}</Chip>;

  return (
    <>
      <Head
        title={{ ne: 'एजेन्डा', en: 'Agenda' }}
        lede={{
          ne: 'समय सिधै फिल्डमै लेख्नुहोस्। एउटा सत्र सारे पछिका सबै सार्न सोधिन्छ।',
          en: 'Type times in place. Move one session and Manch offers to move the rest.',
        }}
        actions={
          <Btn onClick={() => { setShiftFrom(rows[0]?.id ?? ''); setShiftOpen(true); }} disabled={rows.length === 0}>
            {t({ ne: 'समय सार्नुहोस्', en: 'Shift times' })}
          </Btn>
        }
      />

      {days.length > 1 && (
        <Tabs
          active={activeDay}
          onChange={setDay}
          tabs={days.map((d, i) => ({
            id: d,
            label: {
              ne: `दिन ${num(i + 1)} · ${new Date(d).toLocaleDateString('ne-NP', { month: 'short', day: 'numeric' })}`,
              en: `Day ${i + 1} · ${new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
            },
          }))}
        />
      )}

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-[#FBFAF6]">
                {[
                  { ne: 'सुरु', en: 'Start' },
                  { ne: 'मिनेट', en: 'Mins' },
                  { ne: 'सत्र', en: 'Session' },
                  { ne: 'आयोजक', en: 'Host' },
                  { ne: 'कोड', en: 'Code' },
                  { ne: 'अवस्था', en: 'Status' },
                  { ne: '', en: '' },
                ].map((h, i) => (
                  <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2.5 border-b border-navy-800/15">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7}><Empty>{t({ ne: 'यो दिनमा कुनै सत्र छैन।', en: 'No sessions on this day.' })}</Empty></td></tr>
              )}
              {rows.map((m) => {
                const minutes = Math.round(
                  (+new Date(m.scheduled_end) - +new Date(m.scheduled_start)) / 60000
                );
                const locked = m.status === 'ended';
                return (
                  <tr key={m.id} className="hover:bg-[#FBFAF6]">
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                      <input
                        type="datetime-local"
                        defaultValue={toLocalInput(m.scheduled_start)}
                        disabled={locked || saving === m.id}
                        onBlur={(e) => {
                          if (e.target.value !== toLocalInput(m.scheduled_start)) setStart(m, e.target.value);
                        }}
                        className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                      <input
                        type="number"
                        min={5}
                        step={5}
                        defaultValue={minutes}
                        disabled={locked || saving === m.id}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== minutes) setDuration(m, v);
                        }}
                        className="w-20 border border-navy-800/15 rounded-md px-2 py-1 text-[13px] text-center disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                      <button
                        onClick={() => onOpenSession(m)}
                        className="text-left font-medium text-[13.5px] hover:text-navy-700 underline-offset-4 hover:underline"
                      >
                        {m.title}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[12.5px] text-[#6E7C8E]">
                      {m.host?.email}
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13px] font-mono">
                      {m.meeting_code}
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08]">{statusChip(m)}</td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-right">
                      <Btn sm onClick={() => onOpenSession(m)}>{t({ ne: 'खोल्नुहोस्', en: 'Open' })}</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-[12.5px] text-[#6E7C8E] mt-2.5">
        {t({
          ne: 'सुझाव: सत्रको नाममा क्लिक गर्दा त्यसैको विवरण, सामग्री र उपस्थिति खुल्छ।',
          en: "Tip: clicking a session name opens its details, files and attendance.",
        })}
      </p>

      <Modal
        open={shiftOpen}
        onClose={() => setShiftOpen(false)}
        title={t({ ne: 'समय सार्नुहोस्', en: 'Shift times' })}
        lede={t({
          ne: 'कार्यक्रम ढिलो भयो? एउटा ठाउँबाट पछिका सबै सत्र सार्नुहोस्।',
          en: 'Running late? Move every session after a point in one go.',
        })}
        footer={
          <>
            <Btn onClick={() => setShiftOpen(false)}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
            <Btn tone="amber" onClick={applyShift}>{t({ ne: 'सार्नुहोस्', en: 'Shift' })}</Btn>
          </>
        }
      >
        <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
          {t({ ne: 'कुन सत्रदेखि', en: 'Starting from' })}
        </label>
        <select
          value={shiftFrom}
          onChange={(e) => setShiftFrom(e.target.value)}
          className="w-full border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px] mb-3"
        >
          {rows.map((m) => (
            <option key={m.id} value={m.id}>
              {new Date(m.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {m.title}
            </option>
          ))}
        </select>

        <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
          {t({ ne: 'कति मिनेट', en: 'By how many minutes' })}
        </label>
        <div className="flex gap-2 items-center">
          <Btn sm onClick={() => setShiftMins((v) => v - 5)}>−5</Btn>
          <input
            type="number"
            value={shiftMins}
            onChange={(e) => setShiftMins(Number(e.target.value) || 0)}
            className="flex-1 border border-navy-800/15 rounded-[9px] px-3 py-2 text-center"
          />
          <Btn sm onClick={() => setShiftMins((v) => v + 5)}>+5</Btn>
        </div>
      </Modal>
    </>
  );
};
