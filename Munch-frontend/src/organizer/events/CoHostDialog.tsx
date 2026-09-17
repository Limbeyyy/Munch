import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Modal } from '../OrganizerShell';
import { Btn } from '../ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One labelled field, drawn the way the design draws them. */
export const Field: React.FC<{
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, required, hint, children }) => (
  <label className="block">
    <span className="block text-[13px] text-head mb-1.5">
      {label}
      {required && <span className="text-live"> *</span>}
      {hint && <span className="text-faint"> ({hint})</span>}
    </span>
    {children}
  </label>
);

/** The input every form on these screens uses. */
export const inputClass =
  'w-full bg-white border border-line rounded-[8px] px-3.5 py-2.5 text-[14px] text-head ' +
  'placeholder:text-faint focus:outline-none focus:border-navy-800';

/**
 * Put somebody beside the host for a whole event.
 *
 * The grant is made against an email address, because that is what the
 * person signs in with - a name typed here is only what the host is told
 * back, it is not what carries the role.
 */
export const CoHostDialog: React.FC<{
  eventId: string;
  onClose: () => void;
  onAdded: () => void;
}> = ({ eventId, onClose, onAdded }) => {
  const { t } = useOrganizer();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error(t({ ne: 'नाम लेख्नुहोस्', en: 'Give their name' }));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      toast.error(t({ ne: 'इमेल ठेगाना मिलेन', en: 'That email address does not look right' }));
      return;
    }
    try {
      setBusy(true);
      await apiClient.grantRole(eventId, {
        email: email.trim().toLowerCase(),
        role: 'co_host',
        scope: 'event',
      });
      toast.success(
        t({ ne: `${name.trim()} सह-आयोजक भए`, en: `${name.trim()} is now a co-host` })
      );
      onAdded();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'थप्न सकिएन', en: 'Could not add them' })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t({ ne: 'सह-आयोजक थप्नुहोस्', en: 'Add co-host' })}
      footer={
        <>
          <Btn className="flex-1" onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn className="flex-1" tone="solid" onClick={save} disabled={busy}>
            {busy
              ? t({ ne: 'थप्दै…', en: 'Adding…' })
              : t({ ne: 'सह-आयोजक थप्नुहोस्', en: 'Add co-host' })}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t({ ne: 'नाम', en: 'Name' })} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t({ ne: 'पूरा नाम', en: 'Full name' })}
            className={inputClass}
          />
        </Field>
        <Field label={t({ ne: 'इमेल', en: 'Email' })} required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className={inputClass}
          />
        </Field>
        <Field label={t({ ne: 'फोन', en: 'Phone' })} hint={t({ ne: 'वैकल्पिक', en: 'optional' })}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+977 98XXXXXXXX"
            className={inputClass}
          />
        </Field>
      </div>
    </Modal>
  );
};
