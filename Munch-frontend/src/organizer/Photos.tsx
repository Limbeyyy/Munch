import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { MeetingPhoto, PhotoFolder, PhotoPage } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel } from './ui';

/** A palette for the folder cards, so a wall of them is readable. */
const TINTS = [
  'linear-gradient(150deg,#1B3B6F,#2C5A8F)',
  'linear-gradient(150deg,#D98324,#F0A22B)',
  'linear-gradient(150deg,#12403C,#1B7F58)',
  'linear-gradient(150deg,#274B8F,#3E77C4)',
  'linear-gradient(150deg,#B4451F,#E1662B)',
  'linear-gradient(150deg,#3E4C63,#63758F)',
  'linear-gradient(150deg,#166F4A,#28A06B)',
];

const tintFor = (id: string) => {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return TINTS[sum % TINTS.length];
};

/**
 * One photograph, fetched so it can be shown.
 *
 * The file is served by our own backend on the signed-in request, so an
 * <img src> pointing at it would come back unauthorised. The bytes are
 * fetched instead and handed to the browser as an object URL, which is
 * revoked when the tile goes away.
 */
export const PhotoImage: React.FC<{
  photo: MeetingPhoto;
  className?: string;
}> = ({ photo, className = '' }) => {
  const { t } = useOrganizer();
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url = '';
    let gone = false;
    apiClient
      .getPhotoObjectUrl(photo.id)
      .then((made) => {
        if (gone) { URL.revokeObjectURL(made); return; }
        url = made;
        setSrc(made);
      })
      .catch(() => { if (!gone) setFailed(true); });

    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id]);

  if (failed) {
    return (
      <div className={`grid place-items-center bg-cream-200 text-[#6E7C8E] text-[11.5px] ${className}`}>
        {t({ ne: 'देखाउन सकिएन', en: 'Could not load' })}
      </div>
    );
  }

  if (!src) {
    return <div className={`bg-cream-200 animate-pulse ${className}`} aria-hidden />;
  }

  return (
    <img
      src={src}
      alt={photo.caption || t({ ne: 'कार्यक्रमको तस्बिर', en: 'A photograph from the event' })}
      loading="lazy"
      className={className}
    />
  );
};

/** Everything the two views need, fetched once. */
const usePhotos = (meetingRef: string) => {
  const { t } = useOrganizer();
  const [page, setPage] = useState<PhotoPage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!meetingRef) { setPage(null); setLoading(false); return; }
    try {
      setPage(await apiClient.getPhotos(meetingRef));
    } catch {
      if (!quiet) {
        toast.error(t({ ne: 'तस्बिर ल्याउन सकिएन', en: 'Could not load the photographs' }));
      }
    } finally {
      setLoading(false);
    }
  }, [meetingRef, t]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  return { page, loading, reload: load };
};

/** Say what the server said, which is more use than a generic failure. */
const refusalText = (error: any, fallback: string) =>
  error?.response?.data?.error || fallback;

const useUploader = (
  meetingRef: string,
  onDone: () => void
): {
  pick: (folderId: string) => void;
  busy: string;
  input: React.ReactElement;
} => {
  const { t, num } = useOrganizer();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<string>('');
  const [busy, setBusy] = useState('');

  const pick = (folderId: string) => {
    folderRef.current = folderId;
    fileRef.current?.click();
  };

  const send = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;
    const folderId = folderRef.current;

    setBusy(folderId);
    let added = 0;
    for (const file of chosen) {
      try {
        await apiClient.uploadPhoto(meetingRef, folderId, file);
        added += 1;
      } catch (error) {
        toast.error(
          refusalText(error, t({
            ne: `${file.name} पठाउन सकिएन`,
            en: `Could not add ${file.name}`,
          }))
        );
        break;
      }
    }
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
    if (added > 0) {
      toast.success(t({
        ne: `${num(added)} तस्बिर थपियो`,
        en: `${added} photograph${added === 1 ? '' : 's'} added`,
      }));
      onDone();
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => send(e.target.files)}
    />
  );

  return { pick, busy, input };
};

const askForName = (t: (p: Pair) => string) =>
  window.prompt(
    t({ ne: 'फोल्डरको नाम', en: 'Name for the folder' }),
    ''
  );

/**
 * The photographs in the room: folders and an upload button apiece.
 *
 * Reading them belongs in the portal, where there is room to look
 * properly; here it is a place to put them, which is why the tiles carry a
 * count rather than a preview.
 */
export const PhotoUploads: React.FC<{
  meetingRef: string;
  /** The meeting room is dark; the dashboards are not. */
  tone?: 'light' | 'dark';
}> = ({ meetingRef, tone = 'light' }) => {
  const { t, num } = useOrganizer();
  const dark = tone === 'dark';
  const { page, loading, reload } = usePhotos(meetingRef);
  const { pick, busy, input } = useUploader(meetingRef, () => reload(true));

  const addFolder = async () => {
    const name = askForName(t);
    if (!name) return;
    try {
      await apiClient.createPhotoFolder(meetingRef, name);
      await reload(true);
      toast.success(t({ ne: 'फोल्डर बन्यो', en: 'Folder created' }));
    } catch (error) {
      toast.error(refusalText(error, t({
        ne: 'फोल्डर बनाउन सकिएन', en: 'Could not create the folder',
      })));
    }
  };

  if (loading) {
    return (
      <p className={`text-[12.5px] ${dark ? 'text-gray-400' : 'text-[#6E7C8E]'}`}>
        {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
      </p>
    );
  }
  // Looking at the photographs belongs in the portal, where there is room
  // for it. In here the section is a place to put them, so it is not shown
  // to somebody who has none to add.
  if (!page || !page.is_a_photographer) return null;

  return (
    <div className={dark ? 'p-4 border-b border-gray-700' : ''}>
      {input}

      {dark && <h3 className="font-semibold mb-2">{t({ ne: 'तस्बिर', en: 'Photos' })}</h3>}

      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className={`text-[12px] ${dark ? 'text-gray-400' : 'text-[#6E7C8E]'}`}>
          {page.meeting_is_finished
            ? t({
                ne: 'कुन फोल्डरमा राख्ने, त्यहीँको अपलोड थिच्नुहोस्।',
                en: 'Press upload on the folder it belongs in.',
              })
            : t({
                ne: 'बैठक सकिएपछि तस्बिर थप्न मिल्छ।',
                en: 'Photographs can be added once the meeting has finished.',
              })}
        </p>
        {page.can_arrange && (
          dark ? (
            <button
              type="button"
              onClick={addFolder}
              className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded"
            >
              {t({ ne: '+ फोल्डर', en: '+ Folder' })}
            </button>
          ) : (
            <Btn sm onClick={addFolder}>
              {t({ ne: 'फोल्डर बनाउने', en: 'Create folder' })}
            </Btn>
          )
        )}
      </div>

      <ul
        className={
          dark
            ? 'rounded overflow-hidden'
            : 'border border-navy-800/15 rounded-[10px] bg-white overflow-hidden'
        }
      >
        {page.folders.map((folder) => (
          <li
            key={folder.id}
            className={`flex items-center gap-2.5 px-3 py-2 ${
              dark
                ? 'bg-gray-700 mb-2 rounded last:mb-0'
                : 'border-b border-navy-800/[.08] last:border-0'
            }`}
          >
            <span aria-hidden className="text-[15px]">🗂️</span>
            <span className="min-w-0 flex-1">
              <span className="text-[13px] font-medium">{folder.name}</span>
              {!folder.is_default && (
                <span className={`ms-1.5 text-[11px] ${dark ? 'text-gray-400' : 'text-[#6E7C8E]'}`}>
                  {t({ ne: 'आफ्नै', en: 'custom' })}
                </span>
              )}
              <span className={`block text-[11.5px] ${dark ? 'text-gray-400' : 'text-[#6E7C8E]'}`}>
                {t({
                  ne: `${num(folder.photo_count)} तस्बिर`,
                  en: `${folder.photo_count} photo${folder.photo_count === 1 ? '' : 's'}`,
                })}
              </span>
            </span>
            {dark ? (
              <button
                type="button"
                disabled={!page.can_upload || busy === folder.id}
                onClick={() => pick(folder.id)}
                title={
                  page.can_upload
                    ? undefined
                    : t({
                        ne: 'बैठक सकिएपछि खुल्छ',
                        en: 'Opens once the meeting has finished',
                      })
                }
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 flex-none"
              >
                {busy === folder.id
                  ? t({ ne: 'पठाउँदै…', en: 'Adding…' })
                  : t({ ne: 'अपलोड', en: 'Upload' })}
              </button>
            ) : (
              <Btn
                sm
                disabled={!page.can_upload || busy === folder.id}
                onClick={() => pick(folder.id)}
                title={
                  page.can_upload
                    ? undefined
                    : t({
                        ne: 'बैठक सकिएपछि खुल्छ',
                        en: 'Opens once the meeting has finished',
                      })
                }
              >
                {busy === folder.id
                  ? t({ ne: 'पठाउँदै…', en: 'Adding…' })
                  : t({ ne: 'अपलोड', en: 'Upload' })}
              </Btn>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

type Filter = 'all' | 'mine';

/**
 * The photographs in the portal, where there is room to look at them.
 *
 * Folders first, as tiles; opening one shows what is inside without
 * anybody having to click a photograph to find out what it is.
 */
export const PhotoAlbums: React.FC<{
  meetingRef: string;
  /** Set where the reader may add photographs as well as look at them. */
  canManage?: boolean;
}> = ({ meetingRef, canManage = true }) => {
  const { t, num } = useOrganizer();
  const { page, loading, reload } = usePhotos(meetingRef);
  const { pick, busy, input } = useUploader(meetingRef, () => reload(true));
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => { setOpenFolder(null); }, [meetingRef]);

  const addFolder = async () => {
    const name = askForName(t);
    if (!name) return;
    try {
      await apiClient.createPhotoFolder(meetingRef, name);
      await reload(true);
    } catch (error) {
      toast.error(refusalText(error, t({
        ne: 'फोल्डर बनाउन सकिएन', en: 'Could not create the folder',
      })));
    }
  };

  const removeFolder = async (folder: PhotoFolder) => {
    const ok = window.confirm(t({
      ne: `“${folder.name}” हटाउने?\n\nभित्रका तस्बिर पूर्वनिर्धारित फोल्डरमा जान्छन्।`,
      en: `Remove “${folder.name}”?\n\nWhat is inside moves to the default folder.`,
    }));
    if (!ok) return;
    try {
      await apiClient.deletePhotoFolder(meetingRef, folder.id);
      setOpenFolder(null);
      await reload(true);
    } catch (error) {
      toast.error(refusalText(error, t({
        ne: 'हटाउन सकिएन', en: 'Could not remove it',
      })));
    }
  };

  const removePhoto = async (photo: MeetingPhoto) => {
    if (!window.confirm(t({ ne: 'यो तस्बिर हटाउने?', en: 'Remove this photograph?' }))) return;
    try {
      await apiClient.deletePhoto(photo.id);
      await reload(true);
    } catch (error) {
      toast.error(refusalText(error, t({
        ne: 'हटाउन सकिएन', en: 'Could not remove it',
      })));
    }
  };

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }
  if (!page) {
    return <Empty>{t({ ne: 'कुनै बैठक छानिएको छैन।', en: 'No meeting chosen.' })}</Empty>;
  }

  const mayAdd = canManage && page.is_a_photographer;
  const inFolder = (id: string) =>
    page.photos.filter(
      (p) => p.folder_id === id && (filter === 'all' || p.is_mine)
    );

  // A folder that is open reads as its own page: the wall of tiles is the
  // way back, so it is replaced rather than pushed aside.
  const current = page.folders.find((f) => f.id === openFolder) ?? null;

  return (
    <>
      {input}

      <div className="flex items-center gap-1.5 flex-wrap mb-3.5">
        {(
          [
            ['all', { ne: 'सबै', en: 'All' }],
            ['mine', { ne: 'मैले खिचेका', en: 'Mine' }],
          ] as [Filter, Pair][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`text-[12.5px] px-3 py-1.5 rounded-full border ${
              filter === key
                ? 'bg-navy-800 border-navy-800 text-white font-medium'
                : 'border-navy-800/15 hover:bg-navy-800/[.04]'
            }`}
          >
            {t(label)}
          </button>
        ))}

        <span className="ms-auto flex items-center gap-2">
          {!page.meeting_is_finished && mayAdd && (
            <Chip tone="warn">
              {t({ ne: 'बैठक सकिएपछि', en: 'Once the meeting ends' })}
            </Chip>
          )}
          {mayAdd && page.can_arrange && (
            <Btn sm onClick={addFolder}>
              {t({ ne: 'फोल्डर बनाउने', en: 'Create folder' })}
            </Btn>
          )}
        </span>
      </div>

      {current === null ? (
        page.folders.length === 0 ? (
          <Empty>{t({ ne: 'कुनै फोल्डर छैन।', en: 'No folders yet.' })}</Empty>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))' }}
          >
            {page.folders.map((folder) => {
              const shots = inFolder(folder.id);
              const cover = shots[0];
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setOpenFolder(folder.id)}
                  className="relative text-start rounded-xl overflow-hidden h-[132px] text-white
                    focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-amber"
                  style={{ background: tintFor(folder.id) }}
                >
                  {cover && (
                    <PhotoImage
                      photo={cover}
                      className="absolute inset-0 w-full h-full object-cover opacity-45"
                    />
                  )}
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.55))',
                    }}
                  />
                  {folder.is_mine && !folder.is_default && (
                    <span className="absolute top-2 end-2 text-[10.5px] bg-white/25 rounded-full px-2 leading-[18px]">
                      {t({ ne: 'मेरो', en: 'Mine' })}
                    </span>
                  )}
                  <span className="absolute inset-x-3 bottom-2.5">
                    <span className="block text-[13.5px] font-semibold truncate">
                      {folder.name}
                    </span>
                    <span className="block text-[11.5px] opacity-85 truncate">
                      {t({
                        ne: `${num(shots.length)} तस्बिर`,
                        en: `${shots.length} photo${shots.length === 1 ? '' : 's'}`,
                      })}
                      {folder.created_by ? ` · ${folder.created_by}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <Panel
          title={current.name}
          aside={
            <Chip>
              {t({
                ne: `${num(inFolder(current.id).length)} तस्बिर`,
                en: `${inFolder(current.id).length} photo${
                  inFolder(current.id).length === 1 ? '' : 's'
                }`,
              })}
            </Chip>
          }
          actions={
            <>
              <Btn sm onClick={() => setOpenFolder(null)}>
                {t({ ne: 'फोल्डरहरू', en: 'All folders' })}
              </Btn>
              {mayAdd && (
                <Btn
                  sm
                  tone="amber"
                  disabled={!page.can_upload || busy === current.id}
                  onClick={() => pick(current.id)}
                  title={
                    page.can_upload
                      ? undefined
                      : t({
                          ne: 'बैठक सकिएपछि खुल्छ',
                          en: 'Opens once the meeting has finished',
                        })
                  }
                >
                  {busy === current.id
                    ? t({ ne: 'पठाउँदै…', en: 'Adding…' })
                    : t({ ne: 'तस्बिर थप्ने', en: 'Add photos' })}
                </Btn>
              )}
              {mayAdd && page.can_arrange && !current.is_default && (
                <Btn sm onClick={() => removeFolder(current)}>
                  {t({ ne: 'फोल्डर हटाउने', en: 'Remove folder' })}
                </Btn>
              )}
            </>
          }
        >
          {inFolder(current.id).length === 0 ? (
            <Empty>
              {filter === 'mine'
                ? t({ ne: 'तपाईंले खिचेको कुनै तस्बिर छैन।', en: 'None of these are yours.' })
                : t({ ne: 'यो फोल्डर खाली छ।', en: 'This folder is empty.' })}
            </Empty>
          ) : (
            <div
              className="grid gap-2.5 p-3.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}
            >
              {inFolder(current.id).map((photo) => (
                <figure
                  key={photo.id}
                  className="border border-navy-800/15 rounded-[10px] overflow-hidden bg-cream"
                >
                  <PhotoImage
                    photo={photo}
                    className="w-full h-[132px] object-cover bg-cream-200"
                  />
                  <figcaption className="px-2.5 py-2">
                    <span className="block text-[12.5px] truncate" title={photo.caption}>
                      {photo.caption || t({ ne: 'तस्बिर', en: 'Photograph' })}
                    </span>
                    <span className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-[#6E7C8E] truncate flex-1">
                        {photo.taken_by}
                      </span>
                      <a
                        href={photo.url}
                        onClick={async (e) => {
                          // The file needs the signed-in request, so it is
                          // fetched and handed over rather than linked.
                          e.preventDefault();
                          try {
                            const url = await apiClient.getPhotoObjectUrl(photo.id);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = photo.caption || `${photo.id}.jpg`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch {
                            toast.error(t({
                              ne: 'डाउनलोड सकिएन', en: 'Could not download it',
                            }));
                          }
                        }}
                        className="text-[11.5px] underline text-navy-700"
                      >
                        {t({ ne: 'डाउनलोड', en: 'Download' })}
                      </a>
                      {(photo.is_mine || page.can_arrange) && mayAdd && (
                        <button
                          type="button"
                          onClick={() => removePhoto(photo)}
                          aria-label={t({ ne: 'तस्बिर हटाउने', en: 'Remove photograph' })}
                          className="text-[#6E7C8E] hover:text-live text-[15px] leading-none"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Panel>
      )}
    </>
  );
};
