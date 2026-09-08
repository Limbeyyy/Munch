import React from 'react';
import { MeetingDraft, SessionDraft } from '../types';
import { useOrganizer } from './i18n';
import { GAP_MINUTES } from './schedule';
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
  // Its one session opens it: same start, no hole at the front.
  // A meeting is its running order, so it starts with a session to fill in.
  return { ...draft, sessions: [emptySession(draft)] };
};

/**
 * Move a meeting, and take its opening session with it.
 *
 * The first session begins exactly when the meeting does. A meeting that
 * opens at nine with nothing happening until half past is not a meeting
 * that opens at nine - either the start time is wrong or the gap is, and
 * making them agree is the only reading that is not a mistake.
 */
export const openingAt = (meeting: MeetingDraft, scheduled_start: string): MeetingDraft => {
  const inOrder = [...meeting.sessions].sort(
    (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
  );
  const opener = inOrder[0];
  return {
    ...meeting,
    scheduled_start,
    sessions: meeting.sessions.map((session) =>
      session === opener ? { ...session, starts_at: scheduled_start } : session
    ),
  };
};

/** Whether this is the session that opens the meeting. */
export const opensTheMeeting = (meeting: MeetingDraft, index: number): boolean => {
  const earliest = meeting.sessions.reduce(
    (soonest, s, i) =>
      +new Date(s.starts_at) < +new Date(meeting.sessions[soonest].starts_at) ? i : soonest,
    0
  );
  return index === earliest;
};

/**
 * The soonest a session may begin, given the ones already typed above it.
 *
 * The same rule the server enforces: the previous session's end, plus the
 * mandatory gap. Returns null when nothing runs before it.
 */
export const earliestStart = (meeting: MeetingDraft, index: number): Date | null => {
  const before = meeting.sessions.slice(0, index);
  if (before.length === 0) return null;

  const lastEnd = Math.max(
    ...before.map(
      (s) => new Date(s.starts_at).getTime() + s.duration_minutes * 60000
    )
  );
  return new Date(lastEnd + GAP_MINUTES * 60000);
};

export const emptySession = (meeting: MeetingDraft): SessionDraft => {
  // A new session starts once the last one has finished and the mandatory
  // gap has passed, so the running order builds forward already legal.
  const last = meeting.sessions[meeting.sessions.length - 1];
  const from = last
    ? new Date(
        new Date(last.starts_at).getTime() +
          (last.duration_minutes + GAP_MINUTES) * 60000
      )
    : new Date(meeting.scheduled_start);
  return {
    title: '',
    speaker_name: '',
    speaker_email: '',
    speaker_phone: '',
    // Private by default: handing out somebody's number should be a
    // decision, not what happens when nobody thinks about it.
    speaker_visibility: 'private',
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

  /**
   * Whether the opening session has drifted off the meeting's start.
   *
   * Leaving a hole at the front is not a way to run a different talk
   * first: that is a matter of reordering them.
   */
  const late = (i: number) =>
    opensTheMeeting(meeting, i) &&
    +new Date(meeting.sessions[i].starts_at) > +new Date(meeting.scheduled_start);

  /** Whether this session would start before the gap after the one above it. */
  const tooEarly = (i: number) => {
    const soonest = earliestStart(meeting, i);
    if (!soonest) return false;
    return new Date(meeting.sessions[i].starts_at) < soonest;
  };

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
            onChange={(e) => onChange(openingAt(meeting, e.target.value))}
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

        <p className="text-[12px] text-[#6E7C8E] mb-2">
          {t({
            ne: 'वक्ताको इमेल र फोन अनिवार्य — कार्यक्रम सकिएपछि सम्पर्क गर्न यही चाहिन्छ। निजी राखे सम्पर्क आयोजकमार्फत मात्र जान्छ।',
            en: "A speaker's email and phone are required: they are how anyone reaches them afterwards. Keep them private and requests come through you.",
          })}
        </p>

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
              <div key={i} className="bg-cream rounded-lg p-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_120px_150px_78px_auto] items-end">
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
                    min={(() => {
                      const soonest = earliestStart(meeting, i);
                      return soonest ? toLocalInput(soonest) : undefined;
                    })()}
                    onChange={(e) => setSession(i, { starts_at: e.target.value })}
                    className={`w-full border rounded-md px-2 py-1 text-[12.5px] bg-white ${
                      tooEarly(i) || late(i) ? 'border-live' : 'border-navy-800/15'
                    }`}
                  />
                  {late(i) && (
                    <p className="mt-1 text-[11.5px] text-live">
                      {t({
                        ne: 'पहिलो सत्र बैठक सुरु हुँदै सुरु हुनुपर्छ।',
                        en: 'The first session starts when the meeting starts.',
                      })}{' '}
                      <button
                        type="button"
                        onClick={() => setSession(i, { starts_at: meeting.scheduled_start })}
                        className="underline underline-offset-2"
                      >
                        {t({ ne: 'मिलाउनुहोस्', en: 'Move it to the start' })}
                      </button>
                    </p>
                  )}
                  {tooEarly(i) && (
                    <p className="mt-1 text-[11.5px] text-live">
                      {t({
                        ne: `अघिल्लो सत्रपछि ${num(GAP_MINUTES)} मिनेटको खाली ठाउँ चाहिन्छ।`,
                        en: `Sessions need ${GAP_MINUTES} minutes between them.`,
                      })}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          const soonest = earliestStart(meeting, i);
                          if (soonest) setSession(i, { starts_at: toLocalInput(soonest) });
                        }}
                        className="underline underline-offset-2"
                      >
                        {t({ ne: 'मिलाउनुहोस्', en: 'Use the next free time' })}
                      </button>
                    </p>
                  )}
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

              {/* How the speaker is reached once the day is over. */}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px] mt-2 pt-2 border-t border-navy-800/[.08]">
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'वक्ताको इमेल', en: "Speaker's email" })}
                  </label>
                  <input
                    type="email"
                    value={session.speaker_email ?? ''}
                    onChange={(e) => setSession(i, { speaker_email: e.target.value })}
                    placeholder="name@example.com"
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'फोन', en: 'Phone' })}
                  </label>
                  <input
                    value={session.speaker_phone ?? ''}
                    onChange={(e) => setSession(i, { speaker_phone: e.target.value })}
                    placeholder="98…"
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#6E7C8E] mb-1">
                    {t({ ne: 'सम्पर्क', en: 'Contact' })}
                  </label>
                  <select
                    value={session.speaker_visibility ?? 'private'}
                    onChange={(e) =>
                      setSession(i, { speaker_visibility: e.target.value as 'public' | 'private' })
                    }
                    className="w-full border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white"
                  >
                    <option value="private">{t({ ne: 'निजी — सोधेर मात्र', en: 'Private — on request' })}</option>
                    <option value="public">{t({ ne: 'सार्वजनिक', en: 'Public' })}</option>
                  </select>
                </div>
              </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Turn the typed drafts into the shape the server expects. */
/** What is still missing before this meeting can be created. */
export const missingSpeakerDetails = (draft: MeetingDraft): string[] =>
  draft.sessions
    .filter((s) => s.title.trim())
    .filter((s) => !s.speaker_name?.trim() || !s.speaker_email?.trim() || !s.speaker_phone?.trim())
    .map((s) => s.title.trim());

/**
 * Sessions typed too close to the one before them.
 *
 * The form flags these as they are typed; this is the check before saving,
 * for anyone who got past the field guard.
 */
export const tooCloseTogether = (draft: MeetingDraft): string[] =>
  draft.sessions
    .map((session, i) => {
      if (!session.title.trim()) return null;
      // The opening session is wrong when it is late, not when it is early.
      if (opensTheMeeting(draft, i)) {
        return +new Date(session.starts_at) !== +new Date(draft.scheduled_start)
          ? session.title.trim()
          : null;
      }
      const soonest = earliestStart(draft, i);
      if (!soonest) return null;
      return new Date(session.starts_at) < soonest ? session.title.trim() : null;
    })
    .filter((title): title is string => title !== null);

/**
 * Push a running order forward until it obeys the gap.
 *
 * The same forward-only spacing the server applies when a meeting arrives
 * with its sessions, so confirming the offered times gives exactly what
 * would have been stored anyway.
 */
export const spaceOut = (draft: MeetingDraft): MeetingDraft => {
  let previousEnd: number | null = null;
  const sessions = [...draft.sessions]
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    .map((session) => {
      // The first one opens the meeting; the rest step back from it.
      let startsAt =
        previousEnd === null
          ? +new Date(draft.scheduled_start)
          : Math.max(+new Date(session.starts_at), previousEnd + GAP_MINUTES * 60000);
      previousEnd = startsAt + session.duration_minutes * 60000;
      return { ...session, starts_at: toLocalInput(new Date(startsAt)) };
    });
  return { ...draft, sessions };
};

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
