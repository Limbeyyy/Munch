import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Artifact, TranscriptionSegment } from '../types';
import { useOrganizer } from '../organizer/i18n';
import { Btn, Chip, Tabs } from '../organizer/ui';
import { SpineItem, clock } from './Spine';

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
};

interface Props {
  item: SpineItem;
  onClose: () => void;
  /** Guests read through their signed token instead of an account. */
  guestToken?: string;
}

/**
 * One session in full: what was said, what was shared, and who was there.
 * Everything shown belongs to that session alone.
 */
export const SessionDrawer: React.FC<Props> = ({ item, onClose, guestToken }) => {
  const { t, num } = useOrganizer();
  const { session, meeting } = item;

  const [tab, setTab] = useState('transcript');
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [present, setPresent] = useState<{ name: string; is_guest: boolean }[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [segs, arts, att] = await Promise.allSettled([
        guestToken
          ? apiClient.getGuestSegments(meeting.meeting_code, guestToken)
          : apiClient.getMeetingSegments(meeting.meeting_code),
        guestToken
          ? Promise.resolve([] as Artifact[])
          : apiClient.getResources(meeting.id),
        guestToken
          ? Promise.resolve([])
          : apiClient.getSessionAttendance(session.id),
      ]);
      if (cancelled) return;

      // The meeting's transcript covers the whole room; keep this session's.
      if (segs.status === 'fulfilled') {
        setSegments(
          (segs.value as any[]).filter((s) => !s.session_id || s.session_id === session.id)
        );
      }
      if (arts.status === 'fulfilled') {
        setFiles((arts.value as Artifact[]).filter((f: any) => !f.session || f.session === session.id));
      }
      if (att.status === 'fulfilled') setPresent(att.value as any[]);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [session.id, meeting.id, meeting.meeting_code, guestToken]);

  const shown = query
    ? segments.filter((s) => s.text.toLowerCase().includes(query.toLowerCase()))
    : segments;

  const download = () => {
    if (segments.length === 0) return;
    const header = `${session.title}\n${meeting.title}\n${'='.repeat(48)}\n\n`;
    const body = segments.map((s) => `[${s.speaker_name}] ${s.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([header + body], { type: 'text/plain;charset=utf-8' }));
    a.download = `${session.title.replace(/\s+/g, '-')}-transcript.txt`;
    a.click();
    toast.success(t({ ne: 'ट्रान्सक्रिप्ट डाउनलोड भयो', en: 'Transcript downloaded' }));
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-navy-900/45" onClick={onClose} />
      <aside
        className="fixed top-0 right-0 h-[100dvh] w-full max-w-[760px] bg-cream z-[61] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-navy-800 text-white px-5 py-4 relative">
          <button
            onClick={onClose}
            aria-label={t({ ne: 'बन्द', en: 'Close' })}
            className="absolute top-4 right-4 w-8 h-8 rounded-full text-2xl leading-none hover:bg-white/15"
          >
            ×
          </button>
          <p className="text-[12.5px] text-[#AFC6E6]">
            {clock(session.starts_at)}–{clock(session.ends_at)}
            {session.hall && ` · ${session.hall}`}
            {` · ${meeting.title} · ${meeting.meeting_code}`}
          </p>
          <h2 className="text-[21px] font-semibold pr-9 mt-1">{session.title}</h2>

          <div className="flex gap-3 items-center bg-white/10 rounded-[14px] px-3.5 py-2.5 mt-3.5">
            <span className="w-9 h-9 rounded-full bg-amber text-[#20160A] grid place-items-center font-bold text-sm flex-none">
              {(session.speaker_name || '—').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium text-white truncate">
                {session.speaker_name || t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker named' })}
              </div>
              <div className="text-xs text-[#AFC6E6]">
                {session.status === 'live'
                  ? t({ ne: 'अहिले मञ्चमा', en: 'On stage now' })
                  : session.status === 'done'
                  ? t({ ne: 'सकियो', en: 'Finished' })
                  : t({ ne: 'सुरु हुन बाँकी', en: 'Not started' })}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white px-5 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'transcript', label: { ne: 'ट्रान्सक्रिप्ट', en: 'Transcript' } },
              { id: 'files', label: { ne: 'सामग्री', en: 'Files' } },
              { id: 'who', label: { ne: 'उपस्थिति', en: 'Who was there' } },
            ]}
          />
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <p className="text-[#6E7C8E] text-[13.5px]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
          ) : tab === 'transcript' ? (
            segments.length === 0 ? (
              <p className="text-[#6E7C8E] text-[13.5px]">
                {session.status === 'scheduled'
                  ? t({
                      ne: 'सत्र सुरु भएपछि हलको यन्त्रबाट पाठ आउन थाल्छ।',
                      en: 'Text starts arriving from the hall device once the session begins.',
                    })
                  : t({ ne: 'यो सत्रको ट्रान्सक्रिप्ट छैन।', en: 'No transcript for this session.' })}
              </p>
            ) : (
              <>
                <div className="flex gap-2 mb-3">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t({ ne: 'ट्रान्सक्रिप्टमा खोज्नुहोस्', en: 'Search the transcript' })}
                    className="flex-1 border border-navy-800/15 rounded-[10px] px-3 py-2 text-[13.5px] bg-white"
                  />
                  <Btn onClick={download}>{t({ ne: 'डाउनलोड', en: 'Download' })}</Btn>
                </div>

                <div className="bg-white border border-navy-800/15 rounded-[14px] px-4">
                  {shown.length === 0 ? (
                    <p className="text-[#6E7C8E] text-[13px] py-4">
                      {t({ ne: 'केही भेटिएन।', en: 'Nothing matches.' })}
                    </p>
                  ) : (
                    shown.map((s, i) => (
                      <div
                        key={i}
                        className="grid gap-3.5 py-2.5 border-b border-navy-800/[.08] last:border-0"
                        style={{ gridTemplateColumns: '56px minmax(0,1fr)' }}
                      >
                        <time className="text-navy-500 text-[12.5px] tabular-nums pt-0.5">
                          {s.created_at ? clock(s.created_at) : '—'}
                        </time>
                        <div>
                          <span className="block font-semibold text-[12.5px] mb-0.5">{s.speaker_name}</span>
                          <p className="font-read leading-[1.8] text-ink-2">{s.text}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-xs text-[#6E7C8E] mt-2.5">
                  {t({
                    ne: 'हलको यन्त्रले पाठ पठाउँछ — अडियो कतै राखिँदैन।',
                    en: 'The hall device sends text — no audio is stored anywhere.',
                  })}
                </p>
              </>
            )
          ) : tab === 'files' ? (
            files.length === 0 ? (
              <p className="text-[#6E7C8E] text-[13.5px]">
                {guestToken
                  ? t({ ne: 'सामग्री पानाबाट फाइल हेर्नुहोस्।', en: 'Open the Files page to see shared materials.' })
                  : t({ ne: 'यो सत्रमा फाइल छैन।', en: 'No files on this session.' })}
              </p>
            ) : (
              files.map((f) => (
                <div
                  key={f.id}
                  className="flex gap-3 items-center bg-white border border-navy-800/15 rounded-[14px] px-3.5 py-3 mb-2.5"
                >
                  <span className="w-10 h-[46px] rounded-md bg-navy-700 text-white grid place-items-center text-[11px] font-bold flex-none">
                    {(f.display_name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-[14.5px] font-medium truncate">{f.display_name}</h4>
                    <p className="text-xs text-[#6E7C8E]">{formatSize(f.file_size)}</p>
                  </div>
                  {f.web_view_link && (
                    <a
                      href={f.web_view_link}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-auto text-[13px] text-navy-700 underline underline-offset-4"
                    >
                      {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
                    </a>
                  )}
                </div>
              ))
            )
          ) : (
            present.length === 0 ? (
              <p className="text-[#6E7C8E] text-[13.5px]">
                {t({
                  ne: 'सत्र सकिएपछि उपस्थिति दर्ता हुन्छ।',
                  en: 'Attendance is recorded when the session ends.',
                })}
              </p>
            ) : (
              <>
                <p className="text-[13px] text-[#6E7C8E] mb-2.5">
                  {t({
                    ne: `${num(present.length)} जना उपस्थित`,
                    en: `${present.length} people were present`,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {present.map((p, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-2 bg-white border border-navy-800/15 rounded-full ps-1 pe-3 py-1"
                    >
                      <span className="w-6 h-6 rounded-full bg-navy-700 text-white grid place-items-center text-[11px] font-semibold">
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[13px]">{p.name}</span>
                      {p.is_guest && <Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip>}
                    </span>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </aside>
    </>
  );
};
