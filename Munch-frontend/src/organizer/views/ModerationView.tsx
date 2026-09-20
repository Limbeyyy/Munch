import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ACTIVE_POLL_MS, QUEUE_POLL_MS } from '../../services/polling';
import { ChatMessage, Event, GuestAttendee, MessageTopic, Session } from '../../types';
import { Modal } from '../OrganizerShell';
import { MessageBoard } from '../MessageBoard';
import { ReviewedMessages, ReviewedRow } from '../ReviewedMessages';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';

const PAGE_SIZE = 20;

/** The two halves of a queue: deciding, and what was decided. */
type Half = 'permissions' | 'transfers';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Where one queued item sits in the programme. */
interface Placement {
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  event: Event;
  session: Session | null;
}

interface Row extends Placement {
  kind: 'message' | 'guest';
  id: string;
  at: string;
  message?: ChatMessage;
  guest?: GuestAttendee;
  haystack: string;
}

interface Props { events: Event[]; }

/**
 * Everything waiting on the organizer's word, kept in the shape of the
 * programme: an item belongs to a event, and to whichever session was
 * running when it arrived.
 */
export const ModerationView: React.FC<Props> = ({ events }) => {
  const { t, num } = useOrganizer();

  const [tab, setTab] = useState<'messages' | 'guests' | 'board'>(
    'messages'
  );
  const [boardEvent, setBoardEvent] = useState('');
  /**
   * Which event the messages and guests come from.
   *
   * Empty means the ones still running, which is the queue a moderator
   * works. Naming one opens its history instead - including events that
   * have ended, whose messages used to vanish from this screen the moment
   * they did, because only live events were ever fetched.
   */
  const [historyEvent, setHistoryEvent] = useState('');
  /**
   * Which half of a queue is open: deciding, or what was decided.
   *
   * Both queues answer the same two questions - what may be passed on,
   * and what has been - and stacking them meant scrolling past the whole
   * queue to reach the record of it.
   */
  const [half, setHalf] = useState<Half>('permissions');
  const [accepting, setAccepting] = useState<Row | null>(null);
  const [pending, setPending] = useState<Record<string, ChatMessage[]>>({});
  const [waiting, setWaiting] = useState<Record<string, GuestAttendee[]>>({});
  const [reviewedUsers, setReviewedUsers] = useState<ReviewedRow[]>([]);
  const [reviewedGuests, setReviewedGuests] = useState<ReviewedRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // A moderator watches the whole programme, so both queues are gathered
  // from every event that has not ended.
  const live = useMemo(() => {
    const chosen = events.find((m) => m.id === historyEvent);
    if (chosen) return [chosen];
    return events.filter((m) => m.status === 'active' || m.status === 'scheduled');
  }, [events, historyEvent]);
  const liveKey = live.map((m) => m.id).join(',');

  /** Looking at one event is looking at its record, not at its queue. */
  const showingHistory = !!events.find((m) => m.id === historyEvent);

  const load = useCallback(async () => {
    const results = await Promise.allSettled(
      live.map(async (m) => ({
        id: m.id,
        pending: await apiClient.getPendingMessages(m.id).catch(() => [] as ChatMessage[]),
        waiting: await apiClient.getGuests(m.id).catch(() => [] as GuestAttendee[]),
        reviewed: await apiClient
          .getReviewedMessages(m.id)
          .catch(() => ({ from_users: [], from_guests: [] })),
      }))
    );
    const nextPending: Record<string, ChatMessage[]> = {};
    const nextWaiting: Record<string, GuestAttendee[]> = {};
    const fromUsers: ReviewedRow[] = [];
    const fromGuests: ReviewedRow[] = [];
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      nextPending[r.value.id] = r.value.pending;
      nextWaiting[r.value.id] = showingHistory
        ? r.value.waiting
        : r.value.waiting.filter((g) => g.status === 'pending');
      const tag = (rows: ChatMessage[]) =>
        rows.map((row) => ({ ...row, eventId: r.value.id }));
      fromUsers.push(...tag(r.value.reviewed.from_users));
      fromGuests.push(...tag(r.value.reviewed.from_guests));
    });
    setPending(nextPending);
    setWaiting(nextWaiting);
    setReviewedUsers(fromUsers);
    setReviewedGuests(fromGuests);
  }, [liveKey, showingHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const id = setInterval(load, ACTIVE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /** The running order of the event something arrived in. */
  const placementOf = useCallback(
    (where: Event, at: string): Placement => {
      const event = events.find((e) => e.id === where.id) ?? where;
      const sessions = event.sessions ?? [];

      // Neither a message nor a guest records a session, so the session is
      // the one that was on stage at the time.
      const moment = +new Date(at);
      const session =
        sessions.find((s) => {
          const from = +new Date(s.starts_at);
          return moment >= from && moment < from + s.duration_minutes * 60000;
        }) ?? null;

      return {
        eventId: event?.id ?? '__none__',
        eventTitle: event?.title ?? t({ ne: 'कार्यक्रम बाहिर', en: 'Outside any event' }),
        eventDate: event?.event_date ?? null,
        event,
        session,
      };
    },
    [events, t]
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    live.forEach((event) => {
      // A message from a guest is a guest's business, wherever it is in
      // its life. Sorting them by who sent them rather than by what kind
      // of thing they are keeps the two queues answering the questions
      // their names promise: this tab is the people with accounts.
      const fromGuest = (m: { sender_is_guest?: boolean }) => !!m.sender_is_guest;

      if (tab === 'messages') {
        const settled = showingHistory
          ? reviewedUsers.filter((r) => r.eventId === event.id)
          : [];
        [
          ...(pending[event.id] ?? []).filter((m) => !fromGuest(m)),
          ...settled,
        ].forEach((m) => {
          const place = placementOf(event, m.created_at);
          out.push({
            ...place,
            kind: 'message',
            id: m.id,
            at: m.created_at,
            message: m,
            haystack: [
              m.body, m.sender_name, m.sender_email, m.recipient_name,
              event.title, event.code,
              place.eventTitle, place.session?.title, place.session?.speaker_name,
            ].filter(Boolean).join(' ').toLowerCase(),
          });
        });
      } else {
        (waiting[event.id] ?? []).forEach((g) => {
          const place = placementOf(event, g.created_at);
          out.push({
            ...place,
            kind: 'guest',
            id: g.id,
            at: g.created_at,
            guest: g,
            haystack: [
              g.full_name, g.phone,
              event.title, event.code,
              place.eventTitle, place.session?.title, place.session?.speaker_name,
            ].filter(Boolean).join(' ').toLowerCase(),
          });
        });

        // What the guests themselves have written, beside the people
        // waiting at the door.
        const settled = showingHistory
          ? reviewedGuests.filter((r) => r.eventId === event.id)
          : [];
        [
          ...(pending[event.id] ?? []).filter(fromGuest),
          ...settled,
        ].forEach((m) => {
          const place = placementOf(event, m.created_at);
          out.push({
            ...place,
            kind: 'message',
            id: m.id,
            at: m.created_at,
            message: m,
            haystack: [
              m.body, m.sender_name, m.sender_email, m.recipient_name,
              event.title, event.code,
              place.eventTitle, place.session?.title, place.session?.speaker_name,
            ].filter(Boolean).join(' ').toLowerCase(),
          });
        });
      }
    });

    // Oldest first: whoever has waited longest deserves a decision first.
    return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [
    live, tab, pending, waiting, placementOf,
    showingHistory, reviewedUsers, reviewedGuests,
  ]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = useMemo(
    () => (terms.length === 0 ? rows : rows.filter((r) => terms.every((w) => r.haystack.includes(w)))),
    [rows, terms.join(' ')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = matched.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [tab, query]);

  /** Group this page into event → event → session sections. */
  const sections = useMemo(() => {
    const order: string[] = [];
    const byKey: Record<string, { row: Row; items: Row[] }> = {};
    visible.forEach((row) => {
      const key = `${row.eventId}|${row.event.id}|${row.session?.id ?? 'none'}`;
      if (!byKey[key]) {
        byKey[key] = { row, items: [] };
        order.push(key);
      }
      byKey[key].items.push(row);
    });
    return order.map((key) => ({ key, ...byKey[key] }));
  }, [visible]);

  /**
   * Let a held message through, turn it down, or discard it.
   *
   * A topic delivers it and puts it on the board in one step, which is when
   * the host has just read it and knows what it is. The board is read by
   * everyone in the event, so sorting a direct message onto it is asked
   * about first.
   */
  const decideMessage = async (
    row: Row,
    action: 'approve' | 'decline' | 'remove',
    topic?: MessageTopic
  ) => {
    if (!row.message) return;
    if (topic && row.message.is_direct) {
      const ok = window.confirm(
        t({
          ne: 'यो सिधा सन्देश हो। बोर्डमा राख्दा बैठकका सबैले पढ्न सक्छन्।\n\nराख्ने?',
          en: 'This was sent privately. Putting it on the board lets everybody in the event read it.\n\nPut it up?',
        })
      );
      if (!ok) return;
    }
    try {
      setBusy(row.id);
      await apiClient.moderateMessage(row.event.id, row.message.id, action, topic);
      setPending((prev) => ({
        ...prev,
        [row.event.id]: (prev[row.event.id] ?? []).filter((m) => m.id !== row.id),
      }));
      toast.success({
        approve: t({ ne: 'सन्देश पठाइयो', en: 'Delivered' }),
        decline: t({ ne: 'अस्वीकृत गरियो', en: 'Declined' }),
        remove: t({ ne: 'हटाइयो', en: 'Removed' }),
      }[action]);
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  /**
   * File a message the host already passed on, or take it back off.
   *
   * The board is read by everyone in the event, so putting a private
   * message on it is asked about first - the same question the accept
   * prompt asks, in the place where the decision is now being made.
   */
  const sortReviewed = async (message: ReviewedRow, topic: MessageTopic) => {
    if (topic !== 'none') {
      const ok = window.confirm(
        t({
          ne: `यो सिधा सन्देश हो। बोर्डमा राख्दा बैठकका सबैले पढ्न सक्छन्।\n\n“${message.body}”\n\nराख्ने?`,
          en: `This was sent privately. Putting it on the board lets everybody in the event read it.\n\n“${message.body}”\n\nPut it up?`,
        })
      );
      if (!ok) return;
    }
    try {
      setBusy(message.id);
      const updated = await apiClient.sortMessage(message.eventId, message.id, topic);
      const swap = (rows: ReviewedRow[]) =>
        rows.map((r) => (r.id === message.id ? { ...r, ...updated } : r));
      setReviewedUsers(swap);
      setReviewedGuests(swap);
      toast.success(
        topic === 'none'
          ? t({ ne: 'बोर्डबाट हटाइयो', en: 'Taken off the board' })
          : topic === 'faq'
          ? t({ ne: 'प्रश्नमा राखियो', en: 'On the board as a question' })
          : t({ ne: 'सुझावमा राखियो', en: 'On the board as a suggestion' })
      );
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सार्न सकिएन', en: 'Could not move it' })));
    } finally { setBusy(null); }
  };

  const decideGuest = async (row: Row, admit: boolean) => {
    if (!row.guest) return;
    try {
      setBusy(row.id);
      await apiClient.admitGuest(row.event.id, row.guest.id, admit ? 'admit' : 'deny');
      setWaiting((prev) => ({
        ...prev,
        [row.event.id]: (prev[row.event.id] ?? []).filter((g) => g.id !== row.id),
      }));
      toast.success(admit
        ? t({ ne: `${row.guest.full_name} भित्रिए`, en: `${row.guest.full_name} let in` })
        : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' }));
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  // What each tab holds, not only what is waiting in it. A tab reading
  // (0) above a list of four messages is just wrong to the eye, whatever
  // the number technically counted.
  const pendingFrom = (guests: boolean) =>
    live.reduce(
      (n, m) =>
        n + (pending[m.id] ?? []).filter((x) => !!x.sender_is_guest === guests).length,
      0
    );
  /** What has already been passed on, for whichever queue is open. */
  const passedOn = tab === 'guests' ? reviewedGuests : reviewedUsers;

  const messageCount = pendingFrom(false) + reviewedUsers.length;
  const guestCount =
    live.reduce((n, m) => n + (waiting[m.id]?.length ?? 0), 0)
    + pendingFrom(true)
    + reviewedGuests.length;

  return (
    <>
      <Head
        title={{ ne: 'मडेरेसन', en: 'Moderation' }}
        lede={{
          ne: 'हरेक कुरा आफ्नै बैठक र सत्रमुनि — एकै थुप्रोमा मिसिँदैन।',
          en: 'Each item sits under its own event and session, never in one mixed pile.',
        }}
      />

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as 'messages' | 'guests' | 'board')}
        tabs={[
          { id: 'messages', label: { ne: `सन्देश (${num(messageCount)})`, en: `Messages (${messageCount})` } },
          { id: 'guests', label: { ne: `पाहुना (${num(guestCount)})`, en: `Guests (${guestCount})` } },
          { id: 'board', label: { ne: 'प्रश्न र सुझाव', en: 'Questions & suggestions' } },
        ]}
      />

      {tab === 'board' ? (
        <div className="flex flex-col gap-3.5">
          {events.length === 0 ? (
            <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No events.' })}</Empty></Panel>
          ) : (
            <>
              {/* One board at a time. Drawing every event's board at
                  once meant polling all of them at once, which is a lot of
                  traffic for boards nobody is looking at. */}
              {events.length > 1 && (
                <div>
                  <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
                    {t({ ne: 'कुन बैठक', en: 'Which event' })}
                  </label>
                  <select
                    value={boardEvent}
                    onChange={(e) => setBoardEvent(e.target.value)}
                    className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
                  >
                    {events.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <MessageBoard
                eventId={boardEvent || events[0].id}
                refreshMs={QUEUE_POLL_MS}
                canAnswer
              />
            </>
          )}
        </div>
      ) : (
      <>
      {events.length > 0 && (
        <div className="mb-3.5">
          <label
            htmlFor="manch-moderation-event"
            className="block text-[12.5px] text-[#6E7C8E] mb-1.5"
          >
            {t({ ne: 'कुन बैठक', en: 'Which event' })}
          </label>
          <select
            id="manch-moderation-event"
            value={historyEvent}
            onChange={(e) => { setHistoryEvent(e.target.value); setPage(1); }}
            className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
          >
            <option value="">
              {t({ ne: 'चलिरहेका बैठक (लाइन)', en: 'Events still running (the queue)' })}
            </option>
            {events.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
          {showingHistory && (
            <p className="text-[12px] text-[#6E7C8E] mt-1.5">
              {t({
                ne: 'यो बैठकको सबै — निर्णय भइसकेका पनि।',
                en: 'Everything from this event, decided items included.',
              })}
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <div className="relative flex-1 min-w-[240px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t({
              ne: 'बैठकको नाम, कोड, सत्र, वक्ता, नाम वा सन्देश खोज्नुहोस्',
              en: 'Search event, code, session, speaker, name or message',
            })}
            className="w-full border border-navy-800/15 rounded-[9px] pl-3 pr-8 py-2 text-[13.5px] bg-white"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label={t({ ne: 'खोज हटाउने', en: 'Clear search' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6E7C8E] hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
        <span className="text-[12.5px] text-[#6E7C8E]">
          {terms.length > 0
            ? t({
                ne: `${num(matched.length)} भेटियो (जम्मा ${num(rows.length)})`,
                en: `${matched.length} of ${rows.length} match`,
              })
            : t({ ne: `जम्मा ${num(rows.length)}`, en: `${rows.length} in the queue` })}
        </span>
      </div>

      {/* One card, not a scattering: the queue's name, its two halves, and
          whichever half is open. What decides *which* items are in play -
          the event, and the search - sits above it, because it governs
          both halves rather than belonging to either. */}
      <div className="bg-white border border-navy-800/15 rounded-xl overflow-hidden">
      <div className="px-4 pt-3">
        <h2 className="text-[15.5px] font-semibold">
          {tab === 'guests'
            ? t({ ne: 'पाहुना', en: 'Guests' })
            : t({ ne: 'सन्देश', en: 'Messages' })}
        </h2>
        <Tabs
          active={half}
          onChange={(id) => { setHalf(id as Half); setPage(1); }}
          tabs={[
            {
              id: 'permissions',
              label: {
                ne: `अनुमति (${num(rows.length)})`,
                en: `Permissions (${rows.length})`,
              },
            },
            {
              id: 'transfers',
              label: {
                ne: `स्थानान्तरण (${num(passedOn.length)})`,
                en: `Transfers (${passedOn.length})`,
              },
            },
          ]}
        />
      </div>

      <div className="border-t border-navy-800/[.08]">
      {/* Out of the queue, into the record: what was passed on, and
          whether it also went on the board. */}
      {half === 'transfers' ? (
        <ReviewedMessages
          bare
          busy={busy}
          onSort={sortReviewed}
          messages={passedOn}
          empty={
            tab === 'guests'
              ? {
                  ne: 'पाहुनाबाट आएको कुनै सिधा सन्देश अझै पठाइएको छैन।',
                  en: 'No direct message from a guest has been passed on yet.',
                }
              : {
                  ne: 'कुनै सिधा सन्देश अझै पठाइएको छैन।',
                  en: 'No direct message has been passed on yet.',
                }
          }
        />
      ) : (
      <>

      {matched.length === 0 ? (
        <Empty>
            {terms.length > 0
              ? t({ ne: 'खोजसँग मिल्ने केही भेटिएन।', en: 'Nothing matches that search.' })
              : tab === 'messages'
              ? t({
                  ne: 'लाइन सफा छ। सहभागीले प्रस्तोतालाई पठाएका सन्देश यहाँ आउँछन्।',
                  en: 'The queue is clear. Messages attendees send to presenters land here.',
                })
              : t({
                  ne: 'कोही पर्खिरहेको छैन, र पाहुनाबाट कुनै सन्देश आएको छैन।',
                  en: 'Nobody is waiting, and no guest has written anything.',
                })}
        </Empty>
      ) : (
        <div>
          {sections.map(({ key, row, items }) => {
            const shut = !!collapsed[key];
            return (
              <section
                key={key}
                className="border-b border-navy-800/15 last:border-0"
              >
                <div className="px-4 py-3 bg-[#FBFAF6] flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => setCollapsed((v) => ({ ...v, [key]: !shut }))}
                    className="flex items-center gap-2 text-left min-w-0"
                  >
                    <span className={`text-[#6E7C8E] transition-transform ${shut ? '' : 'rotate-90'}`}>›</span>
                    <span className="text-[14.5px] font-semibold truncate">{row.event.title}</span>
                    <span className="text-[12px] font-mono text-navy-700">{row.event.code}</span>
                  </button>
                  <span className="flex items-center gap-2 flex-wrap text-[12.5px] text-[#6E7C8E]">
                    <span className="truncate max-w-[220px]">
                      {row.eventTitle}
                      {row.eventDate &&
                        ` · ${new Date(row.eventDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                    </span>
                    {row.session ? (
                      <Chip tone="ok">
                        {clock(row.session.starts_at)} {row.session.title}
                        {row.session.speaker_name && ` · ${row.session.speaker_name}`}
                      </Chip>
                    ) : (
                      <Chip tone="draft">{t({ ne: 'कुनै सत्र बाहिर', en: 'Between sessions' })}</Chip>
                    )}
                    <Chip>{num(items.length)}</Chip>
                  </span>
                </div>

                {!shut && (
                  <div className="px-4">
                    {items.map((item: Row) =>
                      item.kind === 'message' ? (
                        <div key={item.id} className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-start">
                          <span className="text-[12px] tabular-nums text-[#6E7C8E] w-[42px] flex-none pt-0.5">
                            {clock(item.at)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13.5px]">{item.message!.body}</p>
                            <p className="text-[12.5px] text-[#6E7C8E] mt-0.5 flex items-center gap-1.5 flex-wrap">
                              <span>{item.message!.sender_name}</span>
                              {item.message!.is_direct ? (
                                <Chip tone="draft">
                                  {t({
                                    ne: `सिधा — ${item.message!.recipient_name} लाई`,
                                    en: `direct — to ${item.message!.recipient_name}`,
                                  })}
                                </Chip>
                              ) : (
                                <Chip>{t({ ne: 'सबैलाई', en: 'to the room' })}</Chip>
                              )}
                            </p>
                          </div>
                          <span className="ml-auto flex gap-1.5 flex-none flex-wrap justify-end">
                            <Btn sm tone="solid" disabled={busy === item.id}
                                 onClick={() => setAccepting(item)}>
                              {t({ ne: 'स्वीकार', en: 'Accept' })}
                            </Btn>
                            <Btn sm disabled={busy === item.id}
                                 onClick={() => decideMessage(item, 'decline')}>
                              {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                            </Btn>
                            <Btn sm tone="danger" disabled={busy === item.id}
                                 onClick={() => decideMessage(item, 'remove')}>
                              {t({ ne: 'हटाउने', en: 'Remove' })}
                            </Btn>
                          </span>
                        </div>
                      ) : (
                        <div key={item.id} className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-center">
                          <span className="text-[12px] tabular-nums text-[#6E7C8E] w-[42px] flex-none">
                            {clock(item.at)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium">{item.guest!.full_name}</p>
                            <p className="text-[12.5px] text-[#6E7C8E]">
                              {t({ ne: 'पाहुनाका रूपमा', en: 'Joining as a guest' })}
                            </p>
                          </div>
                          <span className="ml-auto flex gap-1.5 flex-none items-center">
                            <Chip tone="warn">{t({ ne: 'पर्खिरहेको', en: 'Waiting' })}</Chip>
                            <Btn sm tone="solid" disabled={busy === item.id}
                                 onClick={() => decideGuest(item, true)}>
                              {t({ ne: 'भित्र्याउने', en: 'Let in' })}
                            </Btn>
                            <Btn sm tone="danger" disabled={busy === item.id}
                                 onClick={() => decideGuest(item, false)}>
                              {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                            </Btn>
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Paging, only once there is more than a page to show */}
      {pageCount > 1 && (
        <div className="flex items-center gap-2 py-3.5 justify-center border-t border-navy-800/[.08]">
          <Btn sm disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
            {t({ ne: 'अघिल्लो', en: 'Previous' })}
          </Btn>
          <span className="text-[12.5px] text-[#6E7C8E] tabular-nums px-2">
            {t({
              ne: `पृष्ठ ${num(currentPage)} / ${num(pageCount)}`,
              en: `Page ${currentPage} of ${pageCount}`,
            })}
          </span>
          <Btn sm disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
            {t({ ne: 'अर्को', en: 'Next' })}
          </Btn>
        </div>
      )}
      </>
      )}
      </div>
      </div>

      </>
      )}

      {accepting?.message && (
        <Modal
          open
          onClose={() => setAccepting(null)}
          title={t({ ne: 'कसरी स्वीकार गर्ने?', en: 'Accept it as what?' })}
          lede={
            accepting.message.is_direct
              ? t({
                  ne: `${accepting.message.sender_name} ले ${accepting.message.recipient_name} लाई सिधा पठाएको`,
                  en: `${accepting.message.sender_name} sent this privately to ${accepting.message.recipient_name}`,
                })
              : t({
                  ne: `${accepting.message.sender_name} ले सबैलाई`,
                  en: `${accepting.message.sender_name}, to the room`,
                })
          }
          footer={
            <Btn onClick={() => setAccepting(null)}>
              {t({ ne: 'रद्द', en: 'Cancel' })}
            </Btn>
          }
        >
          <p className="text-[13.5px] font-read bg-cream rounded-lg px-3 py-2.5">
            {accepting.message.body}
          </p>
          <p className="text-[12.5px] text-[#6E7C8E] mt-3">
            {accepting.message.is_direct
              ? t({
                  ne: 'प्रश्न वा सुझाव छान्दा सन्देश पठाइन्छ र बोर्डमा पनि राखिन्छ — बोर्ड बैठकका सबैले पढ्न सक्छन्।',
                  en: 'Question or suggestion delivers it and also puts it on the board, which everybody in the event can read.',
                })
              : t({
                  ne: 'यो सन्देश सबैलाई पठाइएको हो — कोठाले पहिल्यै पढिसक्यो, त्यसैले बोर्डमा जाँदैन।',
                  en: 'This one went to the whole room, which has already read it, so it does not go on the board.',
                })}
          </p>
          <div className="mt-3.5 flex gap-2 flex-wrap">
            {/* Only what was said privately reaches the board. */}
            {accepting.message.is_direct && (
              <>
                <Btn tone="solid" onClick={() => { const row = accepting; setAccepting(null); decideMessage(row, 'approve', 'faq'); }}>
                  {t({ ne: 'प्रश्नका रूपमा', en: 'Accept as question' })}
                </Btn>
                <Btn tone="amber" onClick={() => { const row = accepting; setAccepting(null); decideMessage(row, 'approve', 'suggestion'); }}>
                  {t({ ne: 'सुझावका रूपमा', en: 'Accept as suggestion' })}
                </Btn>
              </>
            )}
            <Btn tone={accepting.message.is_direct ? 'plain' : 'solid'}
                 onClick={() => { const row = accepting; setAccepting(null); decideMessage(row, 'approve'); }}>
              {accepting.message.is_direct
                ? t({ ne: 'बोर्डमा नराखी पठाउने', en: 'Just deliver it' })
                : t({ ne: 'पठाउने', en: 'Deliver it' })}
            </Btn>
          </div>
        </Modal>
      )}

    </>
  );
};
