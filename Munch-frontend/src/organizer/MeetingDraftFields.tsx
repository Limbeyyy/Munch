import React from 'react';
import { MeetingDraft, SessionDraft } from '../types';
import { useOrganizer } from './i18n';
import { Btn } from './ui';

/** A local datetime string for an <input type="datetime-local">. */
export const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const emptyMeeting = (date: string, hour = 9): MeetingDraft => {
  const start = new Date(`${date}T00:00:00`);
  start.setHours(hour, 0, 0, 0);
  const draft: MeetingDraft = {
    title: '',
    scheduled_start: toLocalInput(start),
    duration_minutes: 120,
    sessions: [],
  };
  // A meeting is its running order, so it starts with a session to fill in.
  return { ...draft, sessions: [emptySession(draft)] };
};

export const emptySession = (meeting: MeetingDraft): SessionDraft => {
  // A new session starts where the last one finished, so the running order
  // builds forward without the organizer retyping times.
  const last = meeting.sessions[meeting.sessions.length - 1];
  const from = last
    ? new Date(new Date(last.starts_at).getTime() + last.duration_minutes * 60000)
    : new Date(meeting.scheduled_start);
  return {
    title: '',
    speaker_name: '',
    // A new session usually runs in the same hall as the one before it.
    hall: last?.hall ?? '',
    starts_at: toLocalInput(from),
    duration_minutes: 30,
  };
};

interface Props {
  meeting: MeetingDraft;
  onChange: (next: MeetingDraft) => void;
  onRemove?: () => void;
  /** Shown when several meetings are being typed at once. */
  index?: number;
}

/**
 * The fields for one meeting and the sessions inside it.
 *
 * The same block builds a meeting whether it is going into a brand new
 * event or being added to one that already exists.
 */
export const MeetingDraftFields: React.FC<Props> = ({ meeting, onChange, onRemove, index }) => {
  const { t, num } = useOrganizer();

  const setSession = (i: number, patch: Partial<SessionDraft>) =>
    onChange({
      ...meeting,
      sessions: meeting.sessions.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });

  return (
    <div className="border border-navy-800/15 rounded-xl bg-white p-3.5">
      <div className="flex items-center gap-2 mb-3">
        {index !== undefined && (
          <span className="w-6 h-6 rounded-md bg-cream-200 grid place-items-center text-xs text-ink-2 flex-none">
            {num(index + 1)}
          </span>
        )}
        <b className="text-[13.5px]">{t({ ne: 'बैठक', en: 'Meeting' })}</b>
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto text-[12.5px] text-live hover:underline underline-offset-4"
          >
            {t({ ne: 'हटाउने', en: 'Remove' })}
          </button>
        )}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_170px_100px]">
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'नाम', en: 'Name' })}
          </label>
          <input
            value={meeting.title}
            onChange={(e) => onChange({ ...meeting, title: e.target.value })}
            placeholder={t({ ne: 'बिहान', en: 'Morning' })}
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13.5px]"
          />
        </div>
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'सुरु', en: 'Starts' })}
          </label>
          <input
            type="datetime-local"
            value={meeting.scheduled_start}
            onChange={(e) => onChange({ ...meeting, scheduled_start: e.target.value })}
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'मिनेट', en: 'Minutes' })}
          </label>
          <input
            type="number"
            min={5}
            step={5}
            value={meeting.duration_minutes}
            onChange={(e) =>
              onChange({ ...meeting, duration_minutes: Number(e.target.value) || 60 })
            }
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13.5px] text-center"
          />
        </div>
      </div>

      {/* Running order */}
      <div className="mt-3 pt-3 border-t border-navy-800/[.08]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12.5px] text-[#6E7C8E]">
            {t({ ne: 'यसभित्रका सत्र', en: 'Sessions inside it' })}
            {meeting.sessions.length > 0 && ` · ${num(meeting.sessions.length)}`}
          </span>
          <Btn
            sm
            className="ml-auto"
            onClick={() =>
              onChange({ ...meeting, sessions: [...meeting.sessions, emptySession(meeting)] })
            }
          >
            {t({ ne: '+ सत्र', en: '+ Session' })}
          </Btn>
        </div>

        {meeting.sessions.length === 0 ? (
          <p className="text-[12.5px] text-live">
            {t({
              ne: 'कम्तीमा एउटा सत्र चाहिन्छ — बैठक भनेकै यही हो।',
              en: 'At least one session is needed — that is what the meeting is.',
            })}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {meeting.sessions.map((session, i) => (
              <div
                key={i}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_120px_150px_78px_auto] items-end bg-cream rounded-lg p-2"
              >
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'सत्रको नाम', en: 'Session' })}
                  </label>
                  <input
                    value={session.title}
                    onChange={(e) => setSession(i, { title: e.target.value })}
                    placeholder={t({ ne: 'उद्घाटन', en: 'Opening' })}
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'वक्ता', en: 'Speaker' })}
                  </label>
                  <input
                    value={session.speaker_name ?? ''}
                    onChange={(e) => setSession(i, { speaker_name: e.target.value })}
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'हल', en: 'Hall' })}
                  </label>
                  <input
                    value={session.hall ?? ''}
                    onChange={(e) => setSession(i, { hall: e.target.value })}
                    placeholder={t({ ne: 'मुख्य हल', en: 'Main hall' })}
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'सुरु', en: 'Starts' })}
                  </label>
                  <input
                    type="datetime-local"
                    value={session.starts_at}
                    onChange={(e) => setSession(i, { starts_at: e.target.value })}
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[12.5px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'मिनेट', en: 'Mins' })}
                  </label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={session.duration_minutes}
                    onChange={(e) =>
                      setSession(i, { duration_minutes: Number(e.target.value) || 30 })
                    }
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] text-center bg-white"
                  />
                </div>
                <button
                  onClick={() =>
                    onChange({
                      ...meeting,
                      sessions: meeting.sessions.filter((_, j) => j !== i),
                    })
                  }
                  aria-label={t({ ne: 'सत्र हटाउने', en: 'Remove session' })}
                  className="w-7 h-7 rounded-md text-[#6E7C8E] hover:text-live hover:bg-white mb-0.5"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Turn the typed drafts into the shape the server expects. */
export const toApiMeeting = (draft: MeetingDraft): MeetingDraft => ({
  ...draft,
  title: draft.title.trim(),
  scheduled_start: new Date(draft.scheduled_start).toISOString(),
  sessions: draft.sessions
    .filter((s) => s.title.trim())
    .map((s) => ({
      ...s,
      title: s.title.trim(),
      starts_at: new Date(s.starts_at).toISOString(),
    })),
});
