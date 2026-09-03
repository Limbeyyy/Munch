import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ChatMessage, ChatPerson, ChatSettings, EventMeeting } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { Btn, Card, Chip, Tabs } from '../../organizer/ui';
import { HubSocket, openHubSocket } from '../HubSocket';

interface Props {
  meetings: EventMeeting[];
  /** Guests speak through their signed token rather than an account. */
  guestToken?: string;
  myName: string;
}

/**
 * Where attendees speak: the room everyone can read, and a private word
 * with a presenter that the organizer passes on.
 */
export const HubView: React.FC<Props> = ({ meetings, guestToken, myName }) => {
  const { t, num } = useOrganizer();

  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '');
  const meeting = meetings.find((m) => m.id === meetingId) ?? meetings[0];

  const [tab, setTab] = useState<'room' | 'direct'>('room');
  const [settings, setSettings] = useState<ChatSettings>({
    chat_enabled: false, direct_messages_enabled: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presenters, setPresenters] = useState<ChatPerson[]>([]);
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<HubSocket | null>(null);

  const load = useCallback(async () => {
    try {
      if (guestToken) {
        const [chat, people] = await Promise.all([
          apiClient.guestChat(guestToken),
          apiClient.guestPresenters(guestToken).catch(() => [] as ChatPerson[]),
        ]);
        setSettings(chat.settings);
        setMessages(chat.messages);
        setPresenters(people);
        return;
      }
      if (!meeting) return;
      const s = await apiClient.getChatSettings(meeting.id);
      setSettings(s);
      setMessages(s.chat_enabled ? await apiClient.getChatMessages(meeting.id) : []);
      const people = await apiClient.getParticipants(meeting.id).catch(() => []);
      setPresenters(
        (people as any[])
          .filter((p) => ['host', 'co_host', 'presenter'].includes(p.role))
          .map((p) => ({
            id: p.user.id,
            name: [p.user.first_name, p.user.last_name].filter(Boolean).join(' ').trim() || p.user.email,
            role: p.role,
            is_guest: false,
          }))
      );
    } catch {
      // The hub is supplementary; a failed refresh must not break the page.
    }
  }, [meeting, guestToken]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  // Sending goes over the meeting's own socket; this view is just another
  // client of the chat path the room already uses.
  useEffect(() => {
    if (!meeting) return;
    const socket = openHubSocket(meeting.meeting_code, load, guestToken);
    socketRef.current = socket;
    return () => { socket.close(); socketRef.current = null; };
  }, [meeting?.meeting_code, guestToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, tab]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !meeting) return;
    if (tab === 'direct' && !target) {
      toast.error(t({ ne: 'कसलाई पठाउने छान्नुहोस्', en: 'Choose who it goes to' }));
      return;
    }
    try {
      setSending(true);
      const sent = socketRef.current?.send(text, tab === 'direct' ? target : undefined);
      if (!sent) {
        toast.error(t({ ne: 'जोडिएको छैन — फेरि प्रयास गर्नुहोस्', en: 'Not connected — try again' }));
        return;
      }
      setDraft('');
      toast.success(
        tab === 'direct'
          ? t({
              ne: 'आयोजककहाँ पुग्यो — स्वीकृत भएपछि वक्तासम्म जान्छ।',
              en: 'Sent to the organizer — it reaches the speaker once approved.',
            })
          : t({ ne: 'पठाइयो', en: 'Sent' })
      );
      await load();
    } catch {
      toast.error(t({ ne: 'पठाउन सकिएन', en: 'Could not send it' }));
    } finally { setSending(false); }
  };

  const shown = messages.filter((m) => (tab === 'direct' ? m.is_direct : !m.is_direct));

  if (!meeting) {
    return (
      <Card className="text-center py-10">
        <p className="text-[#6E7C8E]">
          {t({ ne: 'कुनै बैठक छैन।', en: 'No meeting to talk in.' })}
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[26px] font-semibold">{t({ ne: 'सहभागी हब', en: 'Attendee hub' })}</h1>
        <p className="text-sm text-[#6E7C8E] mt-1">
          {t({
            ne: 'कोठाको कुराकानी सबैले पढ्छन्। वक्तालाई सिधा पठाएको सन्देश आयोजकले हेरेर मात्र पुर्‍याउँछन्।',
            en: 'The room reads what you post. A word meant for a speaker goes through the organizer first.',
          })}
        </p>
      </div>

      {meetings.length > 1 && (
        <select
          value={meeting.id}
          onChange={(e) => setMeetingId(e.target.value)}
          className="w-full max-w-md border border-navy-800/15 rounded-[10px] px-3 py-2 bg-white text-sm mb-4"
        >
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.title} · {m.meeting_code}</option>
          ))}
        </select>
      )}

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as 'room' | 'direct')}
        tabs={[
          { id: 'room', label: { ne: 'कोठाको कुराकानी', en: 'The room' } },
          { id: 'direct', label: { ne: 'वक्तालाई सिधा', en: 'A word with a speaker' } },
        ]}
      />

      {!settings.chat_enabled ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({
              ne: 'आयोजकले च्याट बन्द राख्नुभएको छ।',
              en: 'The organizer has the chat closed for now.',
            })}
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-0 overflow-hidden">
            <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
              {shown.length === 0 ? (
                <p className="text-[13.5px] text-[#6E7C8E] py-6 text-center">
                  {tab === 'room'
                    ? t({ ne: 'अझै कसैले केही भनेको छैन।', en: 'Nobody has said anything yet.' })
                    : t({ ne: 'तपाईंका सिधा सन्देश यहाँ देखिन्छन्।', en: 'Your private messages appear here.' })}
                </p>
              ) : (
                shown.map((m) => {
                  const mine = m.sender_name === myName;
                  return (
                    <div key={m.id} className={`py-2 flex ${mine ? 'justify-end' : ''}`}>
                      <div className={`max-w-[80%] ${mine ? 'text-end' : ''}`}>
                        <p className="text-[12px] text-[#6E7C8E] mb-0.5">
                          {m.sender_name}
                          {m.is_direct && m.recipient_name && ` → ${m.recipient_name}`}
                          {m.sender_is_guest && (
                            <span className="ms-1.5"><Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip></span>
                          )}
                        </p>
                        <p
                          className={`inline-block text-[14px] px-3 py-2 rounded-[12px] text-start ${
                            mine ? 'bg-navy-800 text-white' : 'bg-cream-200 text-ink'
                          }`}
                        >
                          {m.body}
                        </p>
                        {m.moderation_status === 'pending' && (
                          <p className="text-[11.5px] text-[#B26A00] mt-1">
                            {t({ ne: 'आयोजकको स्वीकृति पर्खिँदै', en: 'Waiting on the organizer' })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>
          </Card>

          {tab === 'direct' && !settings.direct_messages_enabled ? (
            <p className="text-[13px] text-[#6E7C8E] mt-3">
              {t({
                ne: 'आयोजकले अहिले सिधा सन्देश लिइरहनुभएको छैन।',
                en: 'The organizer is not taking private messages at the moment.',
              })}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {tab === 'direct' && (
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full sm:max-w-xs border border-navy-800/15 rounded-[10px] px-3 py-2 bg-white text-sm"
                >
                  <option value="">{t({ ne: 'कसलाई पठाउने…', en: 'Who is it for…' })}</option>
                  {presenters.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  placeholder={
                    tab === 'room'
                      ? t({ ne: 'कोठालाई केही भन्नुहोस्…', en: 'Say something to the room…' })
                      : t({ ne: 'वक्तालाई सोध्नुहोस्…', en: 'Ask the speaker…' })
                  }
                  className="flex-1 border border-navy-800/15 rounded-[10px] px-3 py-2.5 text-sm bg-white resize-y"
                />
                <Btn tone="solid" onClick={send} disabled={sending || !draft.trim()} className="self-end">
                  {t({ ne: 'पठाउनुहोस्', en: 'Send' })}
                </Btn>
              </div>
              <p className="text-[12px] text-[#6E7C8E]">
                {t({
                  ne: `${num(shown.length)} सन्देश · Enter थिच्दा पठाइन्छ`,
                  en: `${shown.length} messages · Enter sends`,
                })}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
};
