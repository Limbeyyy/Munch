import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Artifact, Event, TranscriptionSegment } from '../../types';
import { EventOverview } from '../EventOverview';
import { SummaryApprovals } from '../SummaryApprovals';
import { PhotoAlbums } from '../Photos';
import { EVENT_STATE_LABEL, EVENT_STATE_TONE, eventState } from '../sessionState';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';

interface Props { events: Event[]; }

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
export const ContentView: React.FC<Props> = ({ events }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('files');
  const [photoEvent, setPhotoEvent] = useState('');
  const [resources, setResources] = useState<Record<string, Artifact[]>>({});
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptionSegment[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [opened, setOpened] = useState<Event | null>(null);

  const loadResources = React.useCallback(async () => {
    const results = await Promise.allSettled(
      events.map((m) => apiClient.getResources(m.id).then((r) => [m.id, r] as const))
    );
    const next: Record<string, Artifact[]> = {};
    results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
    setResources(next);
  }, [events]);

  useEffect(() => { loadResources(); }, [loadResources]);

  useEffect(() => {
    if (tab !== 'transcripts') return;
    let cancelled = false;
    Promise.allSettled(
      events.map((m) =>
        apiClient.getEventSegments(m.code).then((s) => [m.id, s] as const)
      )
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, TranscriptionSegment[]> = {};
      results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
      setTranscripts(next);
    });
    return () => { cancelled = true; };
  }, [tab, events]);

  const upload = async (event: Event, file: File) => {
    try {
      setUploading(event.id);
      await apiClient.uploadResource(event.id, file);
      toast.success(t({ ne: 'फाइल थपियो', en: 'File added' }));
      await loadResources();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'अपलोड भएन', en: 'Upload failed' }));
    } finally { setUploading(null); }
  };

  const downloadTranscript = (event: Event) => {
    const segments = transcripts[event.id] ?? [];
    if (segments.length === 0) return;
    const header = `${event.title}\n${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
    const body = segments
      .map((s) => `[${s.speaker_name ?? 'Room'}] ${s.text}`)
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([header + body], { type: 'text/plain;charset=utf-8' }));
    a.download = `${event.code}-transcript.txt`;
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
          { id: 'transcripts', label: { ne: 'सारांश स्वीकृति', en: 'Summary approvals' } },
          { id: 'photos', label: { ne: 'फोटो', en: 'Photos' } },
        ]}
      />

      {tab !== 'photos' && <div className="flex flex-col gap-3.5">
        {events.length === 0 && (
          <Panel><Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions yet.' })}</Empty></Panel>
        )}

        {events.map((event) => {
          const files = resources[event.id] ?? [];
          const segments = transcripts[event.id] ?? [];

          return (
            <Panel
              key={event.id}
              title={<span className="text-[14.5px]">{event.title}</span>}
              aside={
                <Chip tone={EVENT_STATE_TONE[eventState(event)]}>
                  {t(EVENT_STATE_LABEL[eventState(event)])}
                </Chip>
              }
              actions={
                tab === 'files' ? (
                <>
                {/* Everything about this event, gathered to read rather
                    than to edit. The tabs here own the editing. */}
                <Btn sm onClick={() => setOpened(event)}>
                  {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
                </Btn>
                  <label className="inline-flex items-center gap-2 rounded-[7px] border border-navy-800/15 bg-white px-2.5 py-1 text-[12.5px] font-medium cursor-pointer hover:border-navy-500">
                    {uploading === event.id
                      ? t({ ne: 'थप्दै…', en: 'Adding…' })
                      : t({ ne: '+ फाइल', en: '+ File' })}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploading === event.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) upload(event, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </>
                ) : (
                  // Summaries are approved one at a time, so the actions
                  // belong beside each summary rather than up here.
                  <Btn sm disabled={segments.length === 0}
                       onClick={() => downloadTranscript(event)}>
                    {t({ ne: 'ट्रान्सक्रिप्ट डाउनलोड', en: 'Download transcript' })}
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

                {tab === 'transcripts' && <SummaryApprovals event={event} />}
              </div>
            </Panel>
          );
        })}
      </div>}

      {tab === 'photos' && (
        <div className="flex flex-col gap-3.5">
          {events.length > 1 && (
            <select
              aria-label={t({ ne: 'कुन बैठक', en: 'Which event' })}
              value={photoEvent || events[0]?.id || ''}
              onChange={(e) => setPhotoEvent(e.target.value)}
              className="w-full max-w-md border border-line rounded-[9px] px-3 py-2 bg-white text-[14px]"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.title}</option>
              ))}
            </select>
          )}
          {events.length === 0
            ? <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No events.' })}</Empty></Panel>
            : <PhotoAlbums eventRef={(events.find((e) => e.id === photoEvent) ?? events[0]).code} />}
        </div>
      )}

      {opened && (
        <EventOverview event={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
};
