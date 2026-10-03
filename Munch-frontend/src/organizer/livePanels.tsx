import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Artifact, ChatMessage, EventBoard, PhotoPage, Session } from '../types';
import { Pair, useOrganizer } from './i18n';
import { errorText } from './errors';
import {
  FolderNameDialog, KindChip, clockOf, dayOf, formatSize, kindOf,
} from './filesAndSummaries/shared';
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
 * The questions or suggestions the host has put on their respective boards.
 *
 * Published entries and their pending requests, filed together under
 * the talk they belong to. Approving a request puts it on the same board.
 *
 * Grouped under the talk it was asked during, because a host looking
 * at twenty questions is looking at four talks.
 */
export const PendingQuestions: React.FC<{
  eventId: string;
  sessions: Session[];
  topic: 'faq' | 'suggestions';
  /** Refresh the published board entries and their vote totals. */
  refreshMs?: number;
}> = ({ eventId, sessions, topic, refreshMs = 15000 }) => {
  const { t, num } = useOrganizer();
  const [waiting, setWaiting] = useState<ChatMessage[]>([]);
  const [board, setBoard] = useState<EventBoard>({ faq: [], suggestions: [] });
  const [shut, setShut] = useState<string[]>([]);

  const read = useCallback(() => {
    apiClient.getModerationQueue(eventId)
      .then((queue) => setWaiting(queue.approved))
      .catch(() => undefined);
    apiClient.getEventBoard(eventId)
      .then(setBoard)
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    read();
    const timer = window.setInterval(read, refreshMs);
    return () => window.clearInterval(timer);
  }, [read, refreshMs]);

  const order = useMemo(
    () => [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    ),
    [sessions]
  );

  const messages = useMemo(() => {
    const fromQueue = new Map(
      waiting.filter((message) => topic === 'faq'
        ? message.topic === 'faq'
        : message.topic === 'suggestion')
        .map((message) => [message.id, message])
    );
    const entries = topic === 'faq' ? board.faq : board.suggestions;
    const fromBoard = entries.map((entry) => {
      const details = fromQueue.get(entry.id);
      return {
        id: entry.id,
        body: entry.body,
        sender_name: details?.sender_name ?? entry.asked_by,
        created_at: entry.created_at,
        session: details?.session ?? null,
        session_title: details?.session_title ?? null,
        upvote_count: entry.upvote_count ?? 0,
        downvote_count: entry.downvote_count ?? 0,
        score: entry.score ?? (entry.upvote_count ?? 0) - (entry.downvote_count ?? 0),
      };
    });
    const boardIds = new Set(fromBoard.map((entry) => entry.id));
    const queueOnly = Array.from(fromQueue.values())
      .filter((message) => !boardIds.has(message.id))
      .map((message) => {
        const entry = entries.find((item) => item.id === message.id);
        return {
          id: message.id,
          body: message.body,
          sender_name: message.sender_name,
          created_at: message.created_at,
          session: message.session,
          session_title: message.session_title,
          upvote_count: entry?.upvote_count ?? 0,
          downvote_count: entry?.downvote_count ?? 0,
          score: entry?.score
            ?? (entry?.upvote_count ?? 0) - (entry?.downvote_count ?? 0),
        };
      });
    const combined = [...fromBoard, ...queueOnly];
    return topic === 'faq'
      ? combined.sort((a, b) =>
          b.score - a.score
          || b.upvote_count - a.upvote_count
          || a.downvote_count - b.downvote_count
          || +new Date(a.created_at) - +new Date(b.created_at)
        )
      : combined;
  }, [board, topic, waiting]);

  const groups = useMemo(() => {
    const named = order
      .map((one) => ({
        id: one.id,
        title: one.title,
        under: one.speaker_name || '',
        mine: messages.filter((m) => m.session === one.id),
      }))
      .filter((g) => g.mine.length > 0);

    const loose = messages.filter(
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
  }, [messages, order, t]);

  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-[12.5px] text-[#99a1af]">
        {topic === 'faq'
          ? t({
              ne: 'अझै कुनै प्रश्न स्वीकृत भएको छैन।',
              en: 'Nothing has been let through yet.',
            })
          : t({
              ne: 'अझै कुनै सुझाव छैन।',
              en: 'No suggestions yet.',
            })}
      </p>
    );
  }

  return (
    <div className="max-h-[360px] overflow-y-auto overscroll-contain p-4 flex flex-col gap-3">
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
                  ne: topic === 'faq'
                    ? `${num(group.mine.length)} प्रश्न`
                    : `${num(group.mine.length)} सुझाव`,
                  en: topic === 'faq'
                    ? `${group.mine.length} question${group.mine.length === 1 ? '' : 's'}`
                    : `${group.mine.length} suggestion${group.mine.length === 1 ? '' : 's'}`,
                })}
              </span>
            </button>

            {open && (
              <div className="max-h-[210px] overflow-y-auto overscroll-contain
                px-4 pt-1 pb-4 flex flex-col gap-2">
                {group.mine.map((one) => {
                  return (
                    <div
                      key={one.id}
                      className="bg-white border-[0.612px] border-[#b3b3b3]
                        rounded-[12px] p-4"
                    >
                      <div className="flex gap-3 items-start justify-between">
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
                        {topic === 'faq' && (
                          <div className="flex flex-none items-center gap-1.5">
                            <span
                              aria-label={`${num(one.upvote_count)} upvotes`}
                              className="rounded-[8px] bg-[#194D97] px-2 py-1
                                flex items-center gap-1 text-[12px] font-medium
                                leading-4 text-white"
                            >
                              <span aria-hidden>▲</span>
                              {num(one.upvote_count)}
                            </span>
                            <span
                              aria-label={`${num(one.downvote_count)} downvotes`}
                              className="rounded-[8px] bg-[#f3f4f6] px-2 py-1
                                flex items-center gap-1 text-[12px] font-medium
                                leading-4 text-[#6a7282]"
                            >
                              <span aria-hidden>▼</span>
                              {num(one.downvote_count)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
  const [naming, setNaming] = useState(false);
  const [making, setMaking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const read = useCallback(() => {
    apiClient.getPhotos(eventRef).then(setPage).catch(() => setPage(null));
  }, [eventRef]);

  useEffect(() => { read(); setOpen(null); }, [read]);

  const make = async (name: string) => {
    setMaking(true);
    try {
      await apiClient.createPhotoFolder(eventRef, name);
      toast.success(t({ ne: 'फोल्डर बन्यो', en: 'Folder created' }));
      setNaming(false);
      read();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बनाउन सकिएन', en: 'Could not create it' })));
    } finally {
      setMaking(false);
    }
  };

  const addPhotos = async (files: File[]) => {
    if (!open || files.length === 0) return;
    setUploading(true);
    let added = 0;
    for (const file of files) {
      try {
        await apiClient.uploadPhoto(eventRef, open, file);
        added += 1;
      } catch (e: any) {
        toast.error(errorText(
          e,
          t({ ne: `${file.name} थप्न सकिएन`, en: `Could not add ${file.name}` })
        ));
      }
    }
    if (added > 0) {
      toast.success(t({
        ne: `${num(added)} तस्बिर थपियो`,
        en: `${added} photo${added === 1 ? '' : 's'} added`,
      }));
      read();
    }
    setUploading(false);
    if (photoInput.current) photoInput.current.value = '';
  };

  const folders = page?.folders ?? [];
  const inside = page?.photos.filter((p) => p.folder_id === open) ?? [];

  return (
    <div className="p-4">
      <div className="flex gap-2 items-stretch flex-wrap">
        {!open && page?.can_arrange && (
          <button
            type="button"
            disabled={making}
            onClick={() => setNaming(true)}
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

        {!open && folders.length === 0 ? (
          <p className="self-center text-[12.5px] text-[#99a1af]">
            {t({ ne: 'अझै कुनै फोल्डर छैन।', en: 'No folders yet.' })}
          </p>
        ) : !open ? (
          folders.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={open === one.id}
              onClick={() => setOpen(open === one.id ? null : one.id)}
              className={`w-[185px] flex-none h-[81px] bg-white border-[0.401px]
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
        ) : null}
      </div>

      {/* 641-19229 */}
      <FolderNameDialog
        open={naming}
        busy={making}
        onClose={() => setNaming(false)}
        onCreate={make}
      />

      {open && (
        <div className="mt-1 min-h-[240px] rounded-[10px] border border-[#e3e8ef] bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="text-[13px] font-medium text-[#194d97] hover:underline"
            >
              {t({ ne: '← पछाडि', en: '← Back' })}
            </button>
            <h3 className="min-w-0 flex-1 truncate text-center text-[14px]
              font-semibold text-[#101828]">
              {folders.find((folder) => folder.id === open)?.name}
            </h3>
            {page?.can_upload ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => photoInput.current?.click()}
                className="flex-none rounded-[8px] bg-navy-800 px-3 py-2
                  text-[12px] font-medium text-white hover:bg-navy-700
                  disabled:opacity-50"
              >
                {uploading
                  ? t({ ne: 'थपिँदै…', en: 'Adding…' })
                  : t({ ne: '+ तस्बिर थप्नुहोस्', en: '+ Add Photos' })}
              </button>
            ) : <span className="flex-none w-[58px]" />}
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => addPhotos(Array.from(event.target.files ?? []))}
          />
          {inside.length === 0 ? (
            <p className="py-12 text-center text-[12.5px] text-[#99a1af]">
              {t({ ne: 'यो फोल्डर खाली छ।', en: 'This folder is empty.' })}
            </p>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}
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
          )}
        </div>
      )}
    </div>
  );
};
