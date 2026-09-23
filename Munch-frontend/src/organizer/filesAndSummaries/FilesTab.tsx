import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Artifact, Event, Session } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Modal } from '../OrganizerShell';
import {
  FilledButton, KindChip, NothingYet, QuietButton, SearchInput, Slab,
  clockOf, dayOf, formatSize, kindOf,
} from './shared';

/** The agendas a file may be filed against, and the loose pile. */
const LOOSE = '';

/**
 * What was shared, under the talk it was shared during.
 *
 * Files belong to an agenda the way a handout belongs to the talk it was
 * given out at. Anything shared when nothing was on stage is loose on the
 * event, and gets a group of its own at the foot rather than being hidden.
 */
export const FilesTab: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  /** The dialog, and which agenda it opened against. */
  const [adding, setAdding] = useState<string | null>(null);
  const [target, setTarget] = useState(LOOSE);
  const [chosen, setChosen] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [own, shared] = await Promise.all([
      apiClient.listSessions(event.id).catch(() => [] as Session[]),
      apiClient.getResources(event.id).catch(() => [] as Artifact[]),
    ]);
    setSessions(own);
    setFiles(shared);
    setLoading(false);
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const matching = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    if (!wanted) return files;
    return files.filter((one) =>
      (one.display_name ?? '').toLowerCase().includes(wanted)
    );
  }, [files, search]);

  /**
   * The groups, in the running order's order.
   *
   * An agenda with nothing under it still appears: its header is where
   * the button to add the first file lives, and a talk you cannot add a
   * handout to until somebody else has is not a useful list.
   */
  const groups = useMemo(() => {
    const byAgenda = sessions.map((session) => ({
      id: session.id,
      title: session.title,
      when: clockOf(session.starts_at),
      rows: matching.filter((one) => one.session === session.id),
    }));
    const loose = matching.filter((one) => !one.session);
    return loose.length > 0
      ? [...byAgenda, {
          id: LOOSE,
          title: t({ ne: 'कुनै कार्यसूचीबिना', en: 'Not filed against an agenda' }),
          when: '',
          rows: loose,
        }]
      : byAgenda;
  }, [sessions, matching, t]);

  const openAdd = (agendaId: string) => {
    setTarget(agendaId);
    setChosen([]);
    setAdding(agendaId);
  };

  const upload = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const file of chosen) {
      try {
        await apiClient.uploadResource(
          event.id, file, undefined, target === LOOSE ? undefined : target
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
    setAdding(null);
    setBusy(false);
    await load();
  };

  const remove = async (one: Artifact) => {
    setBusy(true);
    try {
      await apiClient.deleteResource(event.id, one.id);
      toast.success(t({ ne: 'फाइल हटाइयो', en: 'File removed' }));
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' })));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <NothingYet title={t({ ne: 'ल्याउँदै…', en: 'Loading…' })} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 items-center justify-between flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          label={t({ ne: 'फाइल खोज्नुहोस्', en: 'Search Files' })}
        />
        <FilledButton onClick={() => openAdd(sessions[0]?.id ?? LOOSE)}>
          <span aria-hidden>+</span>
          {t({ ne: 'फाइल थप्नुहोस्', en: 'Add File' })}
        </FilledButton>
      </div>

      {groups.length === 0 ? (
        <NothingYet
          title={t({ ne: 'कुनै फाइल छैन', en: 'No files yet' })}
          lede={t({
            ne: 'सत्रमा बाँडिएका कागजात यहाँ देखिनेछन्।',
            en: 'Anything shared during the event will appear here.',
          })}
        />
      ) : (
        groups.map((group) => (
          <Slab key={group.id || 'loose'}>
            <div className="border-b-[0.6px] border-[#f3f4f6] px-5 py-4
              flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-head leading-5 truncate">
                  {group.title}
                </p>
                <p className="pt-0.5 text-[12px] text-faint leading-4">
                  {[
                    group.when,
                    t({
                      ne: `${num(group.rows.length)} फाइल`,
                      en: group.rows.length === 1
                        ? '1 file' : `${group.rows.length} files`,
                    }),
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <QuietButton
                tone="navy"
                disabled={busy}
                onClick={() => openAdd(group.id)}
              >
                {t({ ne: '+ थप्नुहोस्', en: '+ Add' })}
              </QuietButton>
            </div>

            {group.rows.length === 0 ? (
              <p className="px-5 py-4 text-[12px] text-faint">
                {t({
                  ne: 'यो कार्यसूचीमा कुनै फाइल छैन।',
                  en: 'Nothing on this agenda yet.',
                })}
              </p>
            ) : (
              <div className="flex flex-col">
                {group.rows.map((one, i) => (
                  <div
                    key={one.id}
                    className={`px-5 py-3 flex gap-4 items-center ${
                      i < group.rows.length - 1
                        ? 'border-b-[0.6px] border-[#f9fafb]' : ''
                    }`}
                  >
                    <KindChip kind={kindOf(one.display_name ?? '')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-head leading-5
                        truncate">
                        {one.display_name}
                      </p>
                      <p className="text-[12px] text-faint leading-4 truncate">
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
                      onClick={() => remove(one)}
                      aria-label={t({
                        ne: `${one.display_name} हटाउनुहोस्`,
                        en: `Remove ${one.display_name}`,
                      })}
                      className="size-11 grid place-items-center rounded-[12px]
                        text-[#d81313] hover:bg-[#d81313]/[.06]
                        disabled:opacity-50"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        aria-hidden="true">
                        <path
                          d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"
                          stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Slab>
        ))
      )}

      {/* 641-18755 */}
      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={t({ ne: 'फाइल थप्नुहोस्', en: 'Add file' })}
        divided
        footer={
          <>
            <QuietButton
              className="!text-[14px] !px-4 !py-2"
              disabled={busy}
              onClick={() => setAdding(null)}
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
        <label
          htmlFor="manch-file-agenda"
          className="block text-[12px] text-subtle leading-4 pb-1"
        >
          {t({ ne: 'कार्यसूची', en: 'Agenda' })}
        </label>
        <select
          id="manch-file-agenda"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full border border-line rounded-[8px] h-10 px-3
            text-[14px] text-head bg-white"
        >
          {sessions.map((one) => (
            <option key={one.id} value={one.id}>{one.title}</option>
          ))}
          <option value={LOOSE}>
            {t({ ne: 'कुनै कार्यसूचीबिना', en: 'Not filed against an agenda' })}
          </option>
        </select>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setChosen(Array.from(e.dataTransfer.files));
          }}
          className={`mt-4 border border-dashed rounded-[8px] py-8
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
            {t({ ne: 'फाइल यहाँ तान्नुहोस्', en: 'Drag & drop files here' })}
          </p>
          <p className="text-[12px] text-faint">
            {t({
              ne: 'PDF, PPTX, DOCX, XLSX, तस्बिर · बढीमा ५० MB',
              en: 'PDF, PPTX, DOCX, XLSX, images · Max 50 MB',
            })}
          </p>
          <input
            ref={picker}
            type="file"
            multiple
            aria-label={t({ ne: 'फाइल छान्नुहोस्', en: 'Choose files' })}
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
              {chosen.map((one) => one.name).join(', ')}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};
