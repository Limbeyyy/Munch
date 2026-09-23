import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, Session, Speaker } from '../../types';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Modal } from '../OrganizerShell';
import { Btn } from '../ui';
import { PlusGlyph } from './chrome';

/**
 * The speakers of one event, as profiles.
 *
 * A speaker used to be four strings written onto each talk, which is
 * enough to print a running order and nothing else: somebody speaking
 * twice was two unrelated sets of strings, and their photograph had
 * nowhere to live. A profile is written once here and put on whichever
 * talks they give.
 */

/**
 * A face, or the letter that stands in for one.
 *
 * Sized either by a pixel measurement, for the round ones beside a name,
 * or by a class, for the square one filling the top of a card. The two
 * are the same thing at different shapes, and two components would have
 * meant a speaker with no photograph looking different in each.
 */
export const SpeakerFace: React.FC<{
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}> = ({ name, src, size, className }) => (
  <span
    className={`bg-[#fbecd1] grid place-items-center flex-none text-navy-900
      font-semibold overflow-hidden ${className ?? 'rounded-full'}`}
    style={size
      ? { width: size, height: size, fontSize: Math.round(size / 2.6) }
      : undefined}
  >
    {src
      ? <img src={src} alt="" className="w-full h-full object-cover" />
      : (name || '?').trim().charAt(0).toUpperCase()}
  </span>
);

const AddSpeakerDialog: React.FC<{
  eventId: string;
  sessions: Session[];
  speaker?: Speaker | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}> = ({ eventId, sessions, speaker, onClose, onSaved }) => {
  const { t } = useOrganizer();
  const [name, setName] = useState(speaker?.full_name ?? '');
  const [position, setPosition] = useState(speaker?.position ?? '');
  const [organization, setOrganization] = useState(speaker?.organization ?? '');
  const [linkedin, setLinkedin] = useState(speaker?.linkedin_url ?? '');
  const [website, setWebsite] = useState(speaker?.website_url ?? '');
  const [chosen, setChosen] = useState<string[]>(
    speaker?.sessions.map((one) => one.id) ?? []
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(
    speaker?.photo_url ?? null
  );
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // The chosen file only exists in the browser until it is sent, so the
  // preview is an object URL that has to be given back afterwards.
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const save = async () => {
    const said = name.trim();
    if (!said) {
      toast.error(t({ ne: 'वक्ताको नाम चाहिन्छ', en: "The speaker's name is needed" }));
      return;
    }
    setBusy(true);
    try {
      const draft = {
        full_name: said,
        position: position.trim(),
        organization: organization.trim(),
        linkedin_url: linkedin.trim(),
        website_url: website.trim(),
        session_ids: chosen,
      };
      if (speaker) {
        await apiClient.updateSpeaker(eventId, speaker.id, draft, photo);
      } else {
        await apiClient.createSpeaker(eventId, draft, photo);
      }
      toast.success(
        speaker
          ? t({ ne: 'वक्ता अद्यावधिक भयो', en: 'Speaker updated' })
          : t({ ne: 'वक्ता थपियो', en: 'Speaker added' })
      );
      onClose();
      await onSaved();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सेभ भएन', en: 'Could not save them' })));
    } finally {
      setBusy(false);
    }
  };

  const label = 'block text-[12.5px] text-subtle mb-1.5';
  const field = `w-full border border-line rounded-[8px] px-3 py-2.5 text-[14px]
    text-head placeholder:text-faint bg-white`;

  return (
    <Modal
      open
      onClose={onClose}
      title={speaker
        ? t({ ne: 'वक्ता सम्पादन', en: 'Edit speaker' })
        : t({ ne: 'वक्ता थप्नुहोस्', en: 'Add speaker' })}
      divided
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="border border-line rounded-[8px] px-4 py-2 text-[14px]
              text-head bg-white hover:border-navy-800 disabled:opacity-50"
          >
            {t({ ne: 'रद्द', en: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="bg-navy-800 rounded-[8px] px-4 py-2 text-[14px]
              font-medium text-white hover:bg-navy-900 disabled:opacity-50"
          >
            {busy
              ? t({ ne: 'सेभ हुँदै…', en: 'Saving…' })
              : speaker
              ? t({ ne: 'सेभ', en: 'Save' })
              : t({ ne: 'वक्ता थप्नुहोस्', en: 'Add Speaker' })}
          </button>
        </>
      }
    >
      <h4 className="text-[16px] font-medium text-head">
        {t({ ne: 'परिचय', en: 'Profile' })}
      </h4>
      <p className="text-[13px] text-subtle mb-4">
        {t({
          ne: 'यो वक्तासँगै देखिने आधारभूत जानकारी।',
          en: 'Basic information shown with this speaker.',
        })}
      </p>

      <div className="flex items-center gap-4 mb-4">
        <SpeakerFace
          name={name}
          src={preview}
          size={72}
          className="rounded-[12px]"
        />
        <div>
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png"
            aria-label={t({ ne: 'तस्बिर छान्नुहोस्', en: 'Choose a photo' })}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              // Refused here as well as on the server, so the answer is
              // immediate rather than after the upload.
              if (file && file.size > 5 * 1024 * 1024) {
                toast.error(t({
                  ne: 'तस्बिर ५ MB भन्दा ठूलो छ',
                  en: 'That photo is larger than 5 MB',
                }));
                e.target.value = '';
                return;
              }
              setPhoto(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="border border-line rounded-[8px] px-3 py-2 flex gap-2
              items-center text-[14px] font-medium text-head bg-white
              hover:border-navy-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 16V4M12 4L7 9M12 4l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t({ ne: 'तस्बिर राख्नुहोस्', en: 'Upload photo' })}
          </button>
          <p className="pt-1.5 text-[12.5px] text-faint">
            {t({ ne: 'JPG वा PNG, ५ MB सम्म', en: 'JPG or PNG, up to 5 MB' })}
          </p>
        </div>
      </div>

      <label htmlFor="manch-speaker-name" className={label}>
        {t({ ne: 'वक्ताको नाम', en: "Speaker's name" })}{' '}
        <span className="text-[#e12121]">*</span>
      </label>
      <input
        id="manch-speaker-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t({ ne: 'सुमिन महर्जन', en: 'Sumin Maharjan' })}
        className={field}
      />

      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        <div>
          <label htmlFor="manch-speaker-position" className={label}>
            {t({ ne: 'पद', en: 'Position' })}
          </label>
          <input
            id="manch-speaker-position"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder={t({ ne: 'इन्जिनियरिङ प्रमुख', en: 'VP of Engineering' })}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="manch-speaker-org" className={label}>
            {t({ ne: 'संस्था', en: 'Company / Organization' })}
          </label>
          <input
            id="manch-speaker-org"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder={t({ ne: 'प्रिक्सा टेक्नोलोजिज', en: 'Prixa Technologies' })}
            className={field}
          />
        </div>
      </div>

      <h4 className="text-[16px] font-medium text-head mt-6">
        {t({ ne: 'बाहिरी लिङ्क', en: 'External Links' })}
      </h4>
      <p className="text-[13px] text-subtle mb-3">
        {t({ ne: 'ऐच्छिक व्यावसायिक लिङ्क।', en: 'Optional professional links.' })}
      </p>

      <label htmlFor="manch-speaker-linkedin" className={label}>LinkedIn</label>
      <input
        id="manch-speaker-linkedin"
        value={linkedin}
        onChange={(e) => setLinkedin(e.target.value)}
        placeholder="linkedin.com/in/…"
        className={field}
      />

      <label htmlFor="manch-speaker-website" className={`${label} mt-4`}>
        {t({ ne: 'वेबसाइट', en: 'Website' })}
      </label>
      <input
        id="manch-speaker-website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="https://…"
        className={field}
      />

      <h4 className="text-[16px] font-medium text-head mt-6">
        {t({ ne: 'कार्यसूचीमा राख्नुहोस्', en: 'Assign to agenda' })}
      </h4>
      <p className="text-[13px] text-subtle mb-3">
        {t({
          ne: 'एक वा बढी सत्र छान्नुहोस्। यो ऐच्छिक हो।',
          en: 'Select one or more sessions. This is optional.',
        })}
      </p>

      {sessions.length === 0 ? (
        <p className="text-[13px] text-faint">
          {t({
            ne: 'अझै कुनै कार्यसूची छैन — पछि पनि राख्न सकिन्छ।',
            en: 'No agendas yet — they can be assigned later.',
          })}
        </p>
      ) : (
        <div className="border border-line rounded-[8px] divide-y divide-line">
          {sessions.map((one) => (
            <label
              key={one.id}
              className="flex gap-2.5 items-center px-3 py-2.5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={chosen.includes(one.id)}
                onChange={(e) => setChosen((was) => (
                  e.target.checked
                    ? [...was, one.id]
                    : was.filter((id) => id !== one.id)
                ))}
              />
              <span className="text-[14px] text-head">{one.title}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
};

export const SpeakersStep: React.FC<{
  event: Event;
  sessions: Session[];
  onChanged: () => Promise<void> | void;
}> = ({ event, sessions, onChanged }) => {
  const { t } = useOrganizer();
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Speaker | null>(null);

  const load = useCallback(async () => {
    try {
      setSpeakers(await apiClient.getSpeakers(event.id));
    } catch {
      setSpeakers([]);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const remove = async (one: Speaker) => {
    const sure = window.confirm(t({
      ne: `“${one.full_name}” हटाउने? सत्रमा नाम रहनेछ।`,
      en: `Remove “${one.full_name}”? The agendas keep their name.`,
    }));
    if (!sure) return;
    try {
      await apiClient.deleteSpeaker(event.id, one.id);
      toast.success(t({ ne: 'हटाइयो', en: 'Removed' }));
      await load();
      await onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove them' })));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[20px] font-medium text-head">
            {t({ ne: 'वक्ताहरू', en: 'Speakers' })}
          </h2>
          <p className="text-[14px] text-body mt-1">
            {t({
              ne: 'वक्ताको परिचय थप्नुहोस् र एक वा बढी सत्रमा राख्नुहोस्।',
              en: 'Add speaker profiles and assign them to one or more sessions.',
            })}
          </p>
        </div>
        <Btn
          tone="solid"
          className="px-5 py-3 text-[16px]"
          onClick={() => setAdding(true)}
        >
          <PlusGlyph />
          {t({ ne: 'वक्ता थप्नुहोस्', en: 'Add Speaker' })}
        </Btn>
      </div>

      {speakers.length === 0 ? (
        <p className="text-[14px] text-subtle">
          {t({
            ne: 'अझै कुनै वक्ता छैन।',
            en: 'No speakers yet.',
          })}
        </p>
      ) : (
        <div className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
          {speakers.map((one) => (
            <article
              key={one.id}
              className="bg-white border-[0.6px] border-line rounded-[12px] p-4
                flex flex-col
                shadow-[0px_4px_3px_rgba(0,0,0,0.04),0px_2px_2px_rgba(0,0,0,0.03)]"
            >
              <div className="relative">
                <SpeakerFace
                  name={one.full_name}
                  src={one.photo_url}
                  className="rounded-[8px] w-full aspect-square text-[36px]"
                />
                <span className="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(one)}
                    aria-label={t({
                      ne: `${one.full_name} सम्पादन`,
                      en: `Edit ${one.full_name}`,
                    })}
                    className="bg-navy-800 text-white rounded-full size-6 grid
                      place-items-center text-[12px]"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(one)}
                    aria-label={t({
                      ne: `${one.full_name} हटाउनुहोस्`,
                      en: `Remove ${one.full_name}`,
                    })}
                    className="bg-white border border-line text-[#d81313]
                      rounded-full size-6 grid place-items-center text-[12px]"
                  >
                    ×
                  </button>
                </span>
              </div>

              <p className="pt-3 text-[14px] font-medium text-head text-center">
                {one.full_name}
              </p>
              {one.position && (
                <p className="text-[12px] text-[#c2410c] text-center">
                  {one.position}
                </p>
              )}
              {one.organization && (
                <p className="text-[12px] text-subtle text-center">
                  {one.organization}
                </p>
              )}

              <p className="mt-3 bg-[#f3f4f6] rounded-[6px] px-2 py-1 text-[11px]
                text-subtle text-center truncate">
                {one.sessions.length === 0
                  ? t({ ne: 'कुनै कार्यसूची छैन', en: 'No agenda assigned' })
                  : one.sessions.map((s) => s.title).join(', ')}
              </p>
            </article>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <AddSpeakerDialog
          eventId={event.id}
          sessions={sessions}
          speaker={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={async () => { await load(); await onChanged(); }}
        />
      )}
    </div>
  );
};
