import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ContactRequestRow } from '../types';
import { useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel } from './ui';

const STATUS_LABEL = {
  pending: { ne: 'पर्खाइमा', en: 'Pending' },
  approved: { ne: 'स्वीकृत', en: 'Allowed' },
  declined: { ne: 'अस्वीकृत', en: 'Not allowed' },
} as const;

const STATUS_TONE = {
  pending: 'warn',
  approved: 'ok',
  declined: 'draft',
} as const;

interface Props {
  /** Limit the list to one programme. Omitted, it covers everything hosted. */
  eventId?: string;
  /** Show only requests still waiting, as the moderation queue does. */
  pendingOnly?: boolean;
  /** Poll, for a queue somebody is sitting in front of. */
  refreshMs?: number;
}

/**
 * People asking to reach a private speaker, and the host's answer.
 *
 * One list, used by the moderation queue and by the speakers dashboard.
 * Nothing here decides what a requester may see - the server does that
 * every time the details are asked for; this only records the decision.
 */
export const ContactRequests: React.FC<Props> = ({ eventId, pendingOnly, refreshMs }) => {
  const { t, num } = useOrganizer();
  const [rows, setRows] = useState<ContactRequestRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(
        await apiClient.listContactRequests({
          ...(eventId ? { event: eventId } : {}),
          ...(pendingOnly ? { status: 'pending' } : {}),
        })
      );
    } catch {
      // A host with nothing to moderate is not worth an error.
    } finally {
      setLoading(false);
    }
  }, [eventId, pendingOnly]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  const decide = async (item: ContactRequestRow, decision: 'approve' | 'decline') => {
    try {
      setBusy(item.id);
      const updated = await apiClient.decideContactRequest(item.session, item.id, decision);
      // The moderation queue shows only what is waiting, so a decided
      // request leaves it; the dashboard keeps it with its answer.
      setRows((prev) =>
        pendingOnly
          ? prev.filter((r) => r.id !== item.id)
          : prev.map((r) => (r.id === item.id ? updated : r))
      );
      toast.success(
        decision === 'approve'
          ? t({ ne: `${item.asker_name} लाई अनुमति दिइयो`, en: `${item.asker_name} may now see the details` })
          : t({ ne: 'अनुरोध अस्वीकृत', en: 'Request turned down' })
      );
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally {
      setBusy(null);
    }
  };

  const waiting = rows.filter((r) => r.status === 'pending').length;

  return (
    <Panel
      title={t({ ne: 'वक्तासँग सम्पर्कका अनुरोध', en: 'Requests to reach a speaker' })}
      aside={
        <span className="text-[12.5px] text-[#6E7C8E]">
          {waiting > 0
            ? t({
                ne: `${num(waiting)} पर्खाइमा — स्वीकृत गरेपछि मात्र इमेल र फोन देखिन्छ।`,
                en: `${waiting} waiting · the email and phone appear only once you allow it.`,
              })
            : t({
                ne: 'स्वीकृत गरेपछि मात्र इमेल र फोन देखिन्छ।',
                en: 'The email and phone appear only once you allow it.',
              })}
        </span>
      }
    >
      <div className="px-4">
        {loading ? (
          <Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            {t({
              ne: 'कुनै अनुरोध छैन। निजी वक्तालाई सम्पर्क गर्न खोज्नेहरू यहाँ आउँछन्।',
              en: 'Nothing waiting. People asking to reach a private speaker land here.',
            })}
          </Empty>
        ) : (
          rows.map((item) => (
            <div
              key={item.id}
              className="flex gap-3 py-3.5 border-b border-navy-800/[.08] last:border-0 items-start"
            >
              <div className="min-w-0">
                <p className="text-[13.5px]">
                  <b className="font-medium">{item.asker_name}</b>
                  {item.asker_is_guest && (
                    <span className="ms-1.5"><Chip>{t({ ne: 'पाहुना', en: 'Guest' })}</Chip></span>
                  )}{' '}
                  {t({ ne: 'ले सम्पर्क खोज्दै', en: 'would like to reach' })}{' '}
                  <b className="font-medium">{item.speaker_name || t({ ne: 'वक्ता', en: 'the speaker' })}</b>
                </p>
                {item.reason && (
                  <p className="text-[13px] text-ink-2 font-read mt-1">“{item.reason}”</p>
                )}
                <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                  {item.session_title} · <span className="text-navy-700">{item.meeting_title}</span>
                  {' · '}
                  <span className="tabular-nums">
                    {new Date(item.created_at).toLocaleString(undefined, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </p>
              </div>

              <span className="ml-auto flex items-center gap-1.5 flex-none">
                <Chip tone={STATUS_TONE[item.status]}>{t(STATUS_LABEL[item.status])}</Chip>
                {item.status !== 'approved' && (
                  <Btn sm tone="solid" disabled={busy === item.id}
                       onClick={() => decide(item, 'approve')}>
                    {t({ ne: 'अनुमति', en: 'Allow' })}
                  </Btn>
                )}
                {item.status !== 'declined' && (
                  <Btn sm tone="danger" disabled={busy === item.id}
                       onClick={() => decide(item, 'decline')}>
                    {t({ ne: 'अस्वीकृत', en: 'Disallow' })}
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
