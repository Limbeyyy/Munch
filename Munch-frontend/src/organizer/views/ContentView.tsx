import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Artifact, Meeting, TranscriptionSegment } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';

interface Props { meetings: Meeting[]; }

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
};

const kindOf = (a: Artifact): string => {
  const name = (a.display_name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'PDF';
  if (name.match(/\.pptx?$/)) return 'PPT';
  if (name.match(/\.docx?$/)) return 'DOC';
  if (name.match(/\.(png|jpe?g|gif|webp)$/)) return 'IMG';
  if (name.match(/\.(mp4|mov|webm)$/)) return 'VID';
  return 'FILE';
};

const KIND_COLOR: Record<string, string> = {
  PDF: 'bg-[#B3271E]', PPT: 'bg-[#C4551F]', DOC: 'bg-[#1F4E96]',
  VID: 'bg-navy-900', IMG: 'bg-ok', FILE: 'bg-[#6E7C8E]',
};

/** Files people shared, and the transcript each session produced. */
export const ContentView: React.FC<Props> = ({ meetings }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('files');
  const [resources, setResources] = useState<Record<string, Artifact[]>>({});
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptionSegment[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const loadResources = React.useCallback(async () => {
    const results = await Promise.allSettled(
      meetings.map((m) => apiClient.getResources(m.id).then((r) => [m.id, r] as const))
    );
    const next: Record<string, Artifact[]> = {};
    results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
    setResources(next);
  }, [meetings]);

  useEffect(() => { loadResources(); }, [loadResources]);

  useEffect(() => {
    if (tab !== 'transcripts') return;
    let cancelled = false;
    Promise.allSettled(
      meetings.map((m) =>
        apiClient.getMeetingSegments(m.meeting_code).then((s) => [m.id, s] as const)
      )
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, TranscriptionSegment[]> = {};
      results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
      setTranscripts(next);
    });
    return () => { cancelled = true; };
  }, [tab, meetings]);

  const upload = async (meeting: Meeting, file: File) => {
    try {
      setUploading(meeting.id);
      await apiClient.uploadResource(meeting.id, file);
      toast.success(t({ ne: 'फाइल थपियो', en: 'File added' }));
      await loadResources();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'अपलोड भएन', en: 'Upload failed' }));
    } finally { setUploading(null); }
  };

  const downloadTranscript = (meeting: Meeting) => {
    const segments = transcripts[meeting.id] ?? [];
    if (segments.length === 0) return;
    const header = `${meeting.title}\n${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
    const body = segments
      .map((s) => `[${s.speaker_name ?? 'Room'}] ${s.text}`)
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([header + body], { type: 'text/plain;charset=utf-8' }));
    a.download = `${meeting.meeting_code}-transcript.txt`;
    a.click();
    toast.success(t({ ne: 'ट्रान्सक्रिप्ट डाउनलोड भयो', en: 'Transcript downloaded' }));
  };

  return (
    <>
      <Head
        title={{ ne: 'सामग्री र सारांश', en: 'Files and summaries' }}
        lede={{
          ne: 'सत्रका फाइल आयोजकको ड्राइभमा बस्छन्; ट्रान्सक्रिप्ट हलको यन्त्रबाट आउँछ।',
          en: "Session files live in the host's Drive; transcripts come from the hall device.",
        }}
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'files', label: { ne: 'सत्रका फाइल', en: 'Session files' } },
          { id: 'transcripts', label: { ne: 'ट्रान्सक्रिप्ट', en: 'Transcripts' } },
        ]}
      />

      <div className="flex flex-col gap-3.5">
        {meetings.length === 0 && (
          <Panel><Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions yet.' })}</Empty></Panel>
        )}

        {meetings.map((meeting) => {
          const files = resources[meeting.id] ?? [];
          const segments = transcripts[meeting.id] ?? [];

          return (
            <Panel
              key={meeting.id}
              title={<span className="text-[14.5px]">{meeting.title}</span>}
              aside={
                meeting.status === 'active'
                  ? <Chip tone="live">{t({ ne: 'चलिरहेको', en: 'Live' })}</Chip>
                  : meeting.status === 'ended'
                  ? <Chip tone="ok">{t({ ne: 'सकियो', en: 'Finished' })}</Chip>
                  : <Chip tone="draft">{t({ ne: 'आउँदै', en: 'Upcoming' })}</Chip>
              }
              actions={
                tab === 'files' ? (
                  <label className="inline-flex items-center gap-2 rounded-[7px] border border-navy-800/15 bg-white px-2.5 py-1 text-[12.5px] font-medium cursor-pointer hover:border-navy-500">
                    {uploading === meeting.id
                      ? t({ ne: 'थप्दै…', en: 'Adding…' })
                      : t({ ne: '+ फाइल', en: '+ File' })}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploading === meeting.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) upload(meeting, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                ) : (
                  <Btn sm disabled={segments.length === 0} onClick={() => downloadTranscript(meeting)}>
                    {t({ ne: 'डाउनलोड', en: 'Download' })}
                  </Btn>
                )
              }
            >
              <div className="px-4 py-3">
                {tab === 'files' && (
                  files.length === 0 ? (
                    <p className="text-[12.5px] text-[#6E7C8E]">
                      {t({ ne: 'यो सत्रमा फाइल छैन।', en: 'No files on this session.' })}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {files.map((f, i) => {
                        const kind = kindOf(f);
                        return (
                          <div key={f.id} className="flex items-center gap-3 border border-navy-800/15 rounded-[10px] px-3 py-2.5">
                            <span className="w-6 h-6 rounded-md bg-cream-200 grid place-items-center text-xs text-ink-2 flex-none">
                              {num(i + 1)}
                            </span>
                            <span className={`w-[30px] h-9 rounded-[5px] grid place-items-center text-white text-[10px] font-bold flex-none ${KIND_COLOR[kind]}`}>
                              {kind}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] truncate">{f.display_name}</span>
                              <span className="text-[12.5px] text-[#6E7C8E]">{formatSize(f.file_size)}</span>
                            </span>
                            {f.web_view_link && (
                              <a
                                href={f.web_view_link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[12.5px] text-navy-700 underline underline-offset-4"
                              >
                                {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {tab === 'transcripts' && (
                  segments.length === 0 ? (
                    <p className="text-[12.5px] text-[#6E7C8E]">
                      {t({
                        ne: 'ट्रान्सक्रिप्ट छैन — हलको यन्त्रले पाठ पठाएपछि यहाँ देखिन्छ।',
                        en: 'No transcript yet — lines appear once the hall device sends text.',
                      })}
                    </p>
                  ) : (
                    <>
                      <p className="text-[12.5px] text-[#6E7C8E] mb-2">
                        {t({
                          ne: `${num(segments.length)} पङ्क्ति रेकर्ड भयो`,
                          en: `${segments.length} line${segments.length === 1 ? '' : 's'} recorded`,
                        })}
                      </p>
                      <div className="font-read text-[14px] leading-[1.8] text-ink-2 max-h-64 overflow-y-auto max-w-[70ch]">
                        {segments.slice(-40).map((s, i) => (
                          <p key={i}>
                            <span className="text-[#6E7C8E] text-[12.5px] mr-2">{s.speaker_name}:</span>
                            {s.text}
                          </p>
                        ))}
                      </div>
                    </>
                  )
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
};
