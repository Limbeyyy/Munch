import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * What the room's own socket has heard arrive since the last read.
   *
   * The queue is fetched on a timer, which is fine for a list that
   * changes every few minutes and wrong for one somebody is watching
   * while a talk runs: a question asked at the front should be sortable
   * now, not in twenty seconds. The socket already tells the room; this
   * is the room passing it on.
   */
  waiting?: ChatMessage[];
  /**
   * Something new has appeared on the board.
   *
   * The board grows when the host puts a question up, and nothing on the
   * socket says so - this panel finds out by reading it. Whoever is
   * showing the panel wants to know too, so that a control nobody has
   * open can say how much has arrived behind it.
   */
  onNews?: (many: number) => void;
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
  meetingId, guestToken, refreshMs, canSort, waiting: alsoWaiting, onNews,
}) => {
  const { t, num } = useOrganizer();
  const [board, setBoard] = useState<MeetingBoard | null>(null);
  const [fetched, setFetched] = useState<ChatMessage[]>([]);
  /** What has been dealt with here, so a poll cannot bring it back. */
  const [settled, setSettled] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('faq');
  const [busy, setBusy] = useState<string | null>(null);

  /** How much was on the board when it was last read. */
  const wasOnBoard = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      let read: MeetingBoard | null = null;
      if (guestToken) read = await apiClient.getGuestBoard(guestToken);
      else if (meetingId) read = await apiClient.getMeetingBoard(meetingId);
      setBoard(read);

      const now = read ? read.faq.length + read.suggestions.length : 0;
      const before = wasOnBoard.current;
      wasOnBoard.current = now;
      // The first read is what is already there, not news.
      if (before !== null && now > before) onNews?.(now - before);
    } catch {
      setBoard({ faq: [], suggestions: [] });
    }

    if (!canSort || !meetingId) { setFetched([]); return; }
    try {
      /*
       * Two kinds of thing are waiting to be given a place.
       *
       * What is held for review, and what has already reached the person
       * it was written to but has never been filed - a message let
       * through with no topic is on nobody's board and in nobody's queue.
       * That is where a question put to the host used to disappear to,
       * and it is still where anything approved from the chat panel
       * lands. Both are unanswered questions, so both are here.
       */
      const [held, seen] = await Promise.all([
        apiClient.getPendingMessages(meetingId),
        apiClient.getReviewedMessages(meetingId),
      ]);
      const unfiled = [...seen.from_users, ...seen.from_guests].filter(
        (m) => !m.topic || m.topic === 'none'
      );
      setFetched([...held, ...unfiled]);
    } catch {
      // The queue is the host's own view; a dropped refresh is not worth
      // interrupting a meeting for.
    }
  }, [meetingId, guestToken, canSort, onNews]);

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
      // One that has already been let through is not approved again; it
      // is simply given the place it never got.
      if (message.moderation_status !== 'pending' && topic) {
        await apiClient.sortMessage(meetingId, message.id, topic);
      } else {
        await apiClient.moderateMessage(meetingId, message.id, decision, topic);
      }
      setSettled((done) => [...done, message.id]);
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

  /*
   * The queue: what the last read found, plus whatever has arrived over
   * the socket since, minus anything already dealt with here.
   */
  const waiting: ChatMessage[] = [];
  const seen = new Set<string>();
  [...fetched, ...(alsoWaiting ?? [])].forEach((m) => {
    if (settled.includes(m.id) || seen.has(m.id)) return;
    seen.add(m.id);
    waiting.push(m);
  });

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

  /** One thing written to the front of the room, waiting for a place. */
  const requestRow = (message: ChatMessage) => (
    <li
      key={message.id}
      className="flex flex-col gap-2 px-2 py-2.5 border-b border-[#e3e8ef] last:border-0"
    >
      <div className="flex gap-3 items-start">
        <FigmaIcon name="asked" size={24} />
        <p className="flex-1 min-w-0 text-[14px] leading-5 text-[#24262b]">
          {message.body}
        </p>
      </div>

      {/* The decision, under what was written: which board it belongs on. */}
      <div className="flex gap-2 ps-9">
        <button
          onClick={() => sort(message, 'approve', 'faq')}
          disabled={busy === message.id}
          className="flex-1 bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
            px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
        >
          {t({ ne: 'प्रश्नमा', en: 'To questions' })}
        </button>
        <button
          onClick={() => sort(message, 'approve', 'suggestion')}
          disabled={busy === message.id}
          className="flex-1 border border-navy-800/25 hover:bg-cream rounded-[8px]
            px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
        >
          {t({ ne: 'सुझावमा', en: 'To suggestions' })}
        </button>
      </div>

      <div className="flex items-center gap-2 ps-9">
        <p className="flex-1 min-w-0 text-[12px] text-[#656565] truncate">
          {message.sender_name}
          {message.sender_is_guest && ` · ${t({ ne: 'पाहुना', en: 'guest' })}`}
          {message.recipient_name &&
            ` · ${t({ ne: 'लाई', en: 'to' })} ${message.recipient_name}`}
        </p>
        {message.moderation_status === 'pending' && (
          <button
            onClick={() => sort(message, 'decline')}
            disabled={busy === message.id}
            className="flex-none text-[12px] text-live hover:underline disabled:opacity-50"
          >
            {t({ ne: 'अस्वीकार', en: 'Decline' })}
          </button>
        )}
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
