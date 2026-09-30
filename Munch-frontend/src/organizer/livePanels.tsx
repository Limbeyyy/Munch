import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Artifact, ChatMessage, PhotoPage, Session } from '../types';
import { Pair, useOrganizer } from './i18n';
import { errorText } from './errors';
import { KindChip, clockOf, dayOf, formatSize, kindOf } from './filesAndSummaries/shared';
import { PhotoImage } from './Photos';

/**
 * The three panels the host's desk carries during a room.
 *
 * Kept here rather than in the shared components the room and the
 * photographs page already use: those are read by attendees and guests
 * too, and pulling them towards a host's desk would have served
 * neither. What is shared is the data, not the drawing.
 */

const Trash: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"
      stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

/* ==================================================================
   Slides
   ================================================================== */

/**
 * What has been shared, under the talk it belongs to.
 *
 * A flat list said which files existed and not which part of the day
 * they were for, which is the question a host asks of them while the
 * day is running. Each group carries its own Add, so a file goes where
 * it was put rather than against whatever happens to be on stage.
 */
export const SlideGroups: React.FC<{
  eventId: string;
  sessions: Session[];
  live: Session | null;
}> = ({ eventId, sessions, live }) => {
  const { t, num } = useOrganizer();
  const [files, setFiles] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(false);
  /** Which group's picker was opened, so the file lands in it. */
  const into = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const read = useCallback(() => {
    apiClient.getResources(eventId).then(setFiles).catch(() => setFiles([]));
  }, [eventId]);

  useEffect(() => { read(); }, [read]);

  const order = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const loose = files.filter(
    (one) => !one.session || !order.some((s) => s.id === one.session)
  );

  const add = async (chosen: File[]) => {
    const sessionId = into.current;
    setBusy(true);
    let done = 0;
    for (const file of chosen) {
      try {
        await apiClient.uploadResource(
          eventId, file, undefined, sessionId ?? undefined
        );
        done += 1;
      } catch (e: any) {
        toast.error(errorText(e, t({ ne: 'अपलोड भएन', en: 'Upload failed' })));
      }
    }
    if (done > 0) {
      toast.success(t({
        ne: `${num(done)} फाइल थपियो`,
        en: done === 1 ? 'File added' : `${done} files added`,
      }));
    }
    setBusy(false);
    read();
  };

  const drop = async (one: Artifact) => {
    setBusy(true);
    try {
      await apiClient.deleteResource(eventId, one.id);
      toast.success(t({ ne: 'फाइल हटाइयो', en: 'File removed' }));
      read();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' })));
    } finally {
      setBusy(false);
    }
  };

  const Group: React.FC<{
    id: string | null;
    title: string;
    under: string;
    mine: Artifact[];
    onStage: boolean;
  }> = ({ id, title, under, mine, onStage }) => (
    <div className="bg-white border-[0.612px] border-[#ccc] rounded-[12px]
      overflow-hidden
      shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]">
      <div className="px-5 py-4 border-b-[0.612px] border-[#f3f4f6]
        flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-5 text-[#101828] truncate">
            {title}
          </p>
          <p className="pt-0.5 text-[12px] leading-4 text-[#99a1af]">{under}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => { into.current = id; picker.current?.click(); }}
          className={`flex-none rounded-[8px] px-2.5 py-1.5 text-[12px] leading-4
            border-[0.612px] disabled:opacity-50 ${
            onStage
              ? 'border-[#194d97] text-[#194d97] hover:bg-[#194d97]/[.06]'
              : 'border-[#e5e7eb] text-[#6a7282] hover:bg-black/[.03]'
          }`}
        >
          {busy
            ? t({ ne: 'पठाउँदै…', en: 'Uploading…' })
            : t({ ne: '+ थप्नुहोस्', en: '+ Add' })}
        </button>
      </div>

      {mine.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-[#99a1af]">
          {t({ ne: 'कुनै फाइल छैन।', en: 'Nothing shared yet.' })}
        </p>
      ) : (
        mine.map((one, i) => (
          <div
            key={one.id}
            className={`px-5 py-3 flex gap-4 items-center ${
              i < mine.length - 1 ? 'border-b-[0.612px] border-[#f9fafb]' : ''
            }`}
          >
            <KindChip kind={kindOf(one.display_name ?? '')} />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium leading-5 text-[#101828] truncate">
                {one.display_name}
              </p>
              <p className="text-[12px] leading-4 text-[#99a1af] truncate">
                {[
                  formatSize(one.file_size),
                  one.uploaded_by_name,
                  dayOf(one.created_at, t),
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => drop(one)}
              aria-label={t({
                ne: `${one.display_name} हटाउनुहोस्`,
                en: `Remove ${one.display_name}`,
              })}
              className="size-11 grid place-items-center rounded-[12px]
                text-[#d81313] hover:bg-[#d81313]/[.06] disabled:opacity-50"
            >
              <Trash />
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      <input
        ref={picker}
        type="file"
        multiple
        aria-label={t({ ne: 'फाइल छान्नुहोस्', en: 'Choose files' })}
        className="hidden"
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (chosen.length > 0) add(chosen);
        }}
      />

      {order.length === 0 && loose.length === 0 && (
        <p className="text-[12.5px] text-[#99a1af]">
          {t({ ne: 'कुनै कार्यसूची छैन।', en: 'Nothing on the programme yet.' })}
        </p>
      )}

      {order.map((one) => {
        const mine = files.filter((f) => f.session === one.id);
        return (
          <Group
            key={one.id}
            id={one.id}
            title={one.title}
            under={`${clockOf(one.starts_at)} · ${t({
              ne: `${num(mine.length)} फाइल`,
              en: `${mine.length} file${mine.length === 1 ? '' : 's'}`,
            })}`}
            mine={mine}
            onStage={live?.id === one.id}
          />
        );
      })}

      {/* Shared against the event rather than a talk. Kept visible: a
          file nobody can find is the same as one nobody shared. */}
      {loose.length > 0 && (
        <Group
          id={null}
          title={t({ ne: 'कार्यक्रमभरि', en: 'For the whole event' })}
          under={t({
            ne: `${num(loose.length)} फाइल`,
            en: `${loose.length} file${loose.length === 1 ? '' : 's'}`,
          })}
          mine={loose}
          onStage={false}
        />
      )}
    </div>
  );
};

/* ==================================================================
   Questions
   ================================================================== */

const ago = (iso: string, t: (pair: Pair) => string, num: (n: number | string) => string) => {
  const mins = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  if (mins < 1) return t({ ne: 'भर्खरै', en: 'just now' });
  if (mins < 60) return t({ ne: `${num(mins)} मिनेट अघि`, en: `${mins} min ago` });
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return t({ ne: `${num(hours)} घण्टा अघि`, en: `${hours} hr ago` });
  }
  return clockOf(iso);
};

/**
 * What the room has asked and nobody has answered for yet.
 *
 * Grouped under the talk it was asked during, because a host deciding
 * on twenty questions is deciding about four talks, and the pile told
 * them nothing about which. Each group says how many are waiting on
 * it, which is the number that makes somebody open it.
 */
export const PendingQuestions: React.FC<{
  eventId: string;
  sessions: Session[];
  /** Polled, because they arrive from the room while this is open. */
  refreshMs?: number;
}> = ({ eventId, sessions, refreshMs = 15000 }) => {
  const { t, num } = useOrganizer();
  const [waiting, setWaiting] = useState<ChatMessage[]>([]);
  const [shut, setShut] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(() => {
    apiClient.getPendingMessages(eventId)
      .then(setWaiting)
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    read();
    const timer = window.setInterval(read, refreshMs);
    return () => window.clearInterval(timer);
  }, [read, refreshMs]);

  const decide = async (one: ChatMessage, how: 'approve' | 'decline') => {
    setBusy(one.id);
    // Off the list at once. It is decided, and waiting for the next
    // poll to agree would leave the host looking at a stale queue.
    setWaiting((was) => was.filter((m) => m.id !== one.id));
    try {
      // No topic named. Approving files it where the asker put it,
      // which is the rule the queue beside this one already follows -
      // naming one here would overrule them.
      await apiClient.moderateMessage(eventId, one.id, how);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भएन', en: 'That did not go through' })));
      read();
    } finally {
      setBusy(null);
    }
  };

  const order = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const groups = useMemo(() => {
    const named = order
      .map((one) => ({
        id: one.id,
        title: one.title,
        under: one.speaker_name || '',
        mine: waiting.filter((m) => m.session === one.id),
      }))
      .filter((g) => g.mine.length > 0);

    const loose = waiting.filter(
      (m) => !m.session || !order.some((s) => s.id === m.session)
    );
    return loose.length > 0
      ? [...named, {
          id: '',
          title: t({ ne: 'कार्यसूची बाहिर', en: 'Not against a talk' }),
          under: '',
          mine: loose,
        }]
      : named;
  }, [order, waiting, t]);

  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-[12.5px] text-[#99a1af]">
        {t({ ne: 'पर्खिरहेको प्रश्न छैन।', en: 'Nothing waiting on you.' })}
      </p>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {groups.map((group) => {
        const open = !shut.includes(group.id);
        return (
          <div
            key={group.id || 'loose'}
            className="bg-white border-[0.612px] border-[#e1e1e1] rounded-[12px]
              overflow-hidden py-1
              shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]"
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setShut((was) => (
                open ? [...was, group.id] : was.filter((k) => k !== group.id)
              ))}
              className={`w-full px-4 py-3 flex items-center justify-between gap-3
                text-left ${open ? 'border-b-[0.6px] border-[#ccc]' : ''}`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="#6a7282" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden
                  className={`flex-none transition-transform ${
                    open ? 'rotate-90' : ''
                  }`}>
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium leading-5
                    text-[#101828] truncate">
                    {group.title}
                  </span>
                  {group.under && (
                    <span className="block text-[12px] leading-4 text-[#99a1af]">
                      {group.under}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex-none bg-[#f3f4f6] rounded-full px-2 py-0.5
                text-[12px] font-medium leading-4 text-[#6a7282]">
                {t({
                  ne: `${num(group.mine.length)} पर्खाइमा`,
                  en: `${group.mine.length} pending`,
                })}
              </span>
            </button>

            {open && (
              <div className="px-4 pt-1 pb-4 flex flex-col gap-2">
                {group.mine.map((one) => (
                  <div
                    key={one.id}
                    className="bg-white border-[0.612px] border-[#b3b3b3]
                      rounded-[12px] p-4"
                  >
                    <div className="flex gap-3 items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] leading-[22.75px] text-[#101828]">
                          “{one.body}”
                        </p>
                        <div className="pt-2 flex gap-3 items-center flex-wrap">
                          <span className="text-[12px] font-medium leading-4
                            text-[#6a7282]">
                            {one.sender_name}
                          </span>
                          <span className="text-[12px] leading-4 text-[#99a1af]">
                            {ago(one.created_at, t, num)}
                          </span>
                          {one.session_title && (
                            <span className="bg-[#f3f4f6] rounded-[4px] px-1.5 py-0.5
                              text-[11px] leading-[14.667px] text-[#6a7282]">
                              {one.session_title}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1.5 items-center flex-none">
                        <button
                          type="button"
                          disabled={busy === one.id}
                          onClick={() => decide(one, 'decline')}
                          className="border-[0.612px] border-[#e5e7eb] rounded-[8px]
                            px-2.5 py-1 text-[12px] leading-4 text-[#4a5565]
                            hover:bg-black/[.03] disabled:opacity-50"
                        >
                          {t({ ne: 'अस्वीकार', en: 'Reject' })}
                        </button>
                        <button
                          type="button"
                          disabled={busy === one.id}
                          onClick={() => decide(one, 'approve')}
                          className="bg-[#12386e] rounded-[8px] px-2.5 py-1
                            text-[12px] font-medium leading-4 text-white
                            hover:bg-[#12386e]/90 disabled:opacity-50"
                        >
                          {t({ ne: 'स्वीकार', en: 'Approve' })}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ==================================================================
   Photos
   ================================================================== */

const FolderGlyph: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6a7282"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </svg>
);

/**
 * The albums, as a shelf rather than a page.
 *
 * The photographs page draws filters, a grid and an uploader, which is
 * right where looking at photographs is the whole job. On a desk
 * driving a room it is one panel of several, so this shows the shelf -
 * what folders there are and how full - and opens one when asked.
 */
export const PhotoFolderStrip: React.FC<{ eventRef: string }> = ({ eventRef }) => {
  const { t, num } = useOrganizer();
  const [page, setPage] = useState<PhotoPage | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const read = useCallback(() => {
    apiClient.getPhotos(eventRef).then(setPage).catch(() => setPage(null));
  }, [eventRef]);

  useEffect(() => { read(); setOpen(null); }, [read]);

  const make = async () => {
    const name = window.prompt(t({ ne: 'फोल्डरको नाम', en: 'Folder name' }));
    if (!name || !name.trim()) return;
    setMaking(true);
    try {
      await apiClient.createPhotoFolder(eventRef, name.trim());
      read();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बनाउन सकिएन', en: 'Could not create it' })));
    } finally {
      setMaking(false);
    }
  };

  const folders = page?.folders ?? [];
  const inside = page?.photos.filter((p) => p.folder_id === open) ?? [];

  return (
    <div className="p-4">
      <div className="flex gap-2 items-stretch flex-wrap">
        {page?.can_arrange && (
          <button
            type="button"
            disabled={making}
            onClick={make}
            className="w-[88px] h-[81px] flex-none bg-white border-[0.401px]
              border-[#e5e7eb] rounded-[7.872px] p-[10.496px]
              flex flex-col gap-1.5 items-center justify-center
              drop-shadow-[0px_2.6px_2px_rgba(0,0,0,0.1)]
              hover:bg-black/[.02] disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#1d1d1d" strokeWidth="1.8" strokeLinecap="round"
              aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="text-[12px] leading-5 text-[#1d1d1d]">
              {t({ ne: 'नयाँ फोल्डर', en: 'New Folder' })}
            </span>
          </button>
        )}

        {folders.length === 0 ? (
          <p className="self-center text-[12.5px] text-[#99a1af]">
            {t({ ne: 'अझै कुनै फोल्डर छैन।', en: 'No folders yet.' })}
          </p>
        ) : (
          folders.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={open === one.id}
              onClick={() => setOpen(open === one.id ? null : one.id)}
              className={`flex-1 min-w-[170px] h-[81px] bg-white border-[0.401px]
                rounded-[7.872px] p-[10.496px] text-left
                drop-shadow-[0px_2.6px_2px_rgba(0,0,0,0.1)] hover:bg-black/[.02] ${
                open === one.id ? 'border-[#194d97]' : 'border-[#e5e7eb]'
              }`}
            >
              <span className="size-[26px] rounded-[5.248px] bg-[#f3f4f6]
                grid place-items-center">
                <FolderGlyph />
              </span>
              <span className="block pt-2 text-[12px] font-semibold
                leading-[13.12px] text-[#101828] truncate">
                {one.name}
              </span>
              <span className="block pt-1 text-[10px] leading-[10.496px]
                text-[#99a1af] truncate">
                {t({
                  ne: `${num(one.photo_count)} तस्बिर`,
                  en: `${one.photo_count} photo${one.photo_count === 1 ? '' : 's'}`,
                })}
                {one.created_by ? ` · ${one.created_by}` : ''}
              </span>
            </button>
          ))
        )}
      </div>

      {/* What is in the one that was opened. The shelf on its own would
          say how many photographs there are and never show one. */}
      {open && (
        inside.length === 0 ? (
          <p className="pt-4 text-[12.5px] text-[#99a1af]">
            {t({ ne: 'यो फोल्डर खाली छ।', en: 'This folder is empty.' })}
          </p>
        ) : (
          <div
            className="pt-4 grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))' }}
          >
            {inside.map((photo) => (
              <PhotoImage
                key={photo.id}
                photo={photo}
                className="w-full aspect-square object-cover rounded-[8px]
                  bg-[#f3f4f6]"
              />
            ))}
          </div>
        )
      )}
    </div>
  );
};
