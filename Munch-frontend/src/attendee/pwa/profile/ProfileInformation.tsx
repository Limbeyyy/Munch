import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { useOrganizer } from '../../../organizer/i18n';
import { errorText } from '../../../organizer/errors';
import { SubHead } from './bits';

/** A readable name from whatever the account actually carries. */
export const nameOf = (user: {
  first_name?: string; last_name?: string; email?: string;
} | null) => {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email || '';
};

/** Split the one name somebody types back into the two the account keeps. */
const split = (whole: string) => {
  const parts = whole.trim().split(/\s+/);
  return {
    first_name: parts[0] ?? '',
    last_name: parts.slice(1).join(' '),
  };
};

/** A line that is read, not filled in. */
const Fixed: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-1 border-b-[0.65px] border-[#ccc] flex flex-col gap-1">
    <p className="py-0.5 capitalize text-[12px] leading-4 text-[#959595]">
      {label}
    </p>
    <p className="py-1 text-[14px] text-[#101010]">{value || '—'}</p>
  </div>
);

/**
 * Who the account says this is.
 *
 * The name and the picture are theirs to change. Google supplied both
 * at sign-in and this system has owned them since, so editing one here
 * touches nothing about the Google account - which is the point:
 * wanting a different photograph on your badge should not mean going
 * and changing your Google profile to get one.
 *
 * The address is not theirs to change. It is what the account is
 * identified by and what an invitation is matched against, so it is
 * read only here and the server refuses it as well.
 */
export const ProfileInformation: React.FC<{ onBack: () => void }> = ({
  onBack,
}) => {
  const { t } = useOrganizer();
  const { user, setUser } = useAuthStore();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(nameOf(user));
  /** The chosen file, and a local view of it, until it is sent. */
  const [picked, setPicked] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { setName(nameOf(user)); }, [user]);

  // Released when it is replaced or the screen goes, or every picture
  // somebody tries stays held in memory until the tab is closed.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const changed = picked !== null || name.trim() !== nameOf(user).trim();

  const choose = (file: File) => {
    setPicked(file);
    setPreview((was) => {
      if (was) URL.revokeObjectURL(was);
      return URL.createObjectURL(file);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      let saved = user;
      if (picked) saved = await apiClient.uploadAvatar(picked);
      if (name.trim() !== nameOf(user).trim()) {
        saved = await apiClient.updateProfile(split(name));
      }
      if (saved) setUser(saved);
      setPicked(null);
      setPreview((was) => { if (was) URL.revokeObjectURL(was); return null; });
      setEditing(false);
      toast.success(t({ ne: 'सुरक्षित भयो', en: 'Saved' }));
    } catch (e: any) {
      toast.error(errorText(e, t({
        ne: 'सुरक्षित भएन', en: 'That did not save',
      })));
    } finally {
      setSaving(false);
    }
  };

  const shown = preview ?? user?.avatar_url;
  const who = nameOf(user);

  return (
    <div className="bg-white min-h-full flex flex-col">
      <SubHead
        title={t({ ne: 'प्रोफाइल जानकारी', en: 'Profile Information' })}
        onBack={onBack}
      />

      <div className="py-4 flex justify-center">
        <div className="relative">
          <span className="size-[132px] rounded-full bg-[#f3f4f6] overflow-hidden
            grid place-items-center text-[44px] font-semibold text-[#12386e]
            block">
            {shown
              ? <img src={shown} alt="" className="w-full h-full object-cover" />
              : (who || '?').trim().charAt(0).toUpperCase()}
          </span>

          {editing && (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/*"
                aria-label={t({ ne: 'तस्बिर छान्नुहोस्', en: 'Choose a photo' })}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) choose(file);
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                aria-label={t({ ne: 'तस्बिर बदल्नुहोस्', en: 'Change photo' })}
                className="absolute bottom-1 right-1 size-9 rounded-full
                  bg-[#12386e] border-2 border-white grid place-items-center
                  text-white"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden>
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      <section className="px-4 pt-5 pb-2 flex flex-col gap-3">
        <h2 className="text-[14px] font-medium uppercase text-[#94a3b8]
          leading-[16.5px]">
          {t({ ne: 'व्यक्तिगत जानकारी', en: 'Personal information' })}
        </h2>

        {editing ? (
          <div className="px-3 py-1 border-b-[0.65px] border-[#ccc]
            flex flex-col gap-1">
            <label
              htmlFor="manch-full-name"
              className="py-0.5 capitalize text-[12px] leading-4 text-[#959595]"
            >
              {t({ ne: 'पूरा नाम', en: 'Full Name' })}
            </label>
            <input
              id="manch-full-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="py-1 text-[14px] text-[#101010] bg-transparent
                outline-none"
            />
          </div>
        ) : (
          <Fixed label={t({ ne: 'पूरा नाम', en: 'Full Name' })} value={who} />
        )}

        {/* Never editable, here or on the server. */}
        <Fixed
          label={t({ ne: 'इमेल ठेगाना', en: 'Email address' })}
          value={user?.email ?? ''}
        />

        <p className="pt-1 text-[13px] leading-[20.8px] text-[#94a3b8]">
          {t({
            ne: 'इमेल ठेगाना तपाईंको खाता हो, त्यसैले यहाँ बदल्न मिल्दैन। नाम र तस्बिर तपाईंकै हुन्।',
            en: 'Your email address is what the account is, so it cannot be'
              + ' changed here. The name and photo are yours to set.',
          })}
        </p>
      </section>

      <div className="flex-1" />

      <div className="px-4 pb-8 pt-4 flex justify-center">
        {/* One button, saying what pressing it does now: start editing,
            or keep what has been changed. */}
        <button
          type="button"
          disabled={saving || (editing && !changed)}
          onClick={() => (editing ? save() : setEditing(true))}
          className="w-[231px] max-w-full bg-[#12386e] text-white rounded-[12px]
            px-6 py-3 text-[16px] leading-6 disabled:opacity-50"
        >
          {saving
            ? t({ ne: 'सुरक्षित गर्दै…', en: 'Saving…' })
            : editing
              ? t({ ne: 'परिवर्तन सुरक्षित गर्नुहोस्', en: 'Save Changes' })
              : t({ ne: 'प्रोफाइल सम्पादन', en: 'Edit Profile' })}
        </button>
      </div>
    </div>
  );
};
