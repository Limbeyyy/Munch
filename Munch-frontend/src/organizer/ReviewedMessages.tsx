import React from 'react';
import { ChatMessage, MessageTopic } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel } from './ui';

/** A passed-on message, remembering which meeting it came from. */
export type ReviewedRow = ChatMessage & { meetingId: string };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const TOPIC_LABEL: Record<'faq' | 'suggestion', Pair> = {
  faq: { ne: 'प्रश्नमा', en: 'On the board as a question' },
  suggestion: { ne: 'सुझावमा', en: 'On the board as a suggestion' },
};

/**
 * Direct messages the host has already passed on.
 *
 * A message leaves the queue when it is decided, but it should not vanish:
 * this is where it goes, so the host can see what they let through and
 * what they filed on the board - and file it now if they did not then. A
 * host often only sees what a message really was once a few have come in.
 *
 * Room messages are not here. They were never held, everybody read them at
 * the time, and the board is for what was said privately.
 */
export const ReviewedMessages: React.FC<{
  messages: ReviewedRow[];
  empty: Pair;
  busy?: string | null;
  onSort: (message: ReviewedRow, topic: MessageTopic) => void;
}> = ({ messages, empty, busy, onSort }) => {
  const { t, num } = useOrganizer();

  return (
    <Panel
      title={t({ ne: 'पठाइसकिएका', en: 'Passed on' })}
      aside={
        <span className="text-[12.5px] text-[#6E7C8E]">
          {t({
            ne: `${num(messages.length)} सन्देश`,
            en: `${messages.length} message${messages.length === 1 ? '' : 's'}`,
          })}
        </span>
      }
    >
      <div className="px-4">
        {messages.length === 0 ? (
          <Empty>{t(empty)}</Empty>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className="flex gap-3 py-3 border-b border-navy-800/[.08] last:border-0 items-start"
            >
              <span className="text-[12px] tabular-nums text-[#6E7C8E] w-[42px] flex-none">
                {clock(message.created_at)}
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-read">{message.body}</p>
                <p className="text-[12.5px] text-[#6E7C8E] mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{message.sender_name}</span>
                  <Chip tone="draft">
                    {t({
                      ne: `सिधा — ${message.recipient_name} लाई`,
                      en: `direct — to ${message.recipient_name}`,
                    })}
                  </Chip>
                </p>
              </div>
              {/* Sorting can happen after the fact. The host often only
                  realises what a message really was once a few of them
                  have come in. */}
              <span className="ml-auto flex items-center gap-1.5 flex-none flex-wrap justify-end">
                {message.topic && message.topic !== 'none' ? (
                  <Chip tone={message.topic === 'faq' ? 'ok' : 'warn'}>
                    {t(TOPIC_LABEL[message.topic])}
                  </Chip>
                ) : (
                  <Chip>{t({ ne: 'पठाइयो', en: 'Delivered' })}</Chip>
                )}

                {message.topic !== 'faq' && (
                  <Btn sm tone="solid" disabled={busy === message.id}
                       onClick={() => onSort(message, 'faq')}>
                    {t({ ne: 'प्रश्नमा सार्ने', en: 'Move to questions' })}
                  </Btn>
                )}
                {message.topic !== 'suggestion' && (
                  <Btn sm tone="amber" disabled={busy === message.id}
                       onClick={() => onSort(message, 'suggestion')}>
                    {t({ ne: 'सुझावमा सार्ने', en: 'Move to suggestions' })}
                  </Btn>
                )}
                {message.topic && message.topic !== 'none' && (
                  <Btn sm disabled={busy === message.id}
                       onClick={() => onSort(message, 'none')}>
                    {t({ ne: 'बोर्डबाट हटाउने', en: 'Take off the board' })}
                  </Btn>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
};
