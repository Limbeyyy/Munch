import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ConclusionAction, Meeting, Session, SessionSummary } from '../types';
import { errorText } from './errors';
import { useOrganizer } from './i18n';
import { Modal } from './OrganizerShell';
import { Btn, Chip, Empty } from './ui';

/**
 * The summaries a meeting produced, and whether they may go out.
 *
 * A summary is what people quote afterwards, so none of it reaches an
 * attendee until the host has read it and said so. Unwritten ones open on
 * a draft of the transcript, which is where the writing usually starts.
 */
export const SummaryApprovals: React.FC<{ meeting: Meeting }> = ({ meeting }) => {
  const { t } = useOrganizer();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [editing, setEditing] = useState<Session | null>(null);
  const [draft, setDraft] = useState('');
  /** The actions coming out of this session: who does what, by when. */
  const [actions, setActions] = useState<ConclusionAction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let own: Session[] = [];
    try {
      own = await apiClient.listSessions(meeting.id);
    } catch {
      own = [];
    }
    setSessions(own);

    const results = await Promise.allSettled(
      own.map((s) => apiClient.getSessionSummary(s.id).then((r) => [s.id, r] as const))
    );
    const next: Record<string, SessionSummary> = {};
    results.forEach((r) => { if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]; });
    setSummaries(next);
    setLoading(false);
  }, [meeting.id]);

  useEffect(() => { load(); }, [load]);

  const open = (session: Session) => {
    setDraft(summaries[session.id]?.body ?? '');
    setActions(summaries[session.id]?.actions ?? []);
    setEditing(session);
  };

  const save = async (andPublish: boolean) => {
    if (!editing) return;
    try {
      setBusy(editing.id);
      await apiClient.saveSessionSummary(
        editing.id,
        draft,
        // Rows with nothing to do are dropped rather than saved empty.
        actions.filter((a) => a.task.trim())
      );
      if (andPublish) await apiClient.publishSessionSummary(editing.id);
      toast.success(
        andPublish
          ? t({ ne: 'सारांश प्रकाशित भयो', en: 'Summary published' })
          : t({ ne: 'सेभ भयो', en: 'Saved' })
      );
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सेभ गर्न सकिएन', en: 'Could not save it' })));
    } finally { setBusy(null); }
  };

  const publish = async (session: Session) => {
    try {
      setBusy(session.id);
      await apiClient.publishSessionSummary(session.id);
      toast.success(t({ ne: 'सारांश प्रकाशित भयो', en: 'Summary published' }));
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'प्रकाशित गर्न सकिएन', en: 'Could not publish it' })));
    } finally { setBusy(null); }
  };

  if (loading) return <Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty>;
  if (sessions.length === 0) {
    return <Empty>{t({ ne: 'यो बैठकमा सत्र छैन।', en: 'This meeting has no sessions.' })}</Empty>;
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {sessions.map((session) => {
          const summary = summaries[session.id];
          const written = !!summary?.body.trim();
          const published = !!summary?.is_published;

          return (
            <div key={session.id} className="border border-navy-800/15 rounded-xl overflow-hidden">
              <div className="bg-[#FBFAF6] px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap">
                <b className="text-[14px]">{session.title}</b>
                {published ? (
                  <Chip tone="ok">{t({ ne: 'प्रकाशित', en: 'Published' })}</Chip>
                ) : written ? (
                  <Chip tone="warn">{t({ ne: 'स्वीकृति चाहिन्छ', en: 'Needs approval' })}</Chip>
                ) : (
                  <Chip tone="draft">{t({ ne: 'लेखिएको छैन', en: 'Not written' })}</Chip>
                )}
                <span className="ml-auto flex items-center gap-1.5 flex-none">
                  <Btn sm onClick={() => open(session)}>
                    {t({ ne: 'पढ्ने र सम्पादन', en: 'Read and edit' })}
                  </Btn>
                  {written && !published && (
                    <Btn sm tone="amber" disabled={busy === session.id}
                         onClick={() => publish(session)}>
                      {t({ ne: 'प्रकाशित गर्ने', en: 'Publish' })}
                    </Btn>
                  )}
                </span>
              </div>

              <div className="px-3.5 py-3">
                {written ? (
                  <p className="font-read text-[14px] leading-[1.8] text-ink-2 whitespace-pre-line max-w-[70ch]">
                    {summary!.body}
                  </p>
                ) : (
                  <p className="text-[12.5px] text-[#6E7C8E]">
                    {t({
                      ne: 'सारांश लेखिएको छैन। ट्रान्सक्रिप्टबाट सुरु गर्न “पढ्ने र सम्पादन” थिच्नुहोस्।',
                      en: 'Nothing written yet. Read and edit opens a draft of the transcript.',
                    })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.title}
          lede={t({
            ne: 'सारांश — प्रकाशित नगरेसम्म सहभागीले देख्दैनन्।',
            en: 'The summary. Nobody reads it until you publish it.',
          })}
          footer={
            <>
              <Btn onClick={() => setEditing(null)}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
              <Btn tone="solid" disabled={busy === editing.id} onClick={() => save(false)}>
                {t({ ne: 'सेभ', en: 'Save' })}
              </Btn>
              <Btn tone="amber" disabled={busy === editing.id || !draft.trim()}
                   onClick={() => save(true)}>
                {t({ ne: 'सेभ र प्रकाशित', en: 'Save and publish' })}
              </Btn>
            </>
          }
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={t({
              ne: 'के निर्णय भयो, कुन अंक महत्त्वपूर्ण छ…',
              en: 'What was decided, and the numbers that matter…',
            })}
            className="w-full border border-navy-800/15 rounded-lg px-3 py-2 text-[14px] font-read leading-[1.8]"
          />
          {/* The actions are held apart from the prose because each line
              needs a name and a date against it. A decision with nobody's
              name on it is a note, and the attendee's own list is built
              from these. */}
          <div className="mt-4 pt-3.5 border-t border-navy-800/[.08]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[13px] font-medium">
                {t({ ne: 'कार्यसूची', en: 'Actions' })}
              </p>
              <Btn
                sm
                onClick={() =>
                  setActions((rows) => [...rows, { task: '', owner: '', due: '' }])
                }
              >
                {t({ ne: '+ पङ्क्ति', en: '+ Row' })}
              </Btn>
            </div>

            {actions.length === 0 ? (
              <p className="text-[12.5px] text-[#6E7C8E]">
                {t({
                  ne: 'कसैले कुनै काम गर्नुपर्ने भए यहाँ लेख्नुहोस् — कसले, कहिलेसम्म।',
                  en: 'If somebody has to go and do something, put it here: who, and by when.',
                })}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {actions.map((row, i) => (
                  <div key={i} className="flex gap-2 items-start flex-wrap">
                    <input
                      value={row.task}
                      onChange={(e) =>
                        setActions((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, task: e.target.value } : r))
                        )
                      }
                      placeholder={t({ ne: 'के गर्नुपर्ने', en: 'What has to happen' })}
                      aria-label={t({ ne: 'काम', en: 'Task' })}
                      className="flex-1 min-w-[200px] border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13px]"
                    />
                    <input
                      value={row.owner}
                      onChange={(e) =>
                        setActions((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, owner: e.target.value } : r))
                        )
                      }
                      placeholder={t({ ne: 'कसले', en: 'Who' })}
                      aria-label={t({ ne: 'कसले', en: 'Who' })}
                      className="w-[140px] border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13px]"
                    />
                    <input
                      value={row.due}
                      onChange={(e) =>
                        setActions((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, due: e.target.value } : r))
                        )
                      }
                      placeholder={t({ ne: 'कहिलेसम्म', en: 'By when' })}
                      aria-label={t({ ne: 'कहिलेसम्म', en: 'By when' })}
                      className="w-[130px] border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() => setActions((rows) => rows.filter((_, j) => j !== i))}
                      aria-label={t({ ne: 'पङ्क्ति हटाउने', en: 'Remove row' })}
                      className="w-8 h-8 rounded-md text-[#6E7C8E] hover:text-live hover:bg-live/[.08]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summaries[editing.id]?.is_published && (
            <p className="mt-2 text-[12px] text-[#6E7C8E]">
              {t({
                ne: 'यो प्रकाशित सारांश हो। सम्पादन गरे फेरि स्वीकृति चाहिन्छ।',
                en: 'This one is published. Editing it sends it back for approval.',
              })}
            </p>
          )}
        </Modal>
      )}
    </>
  );
};
