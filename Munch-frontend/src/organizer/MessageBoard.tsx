import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { BoardEntry, MeetingBoard } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Chip, Empty, Panel, Tabs } from './ui';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  /** Read as an account holder. */
  meetingId?: string;
  /** Read as a guest, with the token they hold. */
  guestToken?: string;
  /** Poll, for a board somebody is watching during a meeting. */
  refreshMs?: number;
}

/**
 * The questions and suggestions the host has put up.
 *
 * The same board for everyone in the meeting - host, attendee and guest -
 * because a question worth answering is worth everybody seeing. Only the
 * asker is named; who a message was originally sent to is not shown.
 */
export const MessageBoard: React.FC<Props> = ({ meetingId, guestToken, refreshMs }) => {
  const { t, num } = useOrganizer();
  const [board, setBoard] = useState<MeetingBoard | null>(null);
  const [tab, setTab] = useState('faq');

  const load = useCallback(async () => {
    try {
      if (guestToken) {
        setBoard(await apiClient.getGuestBoard(guestToken));
      } else if (meetingId) {
        setBoard(await apiClient.getMeetingBoard(meetingId));
      } else {
        setBoard(null);
      }
    } catch {
      setBoard({ faq: [], suggestions: [] });
    }
  }, [meetingId, guestToken]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

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
              className="py-3 border-b border-navy-800/[.08] last:border-0"
            >
              <p className="text-[13.5px] text-ink font-read">{entry.body}</p>
              <p className="text-[12px] text-[#6E7C8E] mt-1 flex items-center gap-1.5 flex-wrap">
                <span>{entry.asked_by}</span>
                {entry.asker_is_guest && <Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip>}
                <span className="tabular-nums">· {clock(entry.created_at)}</span>
                {entry.was_direct && (
                  <Chip tone="draft">
                    {entry.sent_to
                      ? t({ ne: `सिधा — ${entry.sent_to} लाई`, en: `direct — to ${entry.sent_to}` })
                      : t({ ne: 'सिधा सन्देशबाट', en: 'from a direct message' })}
                  </Chip>
                )}
              </p>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
};
