import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Session, SpeakerContact } from '../types';
import { useOrganizer } from '../organizer/i18n';
import { Btn, Chip } from '../organizer/ui';
import { Modal } from '../organizer/OrganizerShell';

interface Props {
  session: Session;
  /** Rendered small enough to sit inside a card. */
  compact?: boolean;
}

/**
 * Reaching a speaker after the event.
 *
 * A speaker listed publicly can simply be contacted once their session is
 * over. A private one is reached through the host, who decides which
 * requests to pass on - so the same place shows an ask, then a wait, then
 * the details.
 */
export const SpeakerContactButton: React.FC<Props> = ({ session, compact }) => {
  const { t } = useOrganizer();
  const [contact, setContact] = useState<SpeakerContact | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setContact(await apiClient.getSpeakerContact(session.id));
    } catch {
      // Not everyone may ask about every session; stay quiet about it.
    }
  }, [session.id]);

  useEffect(() => { load(); }, [load]);

  if (!contact || !session.speaker_name) return null;

  const send = async () => {
    try {
      setBusy(true);
      await apiClient.requestSpeakerContact(session.id, reason.trim());
      toast.success(
        t({
          ne: 'अनुरोध आयोजककहाँ पुग्यो',
          en: 'Your request has gone to the organizer',
        })
      );
      setAsking(false);
      setReason('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'पठाउन सकिएन', en: 'Could not send it' }));
    } finally { setBusy(false); }
  };

  // Ready to be read.
  if (contact.released) {
    return (
      <>
        <Btn sm={compact} tone="solid" onClick={() => setOpen(true)}>
          {t({ ne: 'सम्पर्क हेर्नुहोस्', en: 'Show contact' })}
        </Btn>

        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={contact.speaker_name}
          lede={session.title}
          footer={<Btn tone="solid" onClick={() => setOpen(false)}>{t({ ne: 'बन्द', en: 'Close' })}</Btn>}
        >
          <div className="flex flex-col gap-2.5">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-3 bg-cream rounded-[10px] px-3.5 py-3 hover:bg-cream-200"
              >
                <span className="text-[#6E7C8E] text-[12.5px] w-14 flex-none">
                  {t({ ne: 'इमेल', en: 'Email' })}
                </span>
                <span className="text-[14px] text-navy-700 underline underline-offset-4 break-all">
                  {contact.email}
                </span>
              </a>
            )}
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                className="flex items-center gap-3 bg-cream rounded-[10px] px-3.5 py-3 hover:bg-cream-200"
              >
                <span className="text-[#6E7C8E] text-[12.5px] w-14 flex-none">
                  {t({ ne: 'फोन', en: 'Phone' })}
                </span>
                <span className="text-[14px] text-navy-700 underline underline-offset-4">
                  {contact.phone}
                </span>
              </a>
            )}
            <p className="text-[12px] text-[#6E7C8E] mt-1">
              {contact.visibility === 'public'
                ? t({
                    ne: 'यी विवरण वक्ताले सार्वजनिक रूपमै राख्न स्वीकारेका हुन्।',
                    en: 'The speaker agreed to these being listed openly.',
                  })
                : t({
                    ne: 'आयोजकले तपाईंको अनुरोध स्वीकृत गरेकाले देखिएको — कृपया अरूसँग नबाँड्नुहोस्।',
                    en: 'Shown because the organizer approved your request. Please keep it to yourself.',
                  })}
            </p>
          </div>
        </Modal>
      </>
    );
  }

  // Public, but the talk has not finished.
  if (contact.visibility === 'public') {
    return (
      <Chip tone="draft">
        {t({ ne: 'सत्रपछि सम्पर्क खुल्छ', en: 'Contact opens after the session' })}
      </Chip>
    );
  }

  // Private, and already asked.
  if (contact.request_status === 'pending') {
    return <Chip tone="warn">{t({ ne: 'अनुरोध पर्खिँदै', en: 'Request pending' })}</Chip>;
  }
  if (contact.request_status === 'declined') {
    return <Chip tone="draft">{t({ ne: 'अनुरोध अस्वीकृत', en: 'Request declined' })}</Chip>;
  }
  if (contact.request_status === 'approved') {
    return (
      <Chip tone="ok">
        {t({ ne: 'स्वीकृत — सत्रपछि खुल्छ', en: 'Approved — opens after the session' })}
      </Chip>
    );
  }

  // Private, not asked yet.
  return (
    <>
      <Btn sm={compact} onClick={() => setAsking(true)}>
        {t({ ne: 'सम्पर्क अनुरोध', en: 'Request contact' })}
      </Btn>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title={t({ ne: 'सम्पर्क अनुरोध', en: 'Request contact' })}
        lede={t({
          ne: `${contact.speaker_name} का विवरण आयोजकले हेरेर मात्र पठाउँछन्।`,
          en: `${contact.speaker_name}'s details are passed on by the organizer, not given out automatically.`,
        })}
        footer={
          <>
            <Btn onClick={() => setAsking(false)}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
            <Btn tone="amber" onClick={send} disabled={busy}>
              {busy ? t({ ne: 'पठाउँदै…', en: 'Sending…' }) : t({ ne: 'पठाउनुहोस्', en: 'Send request' })}
            </Btn>
          </>
        }
      >
        <label className="block text-[12px] text-[#6E7C8E] mb-1">
          {t({ ne: 'किन सम्पर्क गर्न खोज्नुभएको?', en: 'Why would you like to get in touch?' })}
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t({
            ne: 'जस्तै: बजेटका अंकबारे थप सोध्नु थियो।',
            en: 'For example: I had a follow-up question about the budget figures.',
          })}
          className="w-full border border-navy-800/15 rounded-[10px] px-3 py-2 text-[14px]"
        />
        <p className="text-[12px] text-[#6E7C8E] mt-1.5">
          {t({
            ne: 'आयोजकले यही पढेर निर्णय गर्छन्, त्यसैले छोटो भए पनि स्पष्ट लेख्नुहोस्।',
            en: 'This is what the organizer judges the request on, so a line or two helps.',
          })}
        </p>
      </Modal>
    </>
  );
};
