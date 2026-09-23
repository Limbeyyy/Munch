import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { QUEUE_POLL_MS } from '../../services/polling';
import { ChatMessage, Event, ModerationQueue } from '../../types';
import { FigmaIcon } from '../../assets/icons';
import { Pair, useOrganizer } from '../i18n';
import { Card } from '../ui';
import { eventState } from '../sessionState';

interface Props { events: Event[]; }

/** Which pile of the queue is being read. */
type Pile = 'pending' | 'rejected' | 'approved';

/** Which board: the questions or the suggestions. */
type Board = 'faq' | 'suggestion';

/** The day, the hours and the room, as the header writes them. */
const whenAndWhere = (event: Event) => {
  const start = new Date(event.scheduled_start);
  const end = new Date(event.scheduled_end);
  const clock = (at: Date) =>
    at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return [
    start.toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    }),
    `${clock(start)} – ${clock(end)}`,
    event.venue,
  ].filter(Boolean).join(' · ');
};

/**
 * A name shortened the way a queue shortens it: first name, last initial.
 *
 * The board names nobody, but the queue is the host reading their own
 * room, and a question is easier to place against a person than against
 * an anonymous line.
 */
const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

/** How long ago, in the words a queue uses for it. */
const since = (iso: string, t: (pair: Pair) => string) => {
  const minutes = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  if (minutes < 1) return t({ ne: 'भर्खरै', en: 'just now' });
  if (minutes < 60) return t({ ne: `${minutes} मिनेट अघि`, en: `${minutes} min ago` });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t({ ne: `${hours} घण्टा अघि`, en: `${hours} h ago` });
  const days = Math.floor(hours / 24);
  return t({ ne: `${days} दिन अघि`, en: `${days} d ago` });
};

const PILE_LABEL: Record<Pile, Pair> = {
  pending: { ne: 'पर्खिरहेको', en: 'Pending' },
  rejected: { ne: 'अस्वीकृत', en: 'Rejected' },
  approved: { ne: 'स्वीकृत', en: 'Approved' },
};

/** What an empty pile says, which is different for each of the six. */
const NOTHING: Record<Pile, Record<Board, Pair>> = {
  pending: {
    faq: { ne: 'कुनै प्रश्न पर्खिरहेको छैन', en: 'No pending q&a' },
    suggestion: { ne: 'कुनै सुझाव पर्खिरहेको छैन', en: 'No pending suggestions' },
  },
  rejected: {
    faq: { ne: 'कुनै प्रश्न अस्वीकृत छैन', en: 'No rejected q&a' },
    suggestion: { ne: 'कुनै सुझाव अस्वीकृत छैन', en: 'No rejected suggestions' },
  },
  approved: {
    faq: { ne: 'कुनै प्रश्न स्वीकृत छैन', en: 'No approved q&a' },
    suggestion: { ne: 'कुनै सुझाव स्वीकृत छैन', en: 'No approved suggestions' },
  },
};

/**
 * The search box the two screens share.
 *
 * The glyph is drawn here rather than exported because it is the same
 * magnifier the attendance screen already draws inline; two copies of an
 * asset for one shape is how they drift apart.
 */
const SearchBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}> = ({ value, onChange, label, className = '' }) => (
  <div className={`bg-white border border-[#ececed] rounded-[8px] h-10 px-2.5
    flex gap-1 items-center shadow-[0px_1.5px_4px_-1px_rgba(10,9,11,0.07)]
    ${className}`}>
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="#7f7d83" strokeWidth="1.3" />
      <path d="M12.5 12.5 L16 16" stroke="#7f7d83" strokeWidth="1.3"
        strokeLinecap="round" />
    </svg>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="flex-1 min-w-0 bg-transparent text-[14px] text-head
        placeholder:text-[#7f7d83] outline-none"
    />
  </div>
);

/**
 * One thing somebody offered the board, and what the host may do with it.
 *
 * Pending carries the two decisions. Approved is tinted and says who put
 * it up; rejected is left plain. Neither of the two decided states
 * carries a button, because the decision has been made.
 */
const Entry: React.FC<{
  message: ChatMessage;
  pile: Pile;
  busy: boolean;
  onDecide: (decision: 'approve' | 'decline') => void;
}> = ({ message, pile, busy, onDecide }) => {
  const { t } = useOrganizer();

  // Something already decided is tinted the colour of the decision and
  // carries no border; only what is still waiting is a white card with
  // an edge, because only that is a thing to act on.
  const decided = pile !== 'pending';

  return (
    <article className={`rounded-[12px] p-4 ${
      pile === 'approved'
        ? 'bg-[#ebfbf1]'
        : pile === 'rejected'
        ? 'bg-[#feebeb]'
        : 'bg-white border-[0.6px] border-[#e3e3e3]'
    }`}>
      <div className="flex gap-3 items-start">
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-[14px] text-head leading-[22.75px]">
            “{message.body}”
          </p>
          <div className="pt-2 flex gap-3 items-center flex-wrap">
            <span className="text-[12px] font-medium text-subtle leading-4">
              {shortName(message.sender_name)}
            </span>
            <span className="text-[12px] text-faint leading-4">
              {since(message.created_at, t)}
            </span>
            {message.session_title && (
              // Dark against a tinted card, pale against a white one:
              // the pale chip disappears into the tint.
              <span className={`rounded-[4px] px-1.5 py-0.5 text-[11px]
                leading-[14.667px] ${
                decided ? 'bg-[#717171] text-white' : 'bg-[#f3f4f6] text-subtle'
              }`}>
                {message.session_title}
              </span>
            )}
          </div>
          {decided && message.moderated_by_name && (
            <p className="pt-1.5 text-[12px] text-faint leading-4">
              {t(pile === 'approved'
                ? {
                    ne: `${message.moderated_by_name} ले स्वीकृत गरे`,
                    en: `Approved by ${message.moderated_by_name}`,
                  }
                : {
                    ne: `${message.moderated_by_name} ले अस्वीकार गरे`,
                    en: `Rejected by ${message.moderated_by_name}`,
                  })}
              {message.moderated_at && ` · ${since(message.moderated_at, t)}`}
            </p>
          )}
        </div>

        {pile === 'pending' && (
          <div className="flex gap-1.5 items-center shrink-0">
            <button
              type="button"
              onClick={() => onDecide('decline')}
              disabled={busy}
              className="border-[0.6px] border-line rounded-[8px] px-2.5 py-1
                text-[12px] text-body leading-4 hover:border-navy-800
                disabled:opacity-50"
            >
              {t({ ne: 'अस्वीकार', en: 'Reject' })}
            </button>
            <button
              type="button"
              onClick={() => onDecide('approve')}
              disabled={busy}
              className="bg-navy-800 rounded-[8px] px-2.5 py-1 text-[12px]
                font-medium text-white leading-4 hover:bg-navy-900
                disabled:opacity-50"
            >
              {t({ ne: 'स्वीकृत', en: 'Approve' })}
            </button>
          </div>
        )}
      </div>
    </article>
  );
};

/**
 * What the host has been asked, event by event.
 *
 * Two screens. The first lists the events that are actually running,
 * because an event nobody is in has nothing arriving to moderate. The
 * second is one event's queue: the questions and the suggestions people
 * offered it, in three piles - waiting, turned down, put up - grouped
 * under the talk each was asked during.
 */
export const ModerationView: React.FC<Props> = ({ events }) => {
  const { t, num } = useOrganizer();

  /** Which event is open. Empty means the list of events. */
  const [opened, setOpened] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [agendaSearch, setAgendaSearch] = useState('');
  const [agenda, setAgenda] = useState('all');
  const [board, setBoard] = useState<Board>('faq');
  const [pile, setPile] = useState<Pile>('pending');
  const [deciding, setDeciding] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /** One queue per live event, so the cards can count what is in them. */
  const [queues, setQueues] = useState<Record<string, ModerationQueue>>({});
  /** How many were asked along and how many came, for the same cards. */
  const [turnout, setTurnout] = useState<Record<string, {
    invited: number; attended: number; rate: number;
  }>>({});

  // Only what is running. A queue fills while people are in the room, so
  // an event that has not opened has nothing in it and one that has
  // ended has nothing arriving: the decisions left on either are made
  // from the board, not from here.
  const live = useMemo(
    () => events.filter((one) => eventState(one) === 'live'),
    [events]
  );

  const read = useCallback(async () => {
    const wanted = opened ? live.filter((one) => one.id === opened) : live;
    const got = await Promise.all(
      wanted.map(async (one) => {
        try {
          return [one.id, await apiClient.getModerationQueue(one.id)] as const;
        } catch {
          return null;
        }
      })
    );
    setQueues((was) => {
      const next = { ...was };
      got.forEach((pair) => { if (pair) next[pair[0]] = pair[1]; });
      return next;
    });
  }, [live, opened]);

  /**
   * The turnout on each card.
   *
   * Read once when the list of live events changes rather than on the
   * queue's poll: how many were invited does not move while the event
   * runs, and polling it every few seconds would be a request per event
   * per tick for a number that does not change.
   */
  const countHeads = useCallback(async () => {
    const got = await Promise.all(live.map(async (one) => {
      try {
        const report = await apiClient.getAttendanceReport(one.id);
        const invited = report?.expected_total ?? 0;
        const attended = report?.attended_count ?? 0;
        return [one.id, {
          invited,
          attended,
          rate: invited > 0 ? Math.round((attended / invited) * 100) : 0,
        }] as const;
      } catch {
        return null;
      }
    }));
    setTurnout((was) => {
      const next = { ...was };
      got.forEach((pair) => { if (pair) next[pair[0]] = pair[1]; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.map((one) => one.id).join(',')]);

  useEffect(() => { countHeads(); }, [countHeads]);

  useEffect(() => {
    read();
    const id = setInterval(read, QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [read]);

  const event = live.find((one) => one.id === opened);
  const queue = opened ? queues[opened] : undefined;

  const shownEvents = live.filter((one) =>
    one.title.toLowerCase().includes(eventSearch.trim().toLowerCase())
  );

  /** The agendas of the open event, narrowed by what was typed. */
  const agendas = (queue?.sessions ?? []).filter((one) =>
    one.title.toLowerCase().includes(agendaSearch.trim().toLowerCase())
  );

  /** The entries of the chosen pile, on the chosen board, for this agenda. */
  const shownEntries = useMemo(() => {
    const rows = queue ? queue[pile] : [];
    return rows.filter((row) => {
      if ((row.topic ?? 'none') !== board) return false;
      if (agenda !== 'all' && (row.session ?? '') !== agenda) return false;
      return true;
    });
  }, [queue, pile, board, agenda]);

  const decide = async (message: ChatMessage, decision: 'approve' | 'decline') => {
    if (!opened) return;
    setDeciding(message.id);
    try {
      await apiClient.moderateMessage(opened, message.id, decision);
      await read();
    } catch {
      toast.error(t({ ne: 'निर्णय पुगेन', en: 'That decision did not go through' }));
    } finally {
      setDeciding('');
    }
  };

  const openEvent = (one: Event) => {
    setOpened(one.id);
    setAgenda('all');
    setAgendaSearch('');
    setPile('pending');
    setBoard('faq');
  };

  // -- the list of live events ------------------------------------------

  if (!opened || !event) {
    return (
      <Card className="flex flex-col gap-8">
        <div>
          <h1 className="text-[24px] font-medium text-head leading-[1.2]">
            {t({ ne: 'मडेरेसन', en: 'Moderation' })}
          </h1>
          <p className="pt-2 text-[14px] text-body leading-[1.5]">
            {t({
              ne: 'चलिरहेका कार्यक्रमका प्रश्न र सुझाव।',
              en: 'setup event for meetings',
            })}
          </p>
        </div>

        <SearchBox
          value={eventSearch}
          onChange={setEventSearch}
          label={t({ ne: 'खोज्नुहोस्', en: 'Search' })}
          className="w-full max-w-[381px] border-[#656565]"
        />

        {shownEvents.length === 0 ? (
          <p className="text-[14px] text-subtle">
            {t({
              ne: 'अहिले कुनै कार्यक्रम चलिरहेको छैन।',
              en: 'Nothing is running just now.',
            })}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {shownEvents.map((one) => {
              const its = queues[one.id];
              const questions = (its?.pending ?? []).filter(
                (row) => row.topic === 'faq'
              ).length;
              const suggestions = (its?.pending ?? []).filter(
                (row) => row.topic === 'suggestion'
              ).length;
              return (
                <article
                  key={one.id}
                  className="bg-sheet border-[0.6px] border-line rounded-[12px] p-5
                    w-full max-w-[807px] flex gap-4 items-start
                    shadow-[0px_1px_1px_rgba(0,0,0,0.3),0px_1px_1.5px_rgba(0,0,0,0.15)]"
                >
                  <div className="flex-1 min-w-0 flex flex-col">
                    <h3 className="pt-1 text-[15px] font-medium text-head
                      leading-[22.5px]">
                      {one.title}
                    </h3>
                    <p className="pt-1 text-[14px] text-subtle leading-5">
                      {whenAndWhere(one)}
                    </p>
                    <div className="pt-3 flex gap-4 items-center flex-wrap
                      text-[12px] text-faint leading-4">
                      <span>
                        {t({
                          ne: `${num(one.session_count ?? 0)} कार्यसूची`,
                          en: `${num(one.session_count ?? 0)} Agendas`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(turnout[one.id]?.invited ?? 0)} निम्तो`,
                          en: `${turnout[one.id]?.invited ?? 0} invited`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(turnout[one.id]?.attended ?? 0)} आए · ${num(turnout[one.id]?.rate ?? 0)}%`,
                          en: `${turnout[one.id]?.attended ?? 0} attended · ${turnout[one.id]?.rate ?? 0}%`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(questions)} प्रश्न`,
                          en: `${num(questions)} questions`,
                        })}
                      </span>
                      <span>
                        {t({
                          ne: `${num(suggestions)} सुझाव`,
                          en: `${num(suggestions)} suggestions`,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-8 items-end justify-center
                    self-stretch shrink-0">
                    <span className="bg-[#ffe3e3] rounded-[4px] px-2 py-0.5
                      flex gap-1.5 items-center">
                      <span className="bg-[#e12121] rounded-full size-1.5" />
                      <span className="text-[12px] font-medium text-[#e12121]
                        leading-4">
                        {t({ ne: 'प्रत्यक्ष', en: 'Live' })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => openEvent(one)}
                      className="bg-navy-800 rounded-[12px] px-5 py-2 text-[16px]
                        font-medium text-white leading-6 hover:bg-navy-900"
                    >
                      {t({ ne: 'मडेरेट गर्नुहोस्', en: 'Moderate' })}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  // -- one event's queue -------------------------------------------------

  /**
   * The entries under each agenda, in the running order's own order.
   *
   * Only agendas with something in them appear: a header saying nought
   * pending is a row the host has to read past to reach the ones that
   * are not.
   */
  const grouped = agendas
    .map((one) => ({
      agenda: one,
      rows: shownEntries.filter((row) => (row.session ?? '') === one.id),
    }))
    .filter((group) => group.rows.length > 0);

  /** Anything written when nothing was on stage belongs to no agenda. */
  const loose = shownEntries.filter((row) => !row.session);

  return (
    <Card className="flex flex-col gap-6">
      {/* The grey block holds the event and the two things that narrow
          it. The design gives it no separate back control: the small word
          above the title is where you came from, so it is the way back. */}
      <header className="bg-[#eff0f2] rounded-[12px] px-5 py-4 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpened('')}
            className="self-start text-[24px] font-medium text-[#9e9e9e]
              leading-[1.2] hover:text-body"
          >
            {t({ ne: 'मडेरेसन', en: 'Moderation' })}
          </button>
          <h1 className="text-[24px] font-medium text-[#030712] leading-[1.2]">
            {event.title}
          </h1>
          <p className="text-[14px] text-[#4a5567] leading-[1.5]">
            {whenAndWhere(event)}
          </p>
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          <SearchBox
            value={agendaSearch}
            onChange={setAgendaSearch}
            label={t({ ne: 'कार्यसूची खोज्नुहोस्', en: 'Search Agendas' })}
            className="w-full max-w-[417px]"
          />
          <div className="flex gap-1 items-center">
              <label
                htmlFor="manch-moderation-agenda"
                className="text-[16px] text-black text-center"
              >
                {t({ ne: 'कार्यसूची', en: 'Agendas' })}
              </label>
              <select
                id="manch-moderation-agenda"
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                className="bg-white border-[0.6px] border-line rounded-[8px]
                  h-10 px-3 w-[334px] text-[14px] text-black"
              >
                <option value="all">{t({ ne: 'सबै कार्यसूची', en: 'All Agendas' })}</option>
                {(queue?.sessions ?? []).map((one) => (
                  <option key={one.id} value={one.id}>{one.title}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div
            role="tablist"
            className="border-b-[0.6px] border-[#f3f4f6] flex gap-4 items-start"
          >
            {([
              ['faq', { ne: 'प्रश्न', en: 'Q&A' }],
              ['suggestion', { ne: 'सुझाव', en: 'Suggestions' }],
            ] as [Board, Pair][]).map(([which, label]) => (
              <button
                key={which}
                role="tab"
                aria-selected={board === which}
                onClick={() => setBoard(which)}
                className={`px-3 py-2 text-[14px] font-medium leading-5 border-b-2 ${
                  board === which
                    ? 'border-head text-head'
                    : 'border-transparent text-subtle'
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {/* The pile being read comes first, so the screen says what it
              is showing before it says what else it could. */}
          <div className="flex gap-2.5 items-center flex-wrap">
            {([pile, ...(['pending', 'rejected', 'approved'] as Pile[])
              .filter((one) => one !== pile)]).map((which) => (
              <button
                key={which}
                type="button"
                aria-pressed={which === pile}
                onClick={() => setPile(which)}
                className={`rounded-[36px] px-3 py-1.5 flex gap-1 items-center
                  text-[12px] leading-5 ${
                  which === pile
                    ? 'bg-navy-800 text-white'
                    : 'bg-[#e3ecfd] text-[#393939]'
                }`}
              >
                {which === pile && <FigmaIcon name="checkFill" size={20} />}
                {t(PILE_LABEL[which])}
              </button>
            ))}
          </div>
        </div>

        {shownEntries.length === 0 ? (
          <div className="border-[0.6px] border-line rounded-[12px] py-10
            flex flex-col items-center gap-1">
            <p className="text-[14px] text-subtle">{t(NOTHING[pile][board])}</p>
            <p className="text-[12px] text-faint">
              {t({
                ne: 'सहभागीका नयाँ प्रश्न यहाँ समीक्षाका लागि देखिनेछन्।',
                en: 'New attendee questions will appear here for review.',
              })}
            </p>
          </div>
        ) : agenda !== 'all' ? (
          /* One agenda chosen, so there is nothing to group under: the
             heading would repeat the dropdown on every row. */
          <div className="flex flex-col gap-2">
            {shownEntries.map((row) => (
              <Entry
                key={row.id}
                message={row}
                pile={pile}
                busy={deciding === row.id}
                onDecide={(decision) => decide(row, decision)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(({ agenda: one, rows }) => {
              const shut = collapsed[one.id];
              return (
                <section
                  key={one.id}
                  className="bg-white border-[0.6px] border-[#e1e1e1] rounded-[12px]
                    overflow-hidden
                    shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.05)]"
                >
                  <button
                    type="button"
                    aria-expanded={!shut}
                    onClick={() => setCollapsed((was) => ({
                      ...was, [one.id]: !was[one.id],
                    }))}
                    className="border-b-[0.6px] border-[#ccc] px-4 py-3 w-full
                      flex items-center justify-between gap-3"
                  >
                    <span className="flex gap-3 items-center min-w-0">
                      <span className={shut ? '' : 'rotate-90'}>
                        <FigmaIcon name="caretRight" size={14} />
                      </span>
                      <span className="flex flex-col items-start min-w-0">
                        <span className="text-[14px] font-medium text-head
                          leading-5 truncate">
                          {one.title}
                        </span>
                        {one.speaker && (
                          <span className="text-[12px] text-faint leading-4 truncate">
                            {one.speaker}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="bg-[#f3f4f6] rounded-full px-2 py-0.5
                      text-[12px] font-medium text-subtle leading-4 shrink-0">
                      {t({
                        ne: `${num(rows.length)} ${t(PILE_LABEL[pile])}`,
                        en: `${num(rows.length)} ${t(PILE_LABEL[pile]).toLowerCase()}`,
                      })}
                    </span>
                  </button>

                  {!shut && (
                    <div className="px-4 pt-1 pb-4 flex flex-col gap-2">
                      {rows.map((row) => (
                        <Entry
                          key={row.id}
                          message={row}
                          pile={pile}
                          busy={deciding === row.id}
                          onDecide={(decision) => decide(row, decision)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            {loose.length > 0 && (
              <div className="flex flex-col gap-2">
                {loose.map((row) => (
                  <Entry
                    key={row.id}
                    message={row}
                    pile={pile}
                    busy={deciding === row.id}
                    onDecide={(decision) => decide(row, decision)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
