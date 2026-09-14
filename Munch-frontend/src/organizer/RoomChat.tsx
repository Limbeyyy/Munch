import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage } from '../types';
import { RoomPortrait, SidePanelHead } from '../pages/roomChrome';
import { useOrganizer } from './i18n';

/** Somebody in the room who can be written to. */
export interface ChatWho {
  id: string;
  name: string;
  role?: string;
  isGuest?: boolean;
}

interface Props {
  people: ChatWho[];
  messages: ChatMessage[];
  /** This reader, so their own messages can be told from everybody else's. */
  meId?: string | null;
  meIsGuest?: boolean;
  /** Whether the host has opened the room to messages at all. */
  directEnabled: boolean;
  /** The switch is the host's; everybody else only sees its consequence. */
  canSwitch?: boolean;
  switching?: boolean;
  onSwitch?: (on: boolean) => void;
  /** True where what this reader writes waits for the host first. */
  reviewed?: boolean;
  onSend: (recipientId: string, body: string) => void;
  onClose: () => void;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The room's chat: a list of people, and one conversation at a time.
 *
 * There is no room-wide thread, so there is nothing to address a message
 * to except a person - and picking one out of a dropdown was the wrong
 * shape for that. A conversation with somebody is a thing with a face, a
 * name and a last line, so that is what the list is: who you can write to
 * along the top, the conversations you already have underneath, and the
 * one you open filling the panel.
 */
export const RoomChat: React.FC<Props> = ({
  people, messages, meId, meIsGuest, directEnabled,
  canSwitch, switching, onSwitch, reviewed, onSend, onClose,
}) => {
  const { t, num } = useOrganizer();
  const [openWith, setOpenWith] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** What this reader has already looked at, so a badge means something. */
  const [seen, setSeen] = useState<string[]>([]);
  const foot = useRef<HTMLDivElement | null>(null);

  const mine = (m: ChatMessage) =>
    meIsGuest ? !!m.sender_is_guest && m.sender_id === meId : m.sender_id === meId;

  /** Who a message is between, from this reader's side. */
  const counterpart = (m: ChatMessage) =>
    mine(m)
      ? { id: m.recipient_id ?? '', name: m.recipient_name ?? '' }
      : { id: m.sender_id ?? '', name: m.sender_name ?? '' };

  /** One conversation per person, newest last. */
  const threads = useMemo(() => {
    const found = new Map<string, { who: ChatWho; messages: ChatMessage[] }>();
    messages.forEach((m) => {
      const other = counterpart(m);
      if (!other.id) return;
      const known = people.find((p) => p.id === other.id);
      const entry = found.get(other.id) ?? {
        who: known ?? { id: other.id, name: other.name || 'Someone' },
        messages: [],
      };
      entry.messages.push(m);
      found.set(other.id, entry);
    });
    const out: { who: ChatWho; messages: ChatMessage[] }[] = [];
    found.forEach((entry) => out.push(entry));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, people, meId, meIsGuest]);

  const unreadOf = (thread: { messages: ChatMessage[] }) =>
    thread.messages.filter((m) => !mine(m) && !seen.includes(m.id)).length;

  const open: { who: ChatWho; messages: ChatMessage[] } | null = openWith
    ? threads.find((one) => one.who.id === openWith)
      ?? {
        who: people.find((p) => p.id === openWith) ?? { id: openWith, name: '' },
        messages: [],
      }
    : null;

  // Opening a conversation is reading it, and the newest line is the one
  // worth being at.
  useEffect(() => {
    if (!open) return;
    setSeen((was) => [...was, ...open.messages.map((m) => m.id)]);
    foot.current?.scrollIntoView({ behavior: 'smooth' });
  }, [openWith, open?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const body = draft.trim();
    if (!body || !openWith || !directEnabled) return;
    onSend(openWith, body);
    setDraft('');
  };

  const theSwitch = canSwitch && onSwitch && (
    <div className="px-4 py-2.5 border-b border-[#e3e8ef] flex items-center justify-between gap-2">
      <span className="text-[13px] text-[#4a5567]">
        {t({ ne: 'सिधा सन्देश खुला', en: 'Allow direct messages' })}
      </span>
      <button
        role="switch"
        aria-checked={directEnabled}
        aria-label={t({ ne: 'सिधा सन्देश खुला', en: 'Allow direct messages' })}
        disabled={switching}
        onClick={() => onSwitch(!directEnabled)}
        className={`relative w-10 h-6 rounded-full transition-colors flex-none
          disabled:opacity-50 ${directEnabled ? 'bg-navy-800' : 'bg-[#dcdcde]'}`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all
            ${directEnabled ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </div>
  );

  if (open) {
    return (
      <>
        <SidePanelHead title={t({ ne: 'कुराकानी', en: 'Chat' })} onClose={onClose} />
        {theSwitch}

        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e3e8ef]">
          <button
            onClick={() => setOpenWith(null)}
            aria-label={t({ ne: 'सूचीमा फर्कनुहोस्', en: 'Back to chats' })}
            className="w-6 h-6 grid place-items-center text-[#6E7C8E] hover:text-navy-800"
          >
            <span aria-hidden className="text-[18px] leading-none">‹</span>
          </button>
          <RoomPortrait name={open.who.name} size={32} />
          <div className="min-w-0">
            <p className="text-[14px] font-medium truncate">{open.who.name}</p>
            {open.who.role && (
              <p className="text-[11px] text-[#656565] truncate">
                {open.who.role.replace('_', '-')}
              </p>
            )}
          </div>
        </div>

        <div className="h-[280px] overflow-y-auto p-3 flex flex-col gap-3">
          {open.messages.length === 0 ? (
            <p className="text-[13px] text-[#656565]">
              {t({ ne: 'अझै केही लेखिएको छैन।', en: 'Nothing written yet.' })}
            </p>
          ) : (
            open.messages.map((m) => (
              <div key={m.id} className={mine(m) ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] text-left px-3 py-2 rounded-[12px]
                    text-[14px] ${
                    mine(m)
                      ? 'bg-navy-800 text-white'
                      : 'bg-[#f1f4f8] text-[#030712] border border-[#e3e8ef]'
                  }`}
                >
                  <p className="break-words">{m.body}</p>
                  <p className={`text-[11px] mt-0.5 ${
                    mine(m) ? 'text-[#c9daf1]' : 'text-[#656565]'
                  }`}>
                    {clock(m.created_at)}
                    {mine(m) && m.moderation_status === 'pending'
                      && ` · ${t({ ne: 'पर्खाइमा', en: 'waiting' })}`}
                    {mine(m) && m.moderation_status === 'declined'
                      && ` · ${t({ ne: 'अस्वीकृत', en: 'declined' })}`}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={foot} />
        </div>

        <div className="p-3 border-t border-[#e3e8ef] flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              disabled={!directEnabled}
              placeholder={
                directEnabled
                  ? t({ ne: 'यहाँ लेख्नुहोस्', en: 'Write your message here' })
                  : t({
                      ne: 'सञ्चालकले सन्देश खोलेपछि मात्र',
                      en: 'The host has not opened messages yet',
                    })
              }
              maxLength={2000}
              className="flex-1 min-w-0 bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-navy-500
                disabled:opacity-60"
            />
            <button
              onClick={send}
              aria-label={t({ ne: 'पठाउनुहोस्', en: 'Send' })}
              disabled={!draft.trim() || !directEnabled}
              className="text-navy-700 hover:text-navy-900 px-2 flex-none
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5-19 8.5Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-[#656565]">
            {!directEnabled
              ? t({
                  ne: 'सञ्चालकले सन्देश खोलेका छैनन्।',
                  en: 'The host has not opened messages yet.',
                })
              : reviewed
              ? t({
                  ne: 'सञ्चालकले हेरेपछि मात्र पुग्छ।',
                  en: 'The host reviews this before it reaches them.',
                })
              : t({
                  ne: 'तपाईं र पाउने व्यक्तिले मात्र देख्नुहुन्छ।',
                  en: 'Only you and the person you write to can see this.',
                })}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <SidePanelHead title={t({ ne: 'कुराकानी', en: 'Chat' })} onClose={onClose} />
      {theSwitch}

      {/* Who there is to write to. A face and a name, not a list of
          addresses in a dropdown. */}
      {people.length > 0 && (
        <div className="flex gap-3 px-3 py-3 overflow-x-auto border-b border-[#e3e8ef]">
          {people.map((who) => (
            <button
              key={who.id}
              onClick={() => setOpenWith(who.id)}
              className="flex flex-col items-center gap-1 w-[64px] flex-none"
            >
              <RoomPortrait name={who.name} size={48} />
              <span className="text-[11px] text-[#030712] leading-tight text-center
                w-full truncate">
                {who.name}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="px-3 pt-3 pb-1 text-[15px] font-semibold text-black">
        {t({ ne: 'कुराकानीहरू', en: 'Chats' })}
      </p>

      <div className="max-h-[320px] overflow-y-auto">
        {threads.length === 0 ? (
          <p className="text-[13px] text-[#656565] px-3 py-3">
            {t({
              ne: 'अझै कुनै कुराकानी छैन। माथिबाट कसैलाई छान्नुहोस्।',
              en: 'No conversations yet. Choose somebody above to start one.',
            })}
          </p>
        ) : (
          threads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            const waiting = unreadOf(thread);
            return (
              <button
                key={thread.who.id}
                onClick={() => setOpenWith(thread.who.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b
                  border-[#e3e8ef] last:border-0 hover:bg-[#f9fafb] text-left"
              >
                <RoomPortrait name={thread.who.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-black truncate">
                    {thread.who.name}
                  </p>
                  <p className={`text-[12px] truncate ${
                    waiting > 0 ? 'text-[#030712] font-medium' : 'text-[#656565]'
                  }`}>
                    {mine(last) && `${t({ ne: 'तपाईं: ', en: 'You: ' })}`}
                    {last.body}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-none">
                  <span className="text-[11px] text-[#656565] tabular-nums">
                    {clock(last.created_at)}
                  </span>
                  {waiting > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 grid place-items-center
                      text-[10px] font-bold bg-live text-white rounded-full">
                      {num(waiting)}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
};
