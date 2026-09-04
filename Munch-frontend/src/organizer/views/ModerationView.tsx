import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import {
  ChatMessage, ContactRequestRow, EventProgramme, GuestAttendee, Meeting, Session,
} from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';

const PAGE_SIZE = 20;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Where one queued item sits in the programme. */
interface Placement {
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  meeting: Meeting;
  session: Session | null;
}

interface Row extends Placement {
  kind: 'message' | 'guest';
  id: string;
  at: string;
  message?: ChatMessage;
  guest?: GuestAttendee;
  /** Everything a search can match, lowercased once. */
  haystack: string;
}

interface Props { meetings: Meeting[]; }

/**
 * Everything waiting on the organizer's word, kept in the shape of the
 * programme: an item belongs to a meeting, and to whichever session was
 * running when it arrived.
 */
export const ModerationView: React.FC<Props> = ({ meetings }) => {
  const { t, num } = useOrganizer();

  const [tab, setTab] = useState<'messages' | 'guests' | 'contacts'>('messages');
  const [contacts, setContacts] = useState<ContactRequestRow[]>([]);
  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [pending, setPending] = useState<Record<string, ChatMessage[]>>({});
  const [waiting, setWaiting] = useState<Record<string, GuestAttendee[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // A moderator watches the whole programme, so both queues are gathered
  // from every meeting that has not ended.
  const live = useMemo(
    () => meetings.filter((m) => m.status === 'active' || m.status === 'scheduled'),
    [meetings]
  );
  const liveKey = live.map((m) => m.id).join(',');

  useEffect(() => {
    apiClient.listEvents().then(setEvents).catch(() => undefined);
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await apiClient.listContactRequests({ status: 'pending' }));
    } catch {
      // The other queues still work without this one.
    }
  }, []);

  useEffect(() => {
    loadContacts();
    const id = setInterval(loadContacts, 10000);
    return () => clearInterval(id);
  }, [loadContacts]);

  const load = useCallback(async () => {
    const results = await Promise.allSettled(
      live.map(async (m) => ({
        id: m.id,
        pending: await apiClient.getPendingMessages(m.id).catch(() => [] as ChatMessage[]),
        waiting: await apiClient.getGuests(m.id).catch(() => [] as GuestAttendee[]),
      }))
    );
    const nextPending: Record<string, ChatMessage[]> = {};
    const nextWaiting: Record<string, GuestAttendee[]> = {};
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      nextPending[r.value.id] = r.value.pending;
      nextWaiting[r.value.id] = r.value.waiting.filter((g) => g.status === 'pending');
    });
    setPending(nextPending);
    setWaiting(nextWaiting);
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  /** Which programme each meeting belongs to, and its running order. */
  const placementOf = useCallback(
    (meeting: Meeting, at: string): Placement => {
      const event = events.find((e) => e.meetings.some((m) => m.id === meeting.id));
      const sessions = event?.meetings.find((m) => m.id === meeting.id)?.sessions ?? [];

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
        meeting,
        session,
      };
    },
    [events, t]
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    live.forEach((meeting) => {
      if (tab === 'messages') {
        (pending[meeting.id] ?? []).forEach((m) => {
          const place = placementOf(meeting, m.created_at);
          out.push({
            ...place,
            kind: 'message',
            id: m.id,
            at: m.created_at,
            message: m,
            haystack: [
              m.body, m.sender_name, m.sender_email, m.recipient_name,
              meeting.title, meeting.meeting_code,
              place.eventTitle, place.session?.title, place.session?.speaker_name,
            ].filter(Boolean).join(' ').toLowerCase(),
          });
        });
      } else {
        (waiting[meeting.id] ?? []).forEach((g) => {
          const place = placementOf(meeting, g.created_at);
          out.push({
            ...place,
            kind: 'guest',
            id: g.id,
            at: g.created_at,
            guest: g,
            haystack: [
              g.full_name, g.phone,
              meeting.title, meeting.meeting_code,
              place.eventTitle, place.session?.title, place.session?.speaker_name,
            ].filter(Boolean).join(' ').toLowerCase(),
          });
        });
      }
    });

    // Oldest first: whoever has waited longest deserves a decision first.
    return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [live, tab, pending, waiting, placementOf]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = useMemo(
    () => (terms.length === 0 ? rows : rows.filter((r) => terms.every((w) => r.haystack.includes(w)))),
    [rows, terms.join(' ')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = matched.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [tab, query]);

  /** Group this page into event → meeting → session sections. */
  const sections = useMemo(() => {
    const order: string[] = [];
    const byKey: Record<string, { row: Row; items: Row[] }> = {};
    visible.forEach((row) => {
      const key = `${row.eventId}|${row.meeting.id}|${row.session?.id ?? 'none'}`;
      if (!byKey[key]) {
        byKey[key] = { row, items: [] };
        order.push(key);
      }
      byKey[key].items.push(row);
    });
    return order.map((key) => ({ key, ...byKey[key] }));
  }, [visible]);

  const decideMessage = async (
    row: Row, action: 'approve' | 'decline' | 'remove'
  ) => {
    if (!row.message) return;
    try {
      setBusy(row.id);
      await apiClient.moderateMessage(row.meeting.id, row.message.id, action);
      setPending((prev) => ({
        ...prev,
        [row.meeting.id]: (prev[row.meeting.id] ?? []).filter((m) => m.id !== row.id),
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

  const decideContact = async (item: ContactRequestRow, decision: 'approve' | 'decline') => {
    try {
      setBusy(item.id);
      await apiClient.decideContactRequest(item.session, item.id, decision);
      setContacts((prev) => prev.filter((c) => c.id !== item.id));
      toast.success(
        decision === 'approve'
          ? t({ ne: 'सम्पर्क पठाइयो', en: 'Details passed on' })
          : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' })
      );
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  const decideGuest = async (row: Row, admit: boolean) => {
    if (!row.guest) return;
    try {
      setBusy(row.id);
      await apiClient.admitGuest(row.meeting.id, row.guest.id, admit ? 'admit' : 'deny');
      setWaiting((prev) => ({
        ...prev,
        [row.meeting.id]: (prev[row.meeting.id] ?? []).filter((g) => g.id !== row.id),
      }));
      toast.success(admit
        ? t({ ne: `${row.guest.full_name} भित्रिए`, en: `${row.guest.full_name} let in` })
        : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' }));
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  const messageCount = live.reduce((n, m) => n + (pending[m.id]?.length ?? 0), 0);
  const guestCount = live.reduce((n, m) => n + (waiting[m.id]?.length ?? 0), 0);

  return (
    <>
      <Head
        title={{ ne: 'मडेरेसन', en: 'Moderation' }}
        lede={{
          ne: 'हरेक कुरा आफ्नै बैठक र सत्रमुनि — एकै थुप्रोमा मिसिँदैन।',
          en: 'Each item sits under its own meeting and session, never in one mixed pile.',
        }}
      />

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as 'messages' | 'guests')}
        tabs={[
          { id: 'messages', label: { ne: `सन्देश (${num(messageCount)})`, en: `Messages (${messageCount})` } },
          { id: 'guests', label: { ne: `पाहुना (${num(guestCount)})`, en: `Guests (${guestCount})` } },
        ]}
      />

      {tab === 'contacts' ? (
        <Panel
          title={t({ ne: 'वक्तासँग सम्पर्कका अनुरोध', en: 'Requests to reach a speaker' })}
          aside={
            <span className="text-[12.5px] text-[#6E7C8E]">
              {t({
                ne: 'स्वीकृत गरेपछि मात्र इमेल र फोन देखिन्छ।',
                en: 'The email and phone appear only once you approve.',
              })}
            </span>
          }
        >
          <div className="px-4">
            {contacts.length === 0 ? (
              <Empty>
                {t({
                  ne: 'कुनै अनुरोध छैन। निजी वक्तालाई सम्पर्क गर्न खोज्नेहरू यहाँ आउँछन्।',
                  en: 'Nothing waiting. People asking to reach a private speaker land here.',
                })}
              </Empty>
            ) : (
              contacts.map((item) => (
                <div key={item.id} className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-start">
                  <div className="min-w-0">
                    <p className="text-[13.5px]">
                      <b className="font-medium">{item.asker_name}</b>
                      {item.asker_is_guest && (
                        <span className="ms-1.5"><Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip></span>
                      )}
                      {' '}
                      {t({ ne: 'ले', en: 'would like to reach' })}{' '}
                      <b className="font-medium">{item.speaker_name}</b>
                      {t({ ne: 'सँग सम्पर्क खोज्दै', en: '' })}
                    </p>
                    {item.reason && (
                      <p className="text-[13px] text-ink-2 font-read mt-1">“{item.reason}”</p>
                    )}
                    <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                      {item.session_title} · <span className="text-navy-700">{item.meeting_title}</span>
                    </p>
                  </div>
                  <span className="ml-auto flex gap-1.5 flex-none">
                    <Btn sm tone="solid" disabled={busy === item.id}
                         onClick={() => decideContact(item, 'approve')}>
                      {t({ ne: 'पठाउने', en: 'Pass it on' })}
                    </Btn>
                    <Btn sm tone="danger" disabled={busy === item.id}
                         onClick={() => decideContact(item, 'decline')}>
                      {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                    </Btn>
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      ) : (
      <>
      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <div className="relative flex-1 min-w-[240px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t({
              ne: 'बैठकको नाम, कोड, सत्र, वक्ता, नाम वा सन्देश खोज्नुहोस्',
              en: 'Search meeting, code, session, speaker, name or message',
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

      {matched.length === 0 ? (
        <Panel>
          <Empty>
            {terms.length > 0
              ? t({ ne: 'खोजसँग मिल्ने केही भेटिएन।', en: 'Nothing matches that search.' })
              : tab === 'messages'
              ? t({
                  ne: 'लाइन सफा छ। सहभागीले प्रस्तोतालाई पठाएका सन्देश यहाँ आउँछन्।',
                  en: 'The queue is clear. Messages attendees send to presenters land here.',
                })
              : t({ ne: 'कोही पर्खिरहेको छैन।', en: 'Nobody is waiting.' })}
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map(({ key, row, items }) => {
            const shut = !!collapsed[key];
            return (
              <Panel
                key={key}
                title={
                  <button
                    onClick={() => setCollapsed((v) => ({ ...v, [key]: !shut }))}
                    className="flex items-center gap-2 text-left min-w-0"
                  >
                    <span className={`text-[#6E7C8E] transition-transform ${shut ? '' : 'rotate-90'}`}>›</span>
                    <span className="text-[14.5px] font-semibold truncate">{row.meeting.title}</span>
                    <span className="text-[12px] font-mono text-navy-700">{row.meeting.meeting_code}</span>
                  </button>
                }
                aside={
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
                }
              >
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
                            <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                              {item.message!.sender_name} &rarr; {item.message!.recipient_name}
                            </p>
                          </div>
                          <span className="ml-auto flex gap-1.5 flex-none flex-wrap justify-end">
                            <Btn sm tone="solid" disabled={busy === item.id}
                                 onClick={() => decideMessage(item, 'approve')}>
                              {t({ ne: 'पठाउने', en: 'Deliver' })}
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
                            <p className="text-[12.5px] text-[#6E7C8E]">{item.guest!.phone}</p>
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
              </Panel>
            );
          })}
        </div>
      )}

      </>
      )}

      {/* Paging, only once there is more than a page to show */}
      {tab !== 'contacts' && pageCount > 1 && (
        <div className="flex items-center gap-2 mt-4 justify-center">
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
  );
};
