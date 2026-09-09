import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Conclusion, ConclusionAction, ConclusionPage } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { Btn, Card, Chip, Empty, Head, Panel } from '../../organizer/ui';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** One session's findings and the actions that came out of it. */
const Finding: React.FC<{ entry: Conclusion }> = ({ entry }) => {
  const { t } = useOrganizer();

  return (
    <Panel
      title={entry.session_title}
      aside={
        <span className="text-[12.5px] text-[#6E7C8E]">
          {[
            entry.meeting_title,
            entry.speaker_name,
            `${day(entry.session_starts_at)} ${clock(entry.session_starts_at)}`,
          ].filter(Boolean).join(' · ')}
        </span>
      }
    >
      <div className="px-4 py-3.5">
        {entry.findings.length === 0 ? (
          <p className="text-[13px] text-[#6E7C8E]">
            {t({ ne: 'कुनै बिन्दु लेखिएको छैन।', en: 'Nothing was written down.' })}
          </p>
        ) : (
          <ul className="list-disc ps-5 space-y-1.5">
            {entry.findings.map((point, i) => (
              <li key={i} className="text-[13.5px] font-read leading-[1.75]">
                {point}
              </li>
            ))}
          </ul>
        )}

        {entry.actions.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-navy-800/[.08]">
            <p className="text-[12px] text-[#6E7C8E] mb-2">
              {t({ ne: 'कार्यसूची — कसले, कहिलेसम्म', en: 'Actions — who, and by when' })}
            </p>
            <ul>
              {entry.actions.map((action, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 py-2 border-b border-navy-800/[.06] last:border-0"
                >
                  <span className="text-[13.5px] flex-1 min-w-0">{action.task}</span>
                  {action.owner && (
                    <span className="text-[12.5px] text-[#6E7C8E] flex-none">
                      {action.owner}
                    </span>
                  )}
                  {action.due && (
                    <span className="flex-none">
                      <Chip tone="warn">{action.due}</Chip>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
};

/**
 * What the day came to, for somebody who sat through it.
 *
 * The transcript is the record and the summary is the host's account of
 * it; this is what an attendee leaves with - the few things each session
 * settled, and the lines with their own name against them.
 *
 * Only published summaries appear. A draft is the host's working copy,
 * and a conclusion nobody signed off on is worse than none.
 */
export const ConclusionsView: React.FC<{ myName: string; myEmail: string }> = ({
  myName,
  myEmail,
}) => {
  const { t, num } = useOrganizer();
  const [page, setPage] = useState<ConclusionPage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setPage(await apiClient.getConclusions());
    } catch {
      toast.error(t({ ne: 'निष्कर्ष ल्याउन सकिएन', en: 'Could not load the conclusions' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  /**
   * Printing is how this becomes a PDF.
   *
   * Every browser can save a page as one, which is a real file the reader
   * can keep - and it needs no library on either side, unlike drawing the
   * same document twice.
   */
  const asPdf = () => window.print();

  /**
   * The reader's own list, handed to their mail client.
   *
   * A mailto: link rather than a message sent from here: nothing on this
   * server can send mail yet, and a button that silently does nothing
   * would be worse than one that opens a draft they can see and send.
   */
  const sendMine = (mine: ConclusionAction[]) => {
    const lines = mine.map(
      (a) => `• ${a.task}${a.due ? ` — ${a.due}` : ''}${a.session_title ? ` (${a.session_title})` : ''}`
    );
    const subject = t({ ne: 'मेरो कार्यसूची', en: 'My action list' });
    const body = [
      t({ ne: `${myName}को कार्यसूची:`, en: `Action list for ${myName}:` }),
      '',
      ...lines,
    ].join('\n');

    window.location.href =
      `mailto:${encodeURIComponent(myEmail)}` +
      `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }

  const rows = page?.conclusions ?? [];
  const mine = page?.mine ?? [];

  return (
    <>
      <Head
        title={{ ne: 'मुख्य निष्कर्ष', en: 'Key conclusions' }}
        lede={{
          ne: 'सत्र सकिएपछि आयोजकले प्रकाशित गरेका निष्कर्ष — प्रकाशित भएपछि मात्र देखिन्छ।',
          en: 'What each session settled, as the organizer published it — nothing appears here until they do.',
        }}
      />

      <div className="flex gap-2 flex-wrap mb-4 manch-no-print">
        <Btn onClick={asPdf} disabled={rows.length === 0}>
          {t({ ne: 'सबै निष्कर्ष निकाल्नुहोस् (PDF)', en: 'Save all conclusions (PDF)' })}
        </Btn>
        <Btn tone="amber" onClick={() => sendMine(mine)} disabled={mine.length === 0}>
          {t({
            ne: `मेरो कार्यसूची पठाउनुहोस् (${num(mine.length)})`,
            en: `Send my action list (${mine.length})`,
          })}
        </Btn>
      </div>

      {mine.length > 0 && (
        <Card className="mb-4 border-s-[3px] border-s-amber">
          <p className="text-[12px] text-[#6E7C8E] mb-1.5">
            {t({ ne: 'तपाईंको नाममा', en: 'Against your name' })}
          </p>
          <ul className="space-y-1.5">
            {mine.map((action, i) => (
              <li key={i} className="text-[13.5px] flex items-baseline gap-2 flex-wrap">
                <span>{action.task}</span>
                {action.due && <Chip tone="warn">{action.due}</Chip>}
                {action.session_title && (
                  <span className="text-[12px] text-[#6E7C8E]">
                    {action.session_title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty>
            {t({
              ne: 'अझै कुनै निष्कर्ष प्रकाशित भएको छैन। सत्र सकिएपछि आयोजकले प्रकाशित गरेपछि यहाँ देखिन्छ।',
              en: 'Nothing published yet. Conclusions appear here once the organizer publishes them, after a session.',
            })}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {rows.map((entry) => (
            <Finding key={entry.session_id} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
};
