import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, EventPhoto, PhotoFolder } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Modal } from '../OrganizerShell';
import {
  FilledButton, NothingYet, QuietButton, SearchInput, dayOf,
} from './shared';

/**
 * The six tints the design lays a photograph on.
 *
 * A picture arrives after its tile does - it is fetched on the signed-in
 * request rather than linked - so the tile has to be something while it
 * waits. The design fills it with a colour, and cycling six of them
 * keeps a wall of them from reading as one grey block.
 */
const TINTS = [
  '#eaebed', '#e3edfe', '#dcf5ed', '#fef1dc', '#fce4e4', '#eee7fe',
];

/** One photograph, fetched and shown once its bytes arrive. */
const Tile: React.FC<{ photo: EventPhoto; tint: string }> = ({ photo, tint }) => {
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
    <div
      className="aspect-square rounded-[8px] overflow-hidden grid place-items-center"
      style={{ backgroundColor: tint }}
    >
      {src ? (
        <img
          src={src}
          alt={photo.caption || ''}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="size-6 rounded-full bg-black/10" aria-hidden />
      )}
    </div>
  );
};

/**
 * The photographs of an event, in the folders somebody put them in.
 *
 * Two screens: the folders, and one folder's contents. A folder is the
 * whole of how these are arranged, so opening one replaces the grid
 * rather than expanding inside it.
 */
export const PhotosTab: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  /** Which folder is open. Empty means the grid of folders. */
  const [opened, setOpened] = useState('');

  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [chosen, setChosen] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await apiClient.getPhotos(event.code);
      setFolders(page.folders);
      setPhotos(page.photos);
    } catch {
      setFolders([]);
      setPhotos([]);
    }
    setLoading(false);
  }, [event.code]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const name = folderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await apiClient.createPhotoFolder(event.code, name);
      toast.success(t({ ne: 'फोल्डर बन्यो', en: 'Folder created' }));
      setNaming(false);
      setFolderName('');
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बनेन', en: 'Could not create it' })));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (chosen.length === 0 || !opened) return;
    setBusy(true);
    let done = 0;
    for (const file of chosen) {
      try {
        await apiClient.uploadPhoto(event.code, opened, file);
        done += 1;
      } catch (e: any) {
        toast.error(errorText(e, t({ ne: 'अपलोड भएन', en: 'Upload failed' })));
      }
    }
    if (done > 0) {
      toast.success(t({
        ne: `${num(done)} तस्बिर थपियो`,
        en: done === 1 ? 'Photo added' : `${done} photos added`,
      }));
    }
    setUploading(false);
    setChosen([]);
    setBusy(false);
    await load();
  };

  if (loading) {
    return <NothingYet title={t({ ne: 'ल्याउँदै…', en: 'Loading…' })} />;
  }

  const folder = folders.find((one) => one.id === opened);
  const inside = photos.filter((one) => one.folder_id === opened);

  // -- one folder --------------------------------------------------------

  if (folder) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-4 items-center justify-between flex-wrap">
          <button
            type="button"
            onClick={() => setOpened('')}
            className="flex gap-1 items-center text-[14px] text-body hover:text-head"
          >
            <span aria-hidden>‹</span>
            {t({ ne: 'फोल्डरहरू', en: 'Folders' })}
          </button>
          <FilledButton onClick={() => { setChosen([]); setUploading(true); }}>
            <span aria-hidden>+</span>
            {t({ ne: 'तस्बिर थप्नुहोस्', en: 'Upload photos' })}
          </FilledButton>
        </div>

        <div>
          <h3 className="text-[14px] font-semibold text-head leading-5">
            {folder.name}
          </h3>
          <p className="pt-0.5 text-[12px] text-faint leading-4">
            {t({
              ne: `${num(inside.length)} तस्बिर`,
              en: inside.length === 1 ? '1 photo' : `${inside.length} photos`,
            })}
          </p>
        </div>

        {inside.length === 0 ? (
          <NothingYet
            title={t({ ne: 'यो फोल्डर खाली छ', en: 'This folder is empty' })}
            lede={t({
              ne: 'थपिएका तस्बिर यहाँ देखिनेछन्।',
              en: 'Photographs added here will appear in this grid.',
            })}
          />
        ) : (
          <div className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))' }}>
            {inside.map((one, i) => (
              <Tile key={one.id} photo={one} tint={TINTS[i % TINTS.length]} />
            ))}
          </div>
        )}

        {/* 641-19779 */}
        <Modal
          open={uploading}
          onClose={() => setUploading(false)}
          title={t({ ne: 'तस्बिर थप्नुहोस्', en: 'Upload photos' })}
          divided
          footer={
            <>
              <QuietButton
                className="!text-[14px] !px-4 !py-2"
                disabled={busy}
                onClick={() => setUploading(false)}
              >
                {t({ ne: 'रद्द', en: 'Cancel' })}
              </QuietButton>
              <button
                type="button"
                disabled={busy || chosen.length === 0}
                onClick={upload}
                className="bg-navy-800 rounded-[8px] px-4 py-2 text-[14px]
                  font-medium text-white hover:bg-navy-900 disabled:opacity-50"
              >
                {busy
                  ? t({ ne: 'थप्दै…', en: 'Uploading…' })
                  : t({ ne: 'अपलोड', en: 'Upload' })}
              </button>
            </>
          }
        >
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              setChosen(Array.from(e.dataTransfer.files));
            }}
            className={`border border-dashed rounded-[8px] py-10
              flex flex-col items-center gap-1 ${
              dragging ? 'border-navy-800 bg-navy-800/[.03]' : 'border-line'
            }`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              aria-hidden="true" className="text-faint">
              <path d="M12 16V4M12 4L7 9M12 4l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="pt-1 text-[14px] text-head">
              {t({ ne: 'तस्बिर यहाँ तान्नुहोस्', en: 'Drag & drop photos here' })}
            </p>
            <p className="text-[12px] text-faint">
              {t({ ne: 'JPG, PNG, HEIC', en: 'JPG, PNG, HEIC supported' })}
            </p>
            <input
              ref={picker}
              type="file"
              multiple
              accept="image/*"
              aria-label={t({ ne: 'तस्बिर छान्नुहोस्', en: 'Choose photos' })}
              className="hidden"
              onChange={(e) => {
                setChosen(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="mt-2 border border-line rounded-[8px] px-3 py-1.5
                text-[14px] text-head bg-white hover:border-navy-800"
            >
              {t({ ne: 'फाइल छान्नुहोस्', en: 'Browse files' })}
            </button>
            {chosen.length > 0 && (
              <p className="pt-2 text-[12px] text-navy-600">
                {t({
                  ne: `${num(chosen.length)} छानियो`,
                  en: `${chosen.length} selected`,
                })}
              </p>
            )}
          </div>
        </Modal>
      </div>
    );
  }

  // -- the folders -------------------------------------------------------

  const shown = folders.filter((one) =>
    one.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 items-center justify-between flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          label={t({ ne: 'फोल्डर खोज्नुहोस्', en: 'Search Files' })}
        />
        <FilledButton onClick={() => { setFolderName(''); setNaming(true); }}>
          <span aria-hidden>+</span>
          {t({ ne: 'नयाँ फोल्डर', en: 'New Folder' })}
        </FilledButton>
      </div>

      {shown.length === 0 ? (
        <NothingYet
          title={t({ ne: 'कुनै फोल्डर छैन', en: 'No folders yet' })}
          lede={t({
            ne: 'तस्बिर राख्न पहिले फोल्डर बनाउनुहोस्।',
            en: 'Make a folder to put photographs in.',
          })}
        />
      ) : (
        <div className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
          {shown.map((one) => (
            <button
              key={one.id}
              type="button"
              onClick={() => setOpened(one.id)}
              className="bg-white border-[0.6px] border-[#ccc] rounded-[12px] p-5
                flex flex-col items-start text-left hover:border-navy-800
                shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]"
            >
              <span className="bg-[#f3f4f6] rounded-[8px] size-8 grid place-items-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  aria-hidden="true" className="text-[#6a7282]">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                    stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="pt-3 text-[14px] font-semibold text-head leading-5
                truncate w-full">
                {one.name}
              </span>
              <span className="pt-0.5 text-[12px] text-faint leading-4">
                {[
                  t({
                    ne: `${num(one.photo_count)} तस्बिर`,
                    en: one.photo_count === 1
                      ? '1 photo' : `${one.photo_count} photos`,
                  }),
                  t({
                    ne: `${dayOf(one.created_at, t)} अद्यावधिक`,
                    en: `Updated ${dayOf(one.created_at, t)}`,
                  }),
                ].join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 641-19229 */}
      <Modal
        open={naming}
        onClose={() => setNaming(false)}
        title={t({ ne: 'फोल्डर बनाउनुहोस्', en: 'Create folder' })}
        divided
        footer={
          <>
            <QuietButton
              className="!text-[14px] !px-4 !py-2"
              disabled={busy}
              onClick={() => setNaming(false)}
            >
              {t({ ne: 'रद्द', en: 'Cancel' })}
            </QuietButton>
            <button
              type="button"
              disabled={busy || folderName.trim() === ''}
              onClick={create}
              className="bg-navy-800 rounded-[8px] px-4 py-2 text-[14px]
                font-medium text-white hover:bg-navy-900 disabled:opacity-50"
            >
              {t({ ne: 'फोल्डर बनाउनुहोस्', en: 'Create folder' })}
            </button>
          </>
        }
      >
        <label
          htmlFor="manch-folder-name"
          className="block text-[12px] text-subtle leading-4 pb-1"
        >
          {t({ ne: 'फोल्डरको नाम', en: 'Folder name' })}
        </label>
        <input
          id="manch-folder-name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder={t({ ne: 'वक्ताका कार्यसूची', en: 'Speaker Agendas' })}
          className="w-full border border-line rounded-[8px] h-10 px-3
            text-[14px] text-head placeholder:text-faint"
        />
      </Modal>
    </div>
  );
};
