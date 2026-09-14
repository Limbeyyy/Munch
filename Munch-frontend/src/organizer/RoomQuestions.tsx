import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { BoardEntry, ChatMessage, MeetingBoard } from '../types';
import { FigmaIcon } from '../assets/icons';
import { errorText } from './errors';
import { useOrganizer } from './i18n';

type Tab = 'faq' | 'suggestions' | 'requests';

interface Props {
  /** Read as an account holder. */
  meetingId?: string;
  /** Read as a guest, with the token they hold. */
  guestToken?: string;
  /** Poll, since this is watched while a meeting runs. */
  refreshMs?: number;
  /**
   * Whether this pair of hands sorts what comes in. The host's, and their
   * co-hosts'; everybody else only reads the board and votes on it.
   */
  canSort?: boolean;
}

/**
 * The board, as the room sees it.
 *
 * A question, the room's sense of how much it wants answering, and a vote
 * either way. Nothing else: the asker's name, who they originally wrote
 * to, and what the host did with the other messages are not the reader's
 * business and are not here.
 *
 * The third tab is the host's, and it is the reason this exists. Every
 * message written in the room is written to somebody - the host or the
 * speaker - and somebody has to decide which of them are questions the
 * room should see, which are suggestions, and which are neither. That
 * could only be done from the moderation screen, which means leaving the
 * room in the middle of the meeting the queue belongs to. It is the same
 * decision, taken where it happens.
 */
export const RoomQuestions: React.FC<Props> = ({
  meetingId, guestToken, refreshMs, canSort,
}) => {
  const { t, num } = useOrganizer();
  const [board, setBoard] = useState<MeetingBoard | null>(null);
  const [waiting, setWaiting] = useState<ChatMessage[]>([]);
  const [tab, setTab] = useState<Tab>('faq');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (guestToken) setBoard(await apiClient.getGuestBoard(guestToken));
      else if (meetingId) setBoard(await apiClient.getMeetingBoard(meetingId));
      else setBoard(null);
    } catch {
      setBoard({ faq: [], suggestions: [] });
    }

    if (!canSort || !meetingId) { setWaiting([]); return; }
    try {
      setWaiting(await apiClient.getPendingMessages(meetingId));
    } catch {
      // The queue is the host's own view; a dropped refresh is not worth
      // interrupting a meeting for.
    }
  }, [meetingId, guestToken, canSort]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  /** One vote each. The room decides what most wants answering. */
  const vote = async (entry: BoardEntry, value: 1 | -1) => {
    try {
      setBusy(entry.id);
      const updated = guestToken
        ? await apiClient.guestVoteOnBoard(guestToken, entry.id, value)
        : meetingId
        ? await apiClient.voteOnBoard(meetingId, entry.id, value)
        : null;
      if (updated) setBoard(updated);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भोट दिन सकिएन', en: 'Could not vote' })));
    } finally { setBusy(null); }
  };

  /**
   * What the host does with something written to them.
   *
   * Putting it up as a question or as a suggestion lets it through and
   * files it in one movement, which is the same thing the moderation
   * screen does in two. Declining keeps it between the two of them.
   */
  const sort = async (
    message: ChatMessage,
    decision: 'approve' | 'decline',
    topic?: 'faq' | 'suggestion'
  ) => {
    if (!meetingId) return;
    try {
      setBusy(message.id);
      await apiClient.moderateMessage(meetingId, message.id, decision, topic);
      setWaiting((queue) => queue.filter((m) => m.id !== message.id));
      toast.success(
        topic === 'faq'
          ? t({ ne: 'प्रश्नमा राखियो', en: 'Up as a question' })
          : topic === 'suggestion'
          ? t({ ne: 'सुझावमा राखियो', en: 'Up as a suggestion' })
          : t({ ne: 'अस्वीकृत', en: 'Declined' })
      );
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'गर्न सकिएन', en: 'That did not work' })));
    } finally { setBusy(null); }
  };

  const rows: BoardEntry[] =
    (tab === 'faq' ? board?.faq : tab === 'suggestions' ? board?.suggestions : []) ?? [];

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'faq', label: t({ ne: 'प्रश्न', en: 'Questions' }), count: board?.faq.length ?? 0 },
    {
      id: 'suggestions',
      label: t({ ne: 'सुझाव', en: 'Suggestions' }),
      count: board?.suggestions.length ?? 0,
    },
    ...(canSort
      ? [{
          id: 'requests' as Tab,
          label: t({ ne: 'अनुरोध', en: 'Requests' }),
          count: waiting.length,
        }]
      : []),
  ];

  /** One question, with the room's vote on it. */
  const entryRow = (entry: BoardEntry) => (
    <li key={entry.id} className="flex flex-col gap-[7px] px-2 py-1">
      <div className="flex gap-3 items-start">
        <FigmaIcon name="asked" size={24} />
        <p className="flex-1 min-w-0 text-[14px] leading-5 text-[#24262b]">
          {entry.body}
        </p>
      </div>

      <div className="flex gap-[19px] items-center justify-center px-9">
        <button
          onClick={() => vote(entry, 1)}
          disabled={busy === entry.id}
          aria-label={t({ ne: 'माथि भोट', en: 'Vote up' })}
          aria-pressed={entry.my_vote === 1}
          className="flex gap-1 items-center disabled:opacity-50"
        >
          <FigmaIcon name={entry.my_vote === 1 ? 'voteUpCast' : 'voteUp'} size={24} />
          {entry.score > 0 && (
            <span className={`text-[14px] font-medium leading-5 tabular-nums ${
              entry.my_vote === 1 ? 'text-[#1a478b]' : 'text-[#656565]'
            }`}>
              {num(entry.score)}
            </span>
          )}
        </button>

        <span className="text-[14px] text-[#383838] leading-5">
          {t({ ne: 'भोट', en: 'Vote' })}
        </span>

        <button
          onClick={() => vote(entry, -1)}
          disabled={busy === entry.id}
          aria-label={t({ ne: 'तल भोट', en: 'Vote down' })}
          aria-pressed={entry.my_vote === -1}
          className="flex gap-1 items-center disabled:opacity-50"
        >
          <FigmaIcon name="voteDown" size={24} />
          {entry.score < 0 && (
            <span className="text-[14px] font-medium leading-5 tabular-nums text-[#656565]">
              {num(Math.abs(entry.score))}
            </span>
          )}
        </button>
      </div>

      {entry.answer && (
        <p className="ms-9 text-[13px] leading-5 text-[#1B7F58] bg-[#1B7F58]/[.07]
          rounded-[8px] px-2.5 py-1.5">
          {entry.answer}
        </p>
      )}
    </li>
  );

  /** One thing written to the host, waiting to be sorted. */
  const requestRow = (message: ChatMessage) => (
    <li key={message.id} className="flex flex-col gap-2 px-2 py-2 border-b border-[#e3e8ef]
      last:border-0">
      <p className="text-[14px] leading-5 text-[#24262b]">{message.body}</p>
      <p className="text-[12px] text-[#656565]">
        {message.sender_name}
        {message.sender_is_guest && ` · ${t({ ne: 'पाहुना', en: 'guest' })}`}
        {message.recipient_name && ` · ${t({ ne: 'लाई', en: 'to' })} ${message.recipient_name}`}
      </p>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => sort(message, 'approve', 'faq')}
          disabled={busy === message.id}
          className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-3 py-1.5
            text-[13px] font-medium disabled:opacity-50"
        >
          {t({ ne: 'प्रश्न', en: 'Question' })}
        </button>
        <button
          onClick={() => sort(message, 'approve', 'suggestion')}
          disabled={busy === message.id}
          className="border border-navy-800/25 hover:bg-cream rounded-[8px] px-3 py-1.5
            text-[13px] font-medium disabled:opacity-50"
        >
          {t({ ne: 'सुझाव', en: 'Suggestion' })}
        </button>
        <button
          onClick={() => sort(message, 'decline')}
          disabled={busy === message.id}
          className="ms-auto border border-live/40 text-live hover:bg-live/[.06]
            rounded-[8px] px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
        >
          {t({ ne: 'अस्वीकार', en: 'Decline' })}
        </button>
      </div>
    </li>
  );

  const nothingYet =
    tab === 'requests'
      ? t({
          ne: 'पर्खिरहेको केही छैन। कसैले सिधा लेखेपछि यहाँ आउँछ।',
          en: 'Nothing waiting. What people write to you or the speaker arrives here.',
        })
      : tab === 'faq'
      ? t({
          ne: 'अझै कुनै प्रश्न राखिएको छैन।',
          en: 'No questions up yet.',
        })
      : t({
          ne: 'अझै कुनै सुझाव राखिएको छैन।',
          en: 'No suggestions up yet.',
        });

  return (
    <div className="flex flex-col">
      <div className="flex border-b border-[#e3e8ef]" role="tablist">
        {tabs.map((one) => (
          <button
            key={one.id}
            role="tab"
            aria-selected={tab === one.id}
            onClick={() => setTab(one.id)}
            className={`flex-1 py-2 text-[13px] font-medium transition ${
              tab === one.id
                ? 'text-black border-b-2 border-black'
                : 'text-[#49454f] hover:text-black'
            }`}
          >
            {one.label} ({num(one.count)})
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-[13px] px-2 py-3 max-h-[441px] overflow-y-auto">
        {tab === 'requests'
          ? waiting.length === 0
            ? <li className="text-[13px] text-[#656565] px-2">{nothingYet}</li>
            : waiting.map(requestRow)
          : rows.length === 0
            ? <li className="text-[13px] text-[#656565] px-2">{nothingYet}</li>
            : rows.map(entryRow)}
      </ul>
    </div>
  );
};
