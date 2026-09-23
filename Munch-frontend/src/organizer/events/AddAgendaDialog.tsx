import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Artifact, Session } from '../../types';
import { FigmaIcon } from '../../assets/icons';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Ic } from '../ui';
import { FileBadge } from './fileKinds';

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
  /** The day being added to, so a time alone is enough to place a session. */
  day: string;
  /**
   * Every day the event runs, earliest first.
   *
   * One of them and the dropdown is pointless, so it is left off: there
   * is nothing to select between.
   */
  days?: string[];
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
 * One agenda item, written on its own rather than in a table of them.
 *
 * The running order used to be typed as a grid of rows, which asked the
 * organizer to hold a whole morning in their head at once. This asks for
 * one talk at a time: what it is called, when it starts, how long it
 * runs, who is giving it, and what they are handing out.
 */
export const AddAgendaDialog: React.FC<Props> = ({
  eventId, day, days, suggestedStart, session, onClose, onAdded,
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
  /** Which day of the event this slot sits on. */
  const [onDay, setOnDay] = useState(
    session?.starts_at ? session.starts_at.slice(0, 10) : day
  );
  const [busy, setBusy] = useState(false);

  /** What the speaker has already handed in, as the server holds it. */
  const [shared, setShared] = useState<Artifact[]>([]);
  /**
   * Files picked before the agenda item exists.
   *
   * A document is filed against a talk, and a talk being written for the
   * first time has no id to file anything against - so these wait here
   * and go up the moment it does.
   */
  const [waiting, setWaiting] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const sessionId = session?.id;

  const readShared = useCallback(async (id: string) => {
    try {
      const all = await apiClient.getResources(eventId);
      setShared(all.filter((one) => one.session === id));
    } catch {
      // The documents are what the speaker sent, not what the form is
      // for; a form that will not open because of them is worse.
    }
  }, [eventId]);

  useEffect(() => {
    if (sessionId) readShared(sessionId);
  }, [sessionId, readShared]);

  /** Send what was picked, or hold it until there is an agenda to hold it. */
  const take = async (picked: FileList | null) => {
    const chosen = Array.from(picked ?? []);
    if (chosen.length === 0) return;
    if (!sessionId) {
      setWaiting((held) => [...held, ...chosen]);
      return;
    }
    try {
      setSending(true);
      for (const file of chosen) {
        await apiClient.uploadResource(eventId, file, undefined, sessionId);
      }
      await readShared(sessionId);
      toast.success(t({
        ne: `${num(chosen.length)} फाइल थपियो`,
        en: `${chosen.length} file${chosen.length === 1 ? '' : 's'} uploaded`,
      }));
    } catch (e: any) {
      toast.error(errorText(e, t({
        ne: 'फाइल अपलोड हुन सकेन', en: 'Could not upload the file',
      })));
    } finally {
      setSending(false);
    }
  };

  const drop = async (one: Artifact) => {
    try {
      await apiClient.deleteResource(eventId, one.id);
      setShared((have) => have.filter((x) => x.id !== one.id));
    } catch (e: any) {
      toast.error(errorText(e, t({
        ne: 'हटाउन सकिएन', en: 'Could not remove it',
      })));
    }
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error(t({ ne: 'एजेन्डाको नाम लेख्नुहोस्', en: 'Give the agenda a name' }));
      return;
    }
    if (!startTime) {
      toast.error(t({ ne: 'सुरु हुने समय दिनुहोस्', en: 'Give it a start time' }));
      return;
    }
    // Who is speaking is not asked here any more: a speaker is a profile
    // written on its own step and put on the talks they give, so this
    // form writes the slot and leaves the person to that step.
    const written = {
      title: title.trim(),
      description: details.trim(),
      starts_at: new Date(`${onDay}T${startTime}`).toISOString(),
      duration_minutes: minutes,
    };

    try {
      setBusy(true);
      const saved = editing
        ? await apiClient.updateSession(session!.id, written)
        : await apiClient.createSession({ event: eventId, ...written });

      // Now there is something to file them against. A document that will
      // not go up does not undo the agenda item that was just written, so
      // it is said out loud rather than thrown.
      if (waiting.length > 0) {
        try {
          for (const file of waiting) {
            await apiClient.uploadResource(eventId, file, undefined, saved.id);
          }
        } catch (e: any) {
          toast.error(errorText(e, t({
            ne: 'एजेन्डा बच्यो, तर फाइल अपलोड हुन सकेन',
            en: 'The agenda was saved, but its files were not uploaded',
          })));
        }
      }

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

  const uploadLabel = t({ ne: '+ अपलोड', en: '+ Upload' });
  const anyFiles = shared.length > 0 || waiting.length > 0;

  /** One row in the list of documents: what it is, and what can be done. */
  const fileRow = (
    key: string,
    name: string,
    open: string | undefined,
    remove: () => void,
  ) => (
    <div
      key={key}
      className="bg-white border-[0.6px] border-line rounded-[12px] p-3
        flex items-center gap-3"
    >
      <FileBadge name={name} className="w-8 h-9 text-[9px] leading-[13.5px]" />
      <p className="flex-1 min-w-0 text-[14px] leading-5 font-medium text-[#1E2939] truncate">
        {name}
      </p>
      <div className="flex items-start gap-2 flex-none">
        {open && (
          <a
            href={open}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[12px] leading-4 text-[#155DFC] hover:underline"
          >
            {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
          </a>
        )}
        <button
          onClick={remove}
          className="text-[12px] leading-4 text-[#FB2C36] hover:underline"
        >
          {t({ ne: 'हटाउनुहोस्', en: 'Delete' })}
        </button>
      </div>
    </div>
  );

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
      <div className="agenda-dialog bg-white rounded-[12px] w-full max-w-[512px] max-h-[88vh] overflow-auto
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

          {(days?.length ?? 0) > 1 && (
            <div className="grid grid-cols-2 gap-3">
              <Row label={t({ ne: 'दिन छान्नुहोस्', en: 'Select Day' })}>
                <select
                  value={onDay}
                  onChange={(e) => setOnDay(e.target.value)}
                  className={`${BOX} bg-white`}
                >
                  {days!.map((one, i) => (
                    <option key={one} value={one}>
                      {t({ ne: `दिन ${num(i + 1)}`, en: `Day ${i + 1}` })}
                    </option>
                  ))}
                </select>
              </Row>
            </div>
          )}

          <Row label={t({ ne: 'एजेन्डाको विवरण', en: 'Agenda details' })}>
            <textarea
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t({
                ne: 'यो एजेन्डाबारे टिपोट थप्नुहोस्…',
                en: 'Add notes about this agenda...',
              })}
              className={`${BOX} leading-5`}
            />
          </Row>

          {/* What is handed out at this talk, filed against it rather
              than against the event at large. */}
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center justify-between w-full">
              <span className="text-[12px] leading-4">
                <span className="font-medium text-body">
                  {t({ ne: 'कार्यसूचीका कागजात', en: 'Agenda documents' })}
                </span>
                <span className="text-faint">
                  {t({
                    ne: ' — यो एजेन्डाका लागि वक्ताले दिएका',
                    en: ' — provided by the speaker for this agenda',
                  })}
                </span>
              </span>
              {anyFiles && (
                <button
                  onClick={() => picker.current?.click()}
                  disabled={sending}
                  className="text-[14px] leading-5 text-[#1A478B] underline
                    disabled:opacity-50"
                >
                  {sending ? t({ ne: 'पठाउँदै…', en: 'Uploading…' }) : uploadLabel}
                </button>
              )}
            </div>

            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              aria-label={t({ ne: 'कागजात छान्नुहोस्', en: 'Choose documents' })}
              onChange={(e) => {
                take(e.target.files);
                e.target.value = '';
              }}
            />

            <div className="w-full pt-2">
              <div className="bg-[#F9FAFB] border-[1.8px] border-dashed border-line
                rounded-[8px] px-2">
                {anyFiles ? (
                  <div className="flex flex-col gap-2 py-2">
                    {shared.map((one) => fileRow(
                      one.id, one.display_name, one.web_view_link, () => drop(one)
                    ))}
                    {/* Picked, but with nothing yet to file them against. */}
                    {waiting.map((file, at) => fileRow(
                      `waiting-${at}-${file.name}`,
                      file.name,
                      undefined,
                      () => setWaiting((held) => held.filter((_, i) => i !== at))
                    ))}
                  </div>
                ) : (
                  <div className="py-2 flex flex-col items-center">
                    <span className="bg-white w-9 h-9 rounded-full grid place-items-center">
                      <FigmaIcon name="fileUpload" size={15} />
                    </span>
                    <p className="pt-1 text-[14px] leading-5 text-subtle text-center">
                      {t({ ne: 'अझै फाइल छैन।', en: 'No files yet.' })}
                    </p>
                    <p className="pt-1 pb-1 text-[12px] leading-4 text-faint text-center">
                      {t({
                        ne: 'कार्यक्रममा सबैसँग बाँड्न स्रोत अपलोड गर्नुहोस्।',
                        en: 'Upload resources to share them with everyone in the event.',
                      })}
                    </p>
                    <button
                      onClick={() => picker.current?.click()}
                      disabled={sending}
                      className="agenda-upload-button bg-head text-white rounded-[8px] px-3 h-9
                        text-[14px] leading-5 disabled:opacity-50"
                    >
                      {sending ? t({ ne: 'पठाउँदै…', en: 'Uploading…' }) : uploadLabel}
                    </button>
                  </div>
                )}
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
                : t({ ne: 'एजेन्डा थप्नुहोस्', en: 'Add agenda' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
