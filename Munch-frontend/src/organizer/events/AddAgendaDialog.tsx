import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Session } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Ic } from '../ui';

/** The lengths the design offers, rather than a number to be typed. */
const LENGTHS = [15, 20, 30, 45, 60, 90, 120];

/** The field wrapper the design uses: a small label over a bordered box. */
const Row: React.FC<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, required, children }) => (
  <label className="flex flex-col items-start w-full">
    <span className="h-[22px] pb-1.5 text-[12px] font-medium text-body leading-4">
      {label}
      {required && <span className="text-[#fb2c36]">{' *'}</span>}
    </span>
    {children}
  </label>
);

/** Every box on this form is drawn the same way. */
const BOX =
  'w-full border-[0.6px] border-line rounded-[8px] px-3 py-2 text-[14px] text-head '
  + 'placeholder:text-black/50 focus:outline-none focus:border-navy-800';

interface Props {
  eventId: string;
  /** The day the event runs, so a time alone is enough to place a session. */
  day: string;
  /** Where the running order has reached, offered as the next start. */
  suggestedStart?: string;
  /**
   * The session being changed, if this is an edit rather than a new one.
   *
   * The same form either way: what is being asked for is identical, and
   * a second dialog that only differed in where it posted would drift.
   */
  session?: Session;
  onClose: () => void;
  onAdded: (session: Session) => void;
}

/**
 * One session, written on its own rather than in a table of them.
 *
 * The running order used to be typed as a grid of rows, which asked the
 * organizer to hold a whole morning in their head at once. This asks for
 * one talk at a time: what it is called, when it starts, how long it
 * runs, and who is giving it.
 */
export const AddAgendaDialog: React.FC<Props> = ({
  eventId, day, suggestedStart, session, onClose, onAdded,
}) => {
  const { t, num } = useOrganizer();
  const editing = !!session;

  /** The hour a stored session starts, as the time field wants it. */
  const storedTime = session
    ? (() => {
        const at = new Date(session.starts_at);
        return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      })()
    : undefined;

  const [title, setTitle] = useState(session?.title ?? '');
  const [startTime, setStartTime] = useState(storedTime ?? suggestedStart ?? '10:00');
  const [minutes, setMinutes] = useState(session?.duration_minutes ?? 30);
  const [details, setDetails] = useState(session?.description ?? '');
  const [speaker, setSpeaker] = useState(session?.speaker_name ?? '');
  const [role, setRole] = useState(session?.speaker_role ?? '');
  // The address and number are written but never read back with the
  // session: the host reads their own through `speaker_contact`, and
  // nobody else reads them here at all.
  const [email, setEmail] = useState(session?.speaker_contact?.email ?? '');
  const [phone, setPhone] = useState(session?.speaker_contact?.phone ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      toast.error(t({ ne: 'सत्रको नाम लेख्नुहोस्', en: 'Give the session a name' }));
      return;
    }
    if (!startTime) {
      toast.error(t({ ne: 'सुरु हुने समय दिनुहोस्', en: 'Give it a start time' }));
      return;
    }
    // The server asks for all three when a session is written, so the
    // speaker can be reached after the day - and leaves them alone on a
    // patch. This follows that, so an edit is not held up by details
    // that were never collected in the first place.
    if (!editing && (!speaker.trim() || !email.trim() || !phone.trim())) {
      toast.error(t({
        ne: 'वक्ताको नाम, इमेल र फोन चाहिन्छ',
        en: 'A speaker name, email and phone are needed',
      }));
      return;
    }

    const written = {
      title: title.trim(),
      description: details.trim(),
      speaker_name: speaker.trim(),
      speaker_role: role.trim(),
      speaker_email: email.trim(),
      speaker_phone: phone.trim(),
      starts_at: new Date(`${day}T${startTime}`).toISOString(),
      duration_minutes: minutes,
    };

    try {
      setBusy(true);
      const saved = editing
        ? await apiClient.updateSession(session!.id, written)
        : await apiClient.createSession({ event: eventId, ...written });
      toast.success(
        editing
          ? t({ ne: `${saved.title} अद्यावधिक भयो`, en: `${saved.title} updated` })
          : t({ ne: `${saved.title} थपियो`, en: `${saved.title} added` })
      );
      onAdded(saved);
    } catch (e: any) {
      toast.error(errorText(e, editing
        ? t({ ne: 'बचत गर्न सकिएन', en: 'Could not save it' })
        : t({ ne: 'थप्न सकिएन', en: 'Could not add it' })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center p-4 bg-[#0b1220]/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={editing
        ? t({ ne: 'एजेन्डा सम्पादन', en: 'Edit agenda' })
        : t({ ne: 'एजेन्डा थप्नुहोस्', en: 'Add agenda' })}
    >
      <div className="bg-white rounded-[12px] w-full max-w-[512px] max-h-[88vh] overflow-auto
        shadow-[0px_25px_25px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between border-b-[0.6px] border-[#f3f4f6]
          px-6 pt-6 pb-4">
          <h3 className="text-[16px] font-semibold text-head leading-6">
            {editing
              ? t({ ne: 'एजेन्डा सम्पादन', en: 'Edit agenda' })
              : t({ ne: 'एजेन्डा थप्नुहोस्', en: 'Add agenda' })}
          </h3>
          <button
            onClick={onClose}
            aria-label={t({ ne: 'बन्द', en: 'Close' })}
            className="w-8 h-8 rounded-[8px] grid place-items-center text-faint hover:bg-black/[.04]"
          >
            <Ic d="M18 6L6 18M6 6l12 12" size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <Row label={t({ ne: 'एजेन्डाको नाम', en: 'Agenda name' })} required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t({
                ne: 'आपतकालीन प्रतिकार्यको परिचय',
                en: 'Emergency Response Overview',
              })}
              className={BOX}
            />
          </Row>

          <div className="grid grid-cols-2 gap-3">
            <Row label={t({ ne: 'सुरु हुने समय', en: 'Start time' })}>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={BOX}
              />
            </Row>
            <Row label={t({ ne: 'अवधि (मिनेट)', en: 'Duration (minutes)' })}>
              <select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className={`${BOX} bg-white`}
              >
                {LENGTHS.map((one) => (
                  <option key={one} value={one}>
                    {t({ ne: `${num(one)} मिनेट`, en: `${one} min` })}
                  </option>
                ))}
              </select>
            </Row>
          </div>

          <Row label={t({ ne: 'सत्रको विवरण', en: 'Session details' })}>
            <textarea
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t({
                ne: 'यो सत्रबारे टिपोट थप्नुहोस्…',
                en: 'Add notes about this session...',
              })}
              className={`${BOX} leading-5`}
            />
          </Row>

          <div className="flex flex-col items-start w-full">
            <span className="text-[12px] font-medium text-body leading-4">
              {t({ ne: 'वक्ता', en: 'Speaker' })}
            </span>
            <div className="w-full pt-1.5">
              <div className="border-[0.6px] border-line rounded-[8px] p-3 flex flex-col gap-2">
                <input
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                  placeholder={t({ ne: 'नाम *', en: 'Name *' })}
                  className={BOX}
                />
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={t({ ne: 'पद', en: 'Position' })}
                  className={BOX}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t({ ne: 'इमेल', en: 'Email' })}
                  className={BOX}
                />
                {/* Not in the drawing, and it cannot be left out: the server
                    will not take a speaker it has no way of reaching after
                    the day, which is a rule this project asked for. */}
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t({ ne: 'फोन', en: 'Phone' })}
                  className={BOX}
                />
              </div>
            </div>
          </div>

          <div className="border-t-[0.6px] border-[#f3f4f6] pt-4 flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="border-[0.6px] border-line rounded-[8px] px-4 py-2
                text-[14px] text-body leading-5"
            >
              {t({ ne: 'रद्द', en: 'Cancel' })}
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="bg-navy-800 hover:bg-navy-700 disabled:opacity-50 rounded-[8px]
                px-4 py-2 text-[14px] text-white leading-5"
            >
              {busy
                ? t({ ne: 'बचत गर्दै…', en: 'Saving…' })
                : editing
                ? t({ ne: 'परिवर्तन बचत', en: 'Save changes' })
                : t({ ne: 'सत्र थप्नुहोस्', en: 'Add session' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
