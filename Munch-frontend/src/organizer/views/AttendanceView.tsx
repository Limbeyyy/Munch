import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { AttendanceReport, Meeting } from '../../types';
import { useOrganizer } from '../i18n';
import { BarRow, Btn, Chip, Empty, Head, Kpi, Panel, Tabs } from '../ui';

interface Props { meetings: Meeting[]; }

/** Attendance drawn from invitations, participants and admitted guests. */
export const AttendanceView: React.FC<Props> = ({ meetings }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('bysess');
  const [selected, setSelected] = useState<string>(meetings[0]?.id ?? '');
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [reports, setReports] = useState<Record<string, AttendanceReport>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected && meetings[0]) setSelected(meetings[0].id);
  }, [meetings, selected]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    apiClient
      .getAttendance(selected)
      .then(setReport)
      .catch(() => toast.error(t({ ne: 'उपस्थिति ल्याउन सकिएन', en: 'Could not load attendance' })))
      .finally(() => setLoading(false));
  }, [selected, t]);

  // Turnout per session needs every meeting's figures, fetched once.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      meetings.map((m) => apiClient.getAttendance(m.id).then((r) => [m.id, r] as const))
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, AttendanceReport> = {};
      results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
      setReports(next);
    });
    return () => { cancelled = true; };
  }, [meetings]);

  const people = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    const attended = report.attended.map((a: any) => ({
      name: a.name ?? a.email ?? '—',
      detail: a.is_guest
        ? t({ ne: 'पाहुना', en: 'Guest' })
        : a.email ?? '',
      joined: a.joined_at,
      present: true,
      guest: !!a.is_guest,
    }));
    const missing = report.did_not_attend.map((d) => ({
      name: d.email,
      detail: t({ ne: 'निम्तो पठाइएको', en: 'Invited' }),
      joined: null as string | null,
      present: false,
      guest: false,
    }));
    return [...attended, ...missing].filter((p) => {
      const hit = `${p.name}${p.detail}`.toLowerCase().includes(q);
      if (filter === 'in') return hit && p.present;
      if (filter === 'out') return hit && !p.present;
      return hit;
    });
  }, [report, query, filter, t]);

  const exportCSV = () => {
    if (!report) return;
    const head = ['name', 'detail', 'joined_at', 'attended'];
    const rows = people.map((p) => [p.name, p.detail, p.joined ?? '', p.present ? 'yes' : 'no']);
    const csv = [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'manch-attendance.csv';
    a.click();
    toast.success(t({ ne: 'CSV डाउनलोड भयो', en: 'CSV downloaded' }));
  };

  return (
    <>
      <Head
        title={{ ne: 'उपस्थिति', en: 'Attendance' }}
        lede={{
          ne: 'निम्तो पठाइएका, भित्रिएका र पाहुना — सबैको हिसाब यहीँ।',
          en: 'Who was invited, who arrived and which guests were let in.',
        }}
        actions={<Btn onClick={exportCSV} disabled={!report}>{t({ ne: 'CSV निकाल्नुहोस्', en: 'Export CSV' })}</Btn>}
      />

      <div className="mb-4">
        <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
          {t({ ne: 'कुन सत्र', en: 'Which session' })}
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
        >
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.title} · {m.meeting_code}</option>
          ))}
        </select>
      </div>

      {report && (
        <div className="mb-4">
          <Kpi
            items={[
              { value: num(report.expected_from_invites), label: { ne: 'निम्तो पठाइएको', en: 'Invited' } },
              { value: num(report.attended_count), label: { ne: 'आएका', en: 'Attended' } },
              { value: num(report.active_count), label: { ne: 'अहिले हलमा', en: 'In the room now' } },
              { value: num(report.invited_who_did_not), label: { ne: 'नआएका', en: 'Did not arrive' } },
              { value: num(report.guests_admitted), label: { ne: 'पाहुना', en: 'Guests' } },
            ]}
          />
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'bysess', label: { ne: 'सत्र अनुसार', en: 'By session' } },
          { id: 'people', label: { ne: 'व्यक्ति अनुसार', en: 'By person' } },
        ]}
      />

      {tab === 'bysess' && (
        <Panel title={t({ ne: 'कुन सत्रमा कति जना', en: 'Turnout per session' })}>
          <div className="px-4 py-3">
            {meetings.length === 0 ? (
              <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions yet.' })}</Empty>
            ) : (
              meetings.map((m) => {
                const r = reports[m.id];
                const expected = r?.expected_from_invites || r?.attended_count || 0;
                const pct = expected ? Math.round(((r?.attended_count ?? 0) / expected) * 100) : 0;
                return (
                  <BarRow
                    key={m.id}
                    label={m.title}
                    pct={pct}
                    right={r ? `${num(pct)}%` : '—'}
                  />
                );
              })
            )}
            <p className="text-[12.5px] text-[#6E7C8E] mt-2.5">
              {t({
                ne: '७०% भन्दा कम भएका सत्र पहेँलोमा देखिन्छन्।',
                en: 'Sessions under 70% show in amber.',
              })}
            </p>
          </div>
        </Panel>
      )}

      {tab === 'people' && (
        <Panel
          title={t({ ne: 'नामको सूची', en: 'Name list' })}
          actions={
            <div className="flex gap-2 flex-wrap">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t({ ne: 'नाम वा इमेल खोज्नुहोस्', en: 'Search name or email' })}
                className="border border-navy-800/15 rounded-[9px] px-3 py-1.5 text-[13px] min-w-[200px]"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="border border-navy-800/15 rounded-[9px] px-2 py-1.5 text-[13px] bg-white"
              >
                <option value="all">{t({ ne: 'सबै', en: 'Everyone' })}</option>
                <option value="in">{t({ ne: 'आएका', en: 'Attended' })}</option>
                <option value="out">{t({ ne: 'नआएका', en: 'Did not arrive' })}</option>
              </select>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[560px]">
              <thead>
                <tr className="bg-[#FBFAF6]">
                  {[
                    { ne: 'नाम', en: 'Name' },
                    { ne: 'विवरण', en: 'Detail' },
                    { ne: 'भित्रिएको', en: 'Joined' },
                    { ne: 'अवस्था', en: 'Status' },
                  ].map((h) => (
                    <th key={h.en} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2.5 border-b border-navy-800/15">
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={4} className="px-3 py-5 text-[12.5px] text-[#6E7C8E]">
                    {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
                  </td></tr>
                )}
                {!loading && people.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-5 text-[12.5px] text-[#6E7C8E]">
                    {t({ ne: 'कोही भेटिएन।', en: 'Nobody matched.' })}
                  </td></tr>
                )}
                {people.map((p, i) => (
                  <tr key={`${p.name}-${i}`} className="hover:bg-[#FBFAF6]">
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13.5px] font-medium">
                      {p.name}
                      {p.guest && <span className="ml-2"><Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip></span>}
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[12.5px] text-[#6E7C8E]">{p.detail}</td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13px] tabular-nums">
                      {p.joined ? new Date(p.joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                      {p.present
                        ? <Chip tone="ok">{t({ ne: 'आएको', en: 'Attended' })}</Chip>
                        : <Chip tone="draft">{t({ ne: 'नआएको', en: 'Not arrived' })}</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
};
