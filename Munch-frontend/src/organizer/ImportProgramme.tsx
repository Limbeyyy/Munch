import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel } from './ui';

type Reading = Awaited<ReturnType<typeof apiClient.importProgrammeSheet>>['programmes'];

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The day something falls on, as the reader's own calendar has it. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

const dayAndClock = (iso: string) =>
  `${new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
  })} ${clock(iso)}`;

/**
 * Build a day from a spreadsheet rather than a form.
 *
 * Ten sessions is ten passes through a form, and the details - each
 * speaker's name, address and number - are usually already in a
 * spreadsheet somebody keeps. So the office fills in a template and hands
 * it over.
 *
 * The sheet is read and shown back before anything is created, because a
 * misread column is far easier to see as a running order than as a row of
 * cells. Nothing lands until the organizer says so, and then all of it
 * lands or none does.
 */
export const ImportProgramme: React.FC<{ onImported: () => void }> = ({
  onImported,
}) => {
  const { t, num } = useOrganizer();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);

  const complain = (error: any, fallback: string) => {
    const refusal = error?.response?.data;
    if (refusal?.row) {
      toast.error(
        t({
          ne: `पङ्क्ति ${num(refusal.row)}: ${refusal.error}`,
          en: `Row ${refusal.row}: ${refusal.error}`,
        }),
        { duration: 9000 }
      );
      return;
    }
    toast.error(refusal?.error || fallback, { duration: 8000 });
  };

  const getTemplate = async (shape: 'csv' | 'xlsx') => {
    try {
      const blob = await apiClient.downloadProgrammeTemplate(shape);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `manch-programme-template.${shape}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(
        t({ ne: 'टेम्प्लेट ल्याउन सकिएन', en: 'Could not fetch the template' })
      );
    }
  };

  const read = async (file: File) => {
    setChosen(file);
    setReading(null);
    setBusy('reading');
    try {
      const found = await apiClient.importProgrammeSheet(file, true);
      setReading(found.programmes);
    } catch (error) {
      setChosen(null);
      complain(error, t({ ne: 'पाना पढ्न सकिएन', en: 'Could not read that sheet' }));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const commit = async () => {
    if (!chosen) return;
    setBusy('saving');
    try {
      const done = await apiClient.importProgrammeSheet(chosen, false);
      const count = done.created?.length ?? 0;
      toast.success(
        t({
          ne: `${num(count)} कार्यक्रम बन्यो`,
          en: `${count} programme${count === 1 ? '' : 's'} created`,
        })
      );
      setChosen(null);
      setReading(null);
      onImported();
    } catch (error) {
      complain(error, t({ ne: 'बनाउन सकिएन', en: 'Could not create it' }));
    } finally {
      setBusy(null);
    }
  };

  const sessions = (reading ?? []).reduce(
    (n, event) => n + event.sessions.length,
    0
  );

  return (
    <Panel
      title={t({ ne: 'पानाबाट ल्याउने', en: 'Import from a sheet' })}
      actions={
        <>
          <Btn sm onClick={() => getTemplate('xlsx')}>
            {t({ ne: 'एक्सेल टेम्प्लेट', en: 'Excel template' })}
          </Btn>
          <Btn sm onClick={() => getTemplate('csv')}>
            {t({ ne: 'CSV टेम्प्लेट', en: 'CSV template' })}
          </Btn>
          <Btn sm tone="amber" onClick={() => fileRef.current?.click()}>
            {busy === 'reading'
              ? t({ ne: 'पढ्दै…', en: 'Reading…' })
              : t({ ne: 'भरिएको पाना', en: 'Choose a filled sheet' })}
          </Btn>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) read(file);
        }}
      />

      <div className="px-4 py-3.5">
        <p className="text-[13px] text-ink-2 leading-relaxed">
          {t({
            ne: 'टेम्प्लेटमा दुई तालिका छन् — कार्यक्रम र त्यसभित्रका सत्र। एउटा पानामा एउटै कार्यक्रम। भरेर यहीँ फर्काउनुहोस् (.xlsx वा CSV UTF-8)। बनाउनुअघि पूरा दिन देखाइन्छ।',
            en: 'The template is two tables — the event, and the sessions inside it — one event to a sheet. Fill it in and choose it here, as .xlsx or CSV UTF-8. The whole day is shown back before anything is created.',
          })}
        </p>

        {reading === null ? (
          <p className="text-[12.5px] text-[#6E7C8E] mt-2.5">
            {t({
              ne: 'सत्रको सङ्ख्यामा सीमा छैन। फारमका सबै नियम यहाँ पनि लागू हुन्छन् — वक्ताको विवरण, पहिलो सत्रको समय, र सत्रबीचको अन्तराल।',
              en: 'There is no limit on the sessions. Every rule the form applies applies here too: the speaker details, the first session pinned to the event, and the interval between sessions.',
            })}
          </p>
        ) : reading.length === 0 ? (
          <Empty>{t({ ne: 'पानामा कुनै सत्र भेटिएन।', en: 'No sessions in that sheet.' })}</Empty>
        ) : (
          <div className="mt-3.5">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <Chip tone="ok">
                {t({
                  ne: `${num(reading.length)} कार्यक्रम · ${num(sessions)} सत्र`,
                  en: `${reading.length} programme${reading.length === 1 ? '' : 's'} · ${sessions} session${sessions === 1 ? '' : 's'}`,
                })}
              </Chip>
              <span className="text-[12.5px] text-[#6E7C8E]">
                {t({ ne: 'अझै बनेको छैन', en: 'Nothing created yet' })}
              </span>
            </div>

            {reading.map((event) => (
              <div key={event.title} className="mb-3 last:mb-0">
                <p className="text-[13.5px] font-semibold">
                  {event.title}
                  <span className="ms-2 text-[12px] text-[#6E7C8E] font-normal">
                    {new Date(event.event_date ?? event.scheduled_start).toLocaleDateString(undefined, {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                    {event.venue ? ` · ${event.venue}` : ''}
                  </span>
                </p>
                {(() => {
                  const eventDay = dayOf(event.scheduled_start);
                  const elsewhere = eventDay !== event.event_date.slice(0, 10);
                  return (
                  <div className="mt-1.5 ps-3 border-s-2 border-navy-800/15">
                    <p className="text-[13px] font-medium">
                      <span className={`text-[12px] font-normal ${
                        elsewhere ? 'text-amber-700' : 'text-[#6E7C8E]'
                      }`}>
                        {elsewhere
                          ? dayAndClock(event.scheduled_start)
                          : clock(event.scheduled_start)}
                      </span>
                    </p>
                    <ul className="mt-0.5">
                      {event.sessions.map((session, i) => {
                        // A session on another day than its event is
                        // almost always a typed date nobody re-read. The
                        // clock alone hid it: it read as the next talk.
                        const otherDay = dayOf(session.starts_at) !== eventDay;
                        return (
                        <li key={`${session.title}-${i}`} className="text-[12.5px] text-[#6E7C8E]">
                          <span className={otherDay ? 'text-amber-700 font-medium' : ''}>
                            {otherDay ? dayAndClock(session.starts_at) : clock(session.starts_at)}
                          </span>
                          {' · '}{session.title}
                          {session.speaker_name ? ` — ${session.speaker_name}` : ''}
                          
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                  );
                })()}
              </div>
            ))}

            <div className="flex gap-2 mt-3.5">
              <Btn tone="amber" onClick={commit} disabled={busy === 'saving'}>
                {busy === 'saving'
                  ? t({ ne: 'बनाउँदै…', en: 'Creating…' })
                  : t({ ne: 'यही बनाउनुहोस्', en: 'Create this' })}
              </Btn>
              <Btn onClick={() => { setReading(null); setChosen(null); }}>
                {t({ ne: 'रद्द', en: 'Discard' })}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
};
