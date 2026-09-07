import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { BoardEntry, MeetingBoard } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel, Tabs } from './ui';
import { Modal } from './OrganizerShell';
import { errorText } from './errors';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  /** Read as an account holder. */
  meetingId?: string;
  /** Read as a guest, with the token they hold. */
  guestToken?: string;
  /** Poll, for a board somebody is watching during a meeting. */
  refreshMs?: number;
  /** The host may write the answers. Everyone else only reads them. */
  canAnswer?: boolean;
}

/**
 * The questions and suggestions the host has put up.
 *
 * The same board for everyone in the meeting - host, attendee and guest -
 * because a question worth answering is worth everybody seeing. Only the
 * asker is named; who a message was originally sent to is not shown.
 */
export const MessageBoard: React.FC<Props> = ({
  meetingId, guestToken, refreshMs, canAnswer,
}) => {
  const { t, num } = useOrganizer();
  const [board, setBoard] = useState<MeetingBoard | null>(null);
  const [tab, setTab] = useState('faq');
  const [answering, setAnswering] = useState<BoardEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      if (guestToken) {
        setBoard(await apiClient.getGuestBoard(guestToken));
      } else if (meetingId) {
        setBoard(await apiClient.getMeetingBoard(meetingId));
      } else {
        setBoard(null);
      }
    } catch {
      setBoard({ faq: [], suggestions: [] });
    }
  }, [meetingId, guestToken]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  /**
   * Write the answer, or clear it.
   *
   * Whenever it suits: from the front of the room while the question is
   * live, or days later once somebody has actually found out.
   */
  const saveAnswer = async () => {
    if (!answering || !meetingId) return;
    try {
      setSaving(true);
      await apiClient.answerBoardMessage(meetingId, answering.id, draft.trim());
      toast.success(
        draft.trim()
          ? t({ ne: 'जवाफ राखियो', en: 'Answer posted' })
          : t({ ne: 'जवाफ हटाइयो', en: 'Answer removed' })
      );
      setAnswering(null);
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'राख्न सकिएन', en: 'Could not post it' })));
    } finally { setSaving(false); }
  };

  const shown: BoardEntry[] = (tab === 'faq' ? board?.faq : board?.suggestions) ?? [];

  const empty: Pair = tab === 'faq'
    ? {
        ne: 'अझै कुनै प्रश्न राखिएको छैन। आयोजकले छानेका प्रश्न यहाँ देखिन्छन्।',
        en: 'No questions up yet. The ones the host picks out appear here.',
      }
    : {
        ne: 'अझै कुनै सुझाव राखिएको छैन।',
        en: 'No suggestions up yet.',
      };

  return (
    <Panel
      title={t({ ne: 'प्रश्न र सुझाव', en: 'Questions and suggestions' })}
      aside={
        <span className="text-[12.5px] text-[#6E7C8E]">
          {t({
            ne: 'आयोजकले छानेर राखेका सन्देश — सबैले पढ्न सक्छन्।',
            en: 'What the host has put up, for everybody to read.',
          })}
        </span>
      }
    >
      <div className="px-4 pb-1">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            {
              id: 'faq',
              label: {
                ne: `प्रश्न (${num(board?.faq.length ?? 0)})`,
                en: `Questions (${board?.faq.length ?? 0})`,
              },
            },
            {
              id: 'suggestions',
              label: {
                ne: `सुझाव (${num(board?.suggestions.length ?? 0)})`,
                en: `Suggestions (${board?.suggestions.length ?? 0})`,
              },
            },
          ]}
        />

        {!board ? (
          <Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{t(empty)}</Empty>
        ) : (
          shown.map((entry) => (
            <div
              key={entry.id}
              className="py-3 border-b border-navy-800/[.08] last:border-0"
            >
              <p className="text-[13.5px] text-ink font-read">{entry.body}</p>
              <p className="text-[12px] text-[#6E7C8E] mt-1 flex items-center gap-1.5 flex-wrap">
                <span>{entry.asked_by}</span>
                {entry.asker_is_guest && <Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip>}
                <span className="tabular-nums">· {clock(entry.created_at)}</span>
                {entry.was_direct && (
                  <Chip tone="draft">
                    {entry.sent_to
                      ? t({ ne: `सिधा — ${entry.sent_to} लाई`, en: `direct — to ${entry.sent_to}` })
                      : t({ ne: 'सिधा सन्देशबाट', en: 'from a direct message' })}
                  </Chip>
                )}
              </p>

              {entry.answer ? (
                <div className="mt-2 bg-cream rounded-lg px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-navy-900">
                    {t({ ne: 'जवाफ', en: 'Answer' })}
                  </p>
                  <p className="text-[13px] font-read text-ink-2 mt-0.5">
                    {entry.answer}
                    {entry.answered_by && (
                      <span className="text-[#6E7C8E]"> — {entry.answered_by}</span>
                    )}
                  </p>
                </div>
              ) : null}

              {canAnswer && (
                <div className="mt-2">
                  <Btn
                    sm
                    tone={entry.answer ? 'plain' : 'solid'}
                    onClick={() => { setAnswering(entry); setDraft(entry.answer); }}
                  >
                    {entry.answer
                      ? t({ ne: 'जवाफ सम्पादन', en: 'Edit the answer' })
                      : t({ ne: 'जवाफ दिनुहोस्', en: 'Answer' })}
                  </Btn>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {answering && (
        <Modal
          open
          onClose={() => setAnswering(null)}
          title={t({ ne: 'जवाफ', en: 'Answer' })}
          lede={answering.body}
          footer={
            <>
              <Btn onClick={() => setAnswering(null)}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
              <Btn tone="solid" disabled={saving} onClick={saveAnswer}>
                {t({ ne: 'राख्नुहोस्', en: 'Post it' })}
              </Btn>
            </>
          }
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder={t({
              ne: 'जवाफ — सबैले पढ्न सक्छन्।',
              en: 'Your answer. Everyone in the meeting reads it.',
            })}
            className="w-full border border-navy-800/15 rounded-lg px-3 py-2 text-[14px] font-read leading-relaxed"
          />
          <p className="mt-2 text-[12px] text-[#6E7C8E]">
            {t({
              ne: 'खाली छोडे जवाफ हट्छ।',
              en: 'Leaving it empty takes the answer back off.',
            })}
          </p>
        </Modal>
      )}
    </Panel>
  );
};
