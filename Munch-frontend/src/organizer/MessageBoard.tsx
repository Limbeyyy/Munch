import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { BoardEntry, EventBoard } from '../types';
import { FigmaIcon } from '../assets/icons';
import { BoardVote } from './BoardVote';
import { Pair, useOrganizer } from './i18n';
import { Empty, Panel, Tabs } from './ui';
import { errorText } from './errors';

/**
 * The board, as the host reads it.
 *
 * Pressing the same arrow twice takes the vote back, and the count is
 * the server's answer rather than a guess made here, so two people
 * voting at once cannot drift.
 */
interface Props {
  /** Read as an account holder. */
  eventId?: string;
  /** Read as a guest, with the token they hold. */
  guestToken?: string;
  /** Poll, for a board somebody is watching during a event. */
  refreshMs?: number;
  /** The host may write the answers. Everyone else only reads them. */
  canAnswer?: boolean;
}

/**
 * The questions and suggestions the host has put up.
 *
 * The same board for everyone in the event - host, attendee and guest -
 * because a question worth answering is worth everybody seeing. Only the
 * asker is named; who a message was originally sent to is not shown.
 */
export const MessageBoard: React.FC<Props> = ({
  eventId, guestToken, refreshMs, canAnswer,
}) => {
  const { t, num } = useOrganizer();
  const [board, setBoard] = useState<EventBoard | null>(null);
  const [tab, setTab] = useState('faq');
  const [voting, setVoting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (guestToken) {
        setBoard(await apiClient.getGuestBoard(guestToken));
      } else if (eventId) {
        setBoard(await apiClient.getEventBoard(eventId));
      } else {
        setBoard(null);
      }
    } catch {
      setBoard({ faq: [], suggestions: [] });
    }
  }, [eventId, guestToken]);

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
  /** One vote each. The room decides what most wants answering. */
  const vote = async (entry: BoardEntry, value: 1 | -1) => {
    try {
      setVoting(entry.id);
      const updated = guestToken
        ? await apiClient.guestVoteOnBoard(guestToken, entry.id, value)
        : eventId
        ? await apiClient.voteOnBoard(eventId, entry.id, value)
        : null;
      if (updated) setBoard(updated);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भोट दिन सकिएन', en: 'Could not vote' })));
    } finally { setVoting(null); }
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
              className="flex flex-col gap-[7px] py-3 border-b border-navy-800/[.08]
                last:border-0"
            >
              {/* 479-664: the mark, the question, and the arrows under
                  it. The same card the room reads, so the host is
                  looking at what everybody else is. */}
              <div className="flex gap-3 items-start">
                <FigmaIcon name="asked" size={24} />
                <p className="flex-1 min-w-0 text-[14px] leading-5 text-[#24262b]">
                  {entry.body}
                </p>
              </div>

              <div className="ps-9">
                <BoardVote
                  entry={entry}
                  busy={voting === entry.id}
                  onVote={(v) => vote(entry, v)}
                />
              </div>

              <div className="min-w-0 flex-1 ps-9">
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

              </div>
            </div>
          ))
        )}
      </div>

    </Panel>
  );
};
