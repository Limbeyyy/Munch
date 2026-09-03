import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ChatMessage, GuestAttendee, Meeting } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Empty, Head, Panel, Tabs } from '../ui';

interface Props { meetings: Meeting[]; }

/**
 * Everything waiting on the organizer's word: messages addressed to
 * presenters, and guests knocking to be let in.
 */
export const ModerationView: React.FC<Props> = ({ meetings }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('messages');
  const [messages, setMessages] = useState<{ meeting: Meeting; item: ChatMessage }[]>([]);
  const [guests, setGuests] = useState<{ meeting: Meeting; item: GuestAttendee }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // A moderator watches the whole event, not one session, so gather the
  // queues from every meeting that is still running.
  const live = meetings.filter((m) => m.status === 'active' || m.status === 'scheduled');

  const load = useCallback(async () => {
    const results = await Promise.allSettled(
      live.map(async (m) => ({
        meeting: m,
        pending: await apiClient.getPendingMessages(m.id).catch(() => [] as ChatMessage[]),
        waiting: await apiClient.getGuests(m.id).catch(() => [] as GuestAttendee[]),
      }))
    );

    const nextMessages: { meeting: Meeting; item: ChatMessage }[] = [];
    const nextGuests: { meeting: Meeting; item: GuestAttendee }[] = [];
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      r.value.pending.forEach((item) => nextMessages.push({ meeting: r.value.meeting, item }));
      r.value.waiting
        .filter((g) => g.status === 'pending')
        .forEach((item) => nextGuests.push({ meeting: r.value.meeting, item }));
    });
    setMessages(nextMessages);
    setGuests(nextGuests);
  }, [JSON.stringify(live.map((m) => m.id))]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const decideMessage = async (
    meeting: Meeting, message: ChatMessage, action: 'approve' | 'decline' | 'remove'
  ) => {
    try {
      setBusy(message.id);
      await apiClient.moderateMessage(meeting.id, message.id, action);
      setMessages((prev) => prev.filter((m) => m.item.id !== message.id));
      toast.success({
        approve: t({ ne: 'सन्देश पठाइयो', en: 'Delivered' }),
        decline: t({ ne: 'अस्वीकृत गरियो', en: 'Declined' }),
        remove: t({ ne: 'हटाइयो', en: 'Removed' }),
      }[action]);
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  const decideGuest = async (meeting: Meeting, guest: GuestAttendee, admit: boolean) => {
    try {
      setBusy(guest.id);
      await apiClient.admitGuest(meeting.id, guest.id, admit ? 'admit' : 'deny');
      setGuests((prev) => prev.filter((g) => g.item.id !== guest.id));
      toast.success(admit
        ? t({ ne: `${guest.full_name} भित्रिए`, en: `${guest.full_name} let in` })
        : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' }));
    } catch {
      toast.error(t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  return (
    <>
      <Head
        title={{ ne: 'मडेरेसन', en: 'Moderation' }}
        lede={{
          ne: 'सिधा सन्देश र पाहुनाका अनुरोध — तपाईंले स्वीकृत गरेपछि मात्र अघि बढ्छन्।',
          en: 'Direct messages and guest requests move on only once you approve them.',
        }}
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'messages', label: { ne: `सन्देश (${num(messages.length)})`, en: `Messages (${messages.length})` } },
          { id: 'guests', label: { ne: `पाहुना (${num(guests.length)})`, en: `Guests (${guests.length})` } },
        ]}
      />

      {tab === 'messages' && (
        <Panel title={t({ ne: 'स्वीकृति पर्खिरहेका सन्देश', en: 'Messages awaiting a decision' })}>
          <div className="px-4">
            {messages.length === 0 ? (
              <Empty>
                {t({
                  ne: 'लाइन सफा छ। सहभागीले प्रस्तोतालाई पठाएका सन्देश यहाँ आउँछन्।',
                  en: 'The queue is clear. Messages attendees send to presenters land here.',
                })}
              </Empty>
            ) : (
              messages.map(({ meeting, item }) => (
                <div key={item.id} className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-start">
                  <div className="min-w-0">
                    <p className="text-[13.5px]">{item.body}</p>
                    <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                      {item.sender_name} &rarr; {item.recipient_name}
                      {' · '}
                      <span className="text-navy-700">{meeting.title}</span>
                    </p>
                  </div>
                  <span className="ml-auto flex gap-1.5 flex-none flex-wrap justify-end">
                    <Btn sm tone="solid" disabled={busy === item.id}
                         onClick={() => decideMessage(meeting, item, 'approve')}>
                      {t({ ne: 'पठाउने', en: 'Deliver' })}
                    </Btn>
                    <Btn sm disabled={busy === item.id}
                         onClick={() => decideMessage(meeting, item, 'decline')}>
                      {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                    </Btn>
                    <Btn sm tone="danger" disabled={busy === item.id}
                         onClick={() => decideMessage(meeting, item, 'remove')}>
                      {t({ ne: 'हटाउने', en: 'Remove' })}
                    </Btn>
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      )}

      {tab === 'guests' && (
        <Panel title={t({ ne: 'भित्र पस्न पर्खिरहेका', en: 'Waiting to be let in' })}>
          <div className="px-4">
            {guests.length === 0 ? (
              <Empty>
                {t({
                  ne: 'कोही पर्खिरहेको छैन।',
                  en: 'Nobody is waiting.',
                })}
              </Empty>
            ) : (
              guests.map(({ meeting, item }) => (
                <div key={item.id} className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-center">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">{item.full_name}</p>
                    <p className="text-[12.5px] text-[#6E7C8E]">
                      {item.phone} &middot; <span className="text-navy-700">{meeting.title}</span>
                    </p>
                  </div>
                  <span className="ml-auto flex gap-1.5 flex-none">
                    <Chip tone="warn">{t({ ne: 'पर्खिरहेको', en: 'Waiting' })}</Chip>
                    <Btn sm tone="solid" disabled={busy === item.id}
                         onClick={() => decideGuest(meeting, item, true)}>
                      {t({ ne: 'भित्र्याउने', en: 'Let in' })}
                    </Btn>
                    <Btn sm tone="danger" disabled={busy === item.id}
                         onClick={() => decideGuest(meeting, item, false)}>
                      {t({ ne: 'अस्वीकृत', en: 'Decline' })}
                    </Btn>
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      )}
    </>
  );
};
