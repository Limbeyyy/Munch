import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/api';
import { Artifact, Event, EventPhoto, PhotoFolder, Session } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { formatSize, kindOf } from '../../organizer/filesAndSummaries/shared';
import { Switcher } from './PhoneShell';

/** The tinted square a file's kind sits in. */
const TINT: Record<string, { bg: string; ink: string }> = {
  PDF: { bg: '#fef2f2', ink: '#ef4444' },
  XLSX: { bg: '#f0fdf4', ink: '#22c55e' },
  DOCX: { bg: '#eff6ff', ink: '#3b82f6' },
  PPTX: { bg: '#fff7ed', ink: '#f97316' },
  IMG: { bg: '#faf5ff', ink: '#a855f7' },
  VID: { bg: '#f0f9ff', ink: '#0ea5e9' },
  FILE: { bg: '#f3f4f6', ink: '#6a7282' },
};

/** One photograph, fetched on the signed-in request rather than linked. */
const Tile: React.FC<{ photo: EventPhoto }> = ({ photo }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let url = '';
    let dropped = false;
    apiClient.getPhotoObjectUrl(photo.id).then((got) => {
      if (dropped) { URL.revokeObjectURL(got); return; }
      url = got;
      setSrc(got);
    }).catch(() => undefined);
    return () => {
      dropped = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id]);

  return (
    <div className="aspect-square rounded-[6px] overflow-hidden bg-[#eaebed]">
      {src && (
        <img src={src} alt={photo.caption || ''}
          className="w-full h-full object-cover" />
      )}
    </div>
  );
};

/**
 * What was handed out, and what was photographed.
 *
 * Read-only: an attendee takes a copy away, and adds nothing. The files
 * are grouped under the talk they belong to, because that is how
 * somebody remembers them - the deck from the keynote, not a deck.
 */
export const FilesScreen: React.FC<{
  event: Event;
  sessions: Session[];
  onFolderOpenChange: (open: boolean) => void;
}> = ({ event, sessions, onFolderOpenChange }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<'files' | 'photos'>('files');
  const [files, setFiles] = useState<Artifact[]>([]);
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [opened, setOpened] = useState('');

  const openFolder = (id: string) => {
    setOpened(id);
    onFolderOpenChange(Boolean(id));
  };

  const read = useCallback(async () => {
    const [shared, album] = await Promise.all([
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
      apiClient.getPhotos(event.code).catch(() => null),
    ]);
    setFiles(shared);
    setFolders(album?.folders ?? []);
    setPhotos(album?.photos ?? []);
  }, [event.id, event.code]);

  useEffect(() => { read(); }, [read]);

  /** The files under each talk, in the running order's own order. */
  const grouped = useMemo(() => {
    const byId = new Map(sessions.map((one) => [one.id, one.title]));
    const order = [...sessions]
      .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
      .map((one) => one.id);

    const heads = order
      .map((id) => ({
        id,
        title: byId.get(id) ?? '',
        rows: files.filter((f) => f.session === id),
      }))
      .filter((group) => group.rows.length > 0);

    const loose = files.filter((f) => !f.session);
    return loose.length > 0
      ? [...heads, {
          id: '',
          title: t({ ne: 'कार्यक्रमका फाइल', en: 'For the event' }),
          rows: loose,
        }]
      : heads;
  }, [files, sessions, t]);

  const folder = folders.find((one) => one.id === opened);

  if (folder) {
    const inside = photos.filter((one) => one.folder_id === folder.id);
    return (
      <div>
        <header
          className="px-4 pt-3 pb-3 border-b border-[#eceef2]"
          style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            onClick={() => openFolder('')}
            className="flex items-center gap-1.5 text-[14px] text-[#5b6070]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {t({ ne: 'तस्बिर', en: 'Photos' })}
          </button>
          <h1 className="pt-1.5 text-[19px] font-semibold text-[#111726]">
            {folder.name}
          </h1>
          <p className="text-[12px] text-[#8b90a0]">
            {t({
              ne: `${num(inside.length)} तस्बिर`,
              en: inside.length === 1 ? '1 Photo' : `${inside.length} Photos`,
            })}
          </p>
        </header>

        {inside.length === 0 ? (
          <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
            {t({ ne: 'यो फोल्डर खाली छ।', en: 'This folder is empty.' })}
          </p>
        ) : (
          <div className="p-4 grid grid-cols-4 gap-2">
            {inside.map((one) => <Tile key={one.id} photo={one} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Switcher<'files' | 'photos'>
        value={tab}
        onChange={setTab}
        options={[
          { id: 'files', label: t({ ne: 'कार्यसूचीका फाइल', en: "Agenda's File" }) },
          { id: 'photos', label: t({ ne: 'तस्बिर', en: 'Photos' }) },
        ]}
      />

      {tab === 'files' ? (
        grouped.length === 0 ? (
          <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
            {t({ ne: 'अझै केही बाँडिएको छैन।', en: 'Nothing has been shared yet.' })}
          </p>
        ) : (
          <div className="px-4 pt-4 pb-4 flex flex-col gap-5">
            {grouped.map((group) => (
              <section key={group.id || 'loose'}>
                <h2 className="text-[11px] font-semibold tracking-[.06em]
                  text-[#8b90a0] uppercase">
                  {group.title}
                </h2>
                <ul className="pt-2 flex flex-col gap-2.5">
                  {group.rows.map((one) => {
                    const kind = kindOf(one.display_name ?? '');
                    const tint = TINT[kind] ?? TINT.FILE;
                    return (
                      <li
                        key={one.id}
                        className="border border-[#e8eaee] rounded-[12px] px-3 py-3
                          flex gap-3 items-center"
                      >
                        <span
                          className="size-9 rounded-[8px] grid place-items-center
                            flex-none text-[9px] font-bold"
                          style={{ backgroundColor: tint.bg, color: tint.ink }}
                        >
                          {kind}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] font-medium
                            text-[#111726] truncate">
                            {one.display_name}
                          </span>
                          <span className="block text-[12px] text-[#9ba0ad]">
                            {kind} · {formatSize(one.file_size)}
                          </span>
                        </span>
                        {one.web_view_link ? (
                          <a
                            href={one.web_view_link}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t({
                              ne: `${one.display_name} खोल्नुहोस्`,
                              en: `Open ${one.display_name}`,
                            })}
                            className="size-9 rounded-full bg-[#f2f3f5] grid
                              place-items-center flex-none text-[#5b6070]"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="1.9"
                              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M12 4v11M12 15l-4-4M12 15l4-4M5 19h14" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-[11px] text-[#9ba0ad] flex-none">
                            {t({ ne: 'लिङ्क छैन', en: 'No link' })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : folders.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {t({ ne: 'अझै कुनै तस्बिर छैन।', en: 'No photographs yet.' })}
        </p>
      ) : (
        <div className="p-4 grid grid-cols-2 gap-3">
          {folders.map((one) => {
            const cover = photos.find((p) => p.folder_id === one.id);
            return (
              <button
                key={one.id}
                type="button"
                onClick={() => openFolder(one.id)}
                className="text-left border border-[#e8eaee] rounded-[12px]
                  overflow-hidden"
              >
                <span className="block aspect-[4/3] bg-[#eaebed]">
                  {cover && <Tile photo={cover} />}
                </span>
                <span className="block px-3 py-2.5">
                  <span className="block text-[14px] font-semibold text-[#111726]
                    truncate">
                    {one.name}
                  </span>
                  <span className="block text-[12px] text-[#9ba0ad]">
                    {t({
                      ne: `${num(one.photo_count)} तस्बिर`,
                      en: one.photo_count === 1
                        ? '1 photo' : `${one.photo_count} photos`,
                    })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
