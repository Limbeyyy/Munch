import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { AttendanceReport, Meeting } from '../../types';
import { useOrganizer } from '../i18n';
import { BarRow, Btn, Empty, Head, Kpi, Panel } from '../ui';

interface Props { meetings: Meeting[]; }

/** What the event actually produced, drawn from real attendance figures. */
export const ReportsView: React.FC<Props> = ({ meetings }) => {
  const { t, num } = useOrganizer();
  const [reports, setReports] = useState<Record<string, AttendanceReport>>({});
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const gather = async () => {
      const [att, segs, res] = await Promise.all([
        Promise.allSettled(meetings.map((m) => apiClient.getAttendance(m.id).then((r) => [m.id, r] as const))),
        Promise.allSettled(meetings.map((m) => apiClient.getMeetingSegments(m.meeting_code).then((s) => [m.id, s.length] as const))),
        Promise.allSettled(meetings.map((m) => apiClient.getResources(m.id).then((r) => [m.id, r.length] as const))),
      ]);
      if (cancelled) return;

      const pick = <T,>(rs: PromiseSettledResult<readonly [string, T]>[]) => {
        const out: Record<string, T> = {};
        rs.forEach((r) => { if (r.status === 'fulfilled') out[r.value[0]] = r.value[1]; });
        return out;
      };
      setReports(pick(att));
      setSegmentCounts(pick(segs));
      setResourceCounts(pick(res));
    };
    gather();
    return () => { cancelled = true; };
  }, [meetings]);

  const totals = useMemo(() => {
    const list = Object.values(reports);
    const invited = list.reduce((sum, r) => sum + r.expected_from_invites, 0);
    const attended = list.reduce((sum, r) => sum + r.attended_count, 0);
    const guests = list.reduce((sum, r) => sum + r.guests_admitted, 0);
    const lines = Object.values(segmentCounts).reduce((a, b) => a + b, 0);
    const files = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
    return {
      invited,
      attended,
      guests,
      lines,
      files,
      turnout: invited ? Math.round((attended / invited) * 100) : 0,
    };
  }, [reports, segmentCounts, resourceCounts]);

  const exportReport = () => {
    const head = ['session', 'code', 'status', 'invited', 'attended', 'guests', 'transcript_lines', 'files'];
    const rows = meetings.map((m) => {
      const r = reports[m.id];
      return [
        m.title, m.meeting_code, m.status,
        r?.expected_from_invites ?? 0, r?.attended_count ?? 0, r?.guests_admitted ?? 0,
        segmentCounts[m.id] ?? 0, resourceCounts[m.id] ?? 0,
      ];
    });
    const csv = [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'manch-event-report.csv';
    a.click();
    toast.success(t({ ne: 'रिपोर्ट डाउनलोड भयो', en: 'Report downloaded' }));
  };

  return (
    <>
      <Head
        title={{ ne: 'रिपोर्ट', en: 'Reports' }}
        lede={{
          ne: 'दाता, बोर्ड र मन्त्रालयलाई चाहिने प्रमाण — वास्तविक उपस्थितिबाट बनेको।',
          en: 'The evidence donors, boards and ministries ask for, built from real attendance.',
        }}
        actions={
          <Btn tone="solid" onClick={exportReport} disabled={meetings.length === 0}>
            {t({ ne: 'रिपोर्ट निकाल्नुहोस् (CSV)', en: 'Export report (CSV)' })}
          </Btn>
        }
      />

      <div className="mb-4">
        <Kpi
          items={[
            { value: `${num(totals.turnout)}%`, label: { ne: 'औसत उपस्थिति', en: 'Average turnout' } },
            { value: num(totals.attended), label: { ne: 'कुल आएका', en: 'Total attended' } },
            { value: num(totals.guests), label: { ne: 'पाहुना', en: 'Guests' } },
            { value: num(totals.lines), label: { ne: 'ट्रान्सक्रिप्ट पङ्क्ति', en: 'Transcript lines' } },
            { value: num(totals.files), label: { ne: 'साझा फाइल', en: 'Files shared' } },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title={t({ ne: 'सत्रगत उपस्थिति', en: 'Turnout by session' })}>
          <div className="px-4 py-3">
            {meetings.length === 0 ? (
              <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions yet.' })}</Empty>
            ) : (
              meetings.map((m) => {
                const r = reports[m.id];
                const expected = r?.expected_from_invites || r?.attended_count || 0;
                const pct = expected ? Math.round(((r?.attended_count ?? 0) / expected) * 100) : 0;
                return <BarRow key={m.id} label={m.title} pct={pct} right={num(r?.attended_count ?? 0)} />;
              })
            )}
          </div>
        </Panel>

        <Panel title={t({ ne: 'सत्रले के छोड्यो', en: 'What each session produced' })}>
          <div className="px-4 py-3">
            {meetings.length === 0 ? (
              <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions yet.' })}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[380px]">
                  <thead>
                    <tr className="bg-[#FBFAF6]">
                      {[
                        { ne: 'सत्र', en: 'Session' },
                        { ne: 'पङ्क्ति', en: 'Lines' },
                        { ne: 'फाइल', en: 'Files' },
                      ].map((h, i) => (
                        <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2 border-b border-navy-800/15">
                          {t(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 border-b border-navy-800/[.08] text-[13px] truncate max-w-[200px]">{m.title}</td>
                        <td className="px-3 py-2 border-b border-navy-800/[.08] text-[13px] tabular-nums">{num(segmentCounts[m.id] ?? 0)}</td>
                        <td className="px-3 py-2 border-b border-navy-800/[.08] text-[13px] tabular-nums">{num(resourceCounts[m.id] ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <p className="text-[12.5px] text-[#6E7C8E] mt-3">
        {t({
          ne: 'सबै आँकडा वास्तविक उपस्थिति, ट्रान्सक्रिप्ट र फाइलबाट गनिएको हो।',
          en: 'Every figure is counted from real attendance, transcripts and files.',
        })}
      </p>
    </>
  );
};
