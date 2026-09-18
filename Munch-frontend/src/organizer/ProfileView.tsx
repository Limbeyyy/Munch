import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ProfileSummary } from '../types';
import { errorText } from './errors';
import { Pair, useOrganizer } from './i18n';
import { Chip, Empty } from './ui';

/** The sheet every settings page is laid on. */
export const SettingsSheet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white border border-line-soft rounded-[12px] px-5 sm:px-8 py-5
    flex flex-col gap-8">
    {children}
  </div>
);

/** A page's name and what it is for, at the top of the sheet. */
export const SettingsHeading: React.FC<{ title: Pair; lede: Pair }> = ({ title, lede }) => {
  const { t } = useOrganizer();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[24px] font-medium text-[#030712] leading-[1.2]">{t(title)}</h1>
      <p className="text-[14px] text-[#4a5567] leading-[1.5]">{t(lede)}</p>
    </div>
  );
};

/** The small bold heading over each block. */
export const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-[16px] font-semibold text-head leading-5">{children}</h2>
);

/** The bordered card each block's contents sit in. */
export const SectionCard: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className = '', children }) => (
  <div className={`bg-white border-[0.6px] border-line rounded-[12px] ${className}`}>
    {children}
  </div>
);

/** One row of a two-column list: a quiet label, and the answer. */
export const FactRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label, children,
}) => (
  <div className="flex items-start justify-between gap-4 px-5 py-3
    border-b-[0.6px] border-[#f3f4f6] last:border-0">
    <span className="text-[14px] text-subtle leading-5">{label}</span>
    <span className="text-[14px] text-[#364153] leading-5 text-right min-w-0">
      {children}
    </span>
  </div>
);

/** A field on the form: a small label over a bordered box. */
const Field: React.FC<{
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

const BOX =
  'w-full border-[0.6px] border-line rounded-[8px] px-3 py-2 text-[14px] text-head '
  + 'leading-5 placeholder:text-black/40 focus:outline-none focus:border-navy-800 '
  + 'disabled:bg-[#f9fafb] disabled:text-subtle';

/** The initials the avatar falls back to, where there is no photograph. */
const initialsOf = (name: string, email: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? email).slice(0, 2).toUpperCase();
};

/**
 * Who somebody is here.
 *
 * The details are theirs to write: how to reach them, what they do, and
 * who they do it for. The address is not among them - it is what the
 * account is, and what Google signed them in as - so it is shown and not
 * asked for.
 */
export const ProfileView: React.FC<{ onNavigate?: (view: string) => void }> = () => {
  const { t } = useOrganizer();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [organization, setOrganization] = useState('');

  const load = useCallback(async () => {
    try {
      const summary = await apiClient.getProfileSummary();
      setProfile(summary);
      setName(summary.user.name ?? '');
      setPhone(summary.user.phone ?? '');
      setPosition(summary.user.position ?? '');
      setOrganization(summary.user.organization_name ?? '');
    } catch {
      toast.error(t({ ne: 'विवरण ल्याउन सकिएन', en: 'Could not load your details' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }
  if (!profile) {
    return (
      <SettingsSheet>
        <Empty>{t({ ne: 'विवरण उपलब्ध छैन।', en: 'Nothing to show.' })}</Empty>
      </SettingsSheet>
    );
  }

  const { user } = profile;

  /** Everything on the form, against what the server last sent back. */
  const changed =
    name.trim() !== (user.name ?? '').trim()
    || phone.trim() !== (user.phone ?? '')
    || position.trim() !== (user.position ?? '')
    || organization.trim() !== (user.organization_name ?? '');

  const save = async () => {
    if (!name.trim()) {
      toast.error(t({ ne: 'नाम लेख्नुहोस्', en: 'Give your name' }));
      return;
    }
    // One field on the form, two on the account: the first word is the
    // given name and whatever follows is the rest of it.
    const parts = name.trim().split(/\s+/);
    try {
      setSaving(true);
      await apiClient.updateProfile({
        first_name: parts[0],
        last_name: parts.slice(1).join(' '),
        phone: phone.trim(),
        position: position.trim(),
        organization_name: organization.trim(),
      });
      toast.success(t({ ne: 'प्रोफाइल बचत भयो', en: 'Profile saved' }));
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बचत गर्न सकिएन', en: 'Could not save it' })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSheet>
      <SettingsHeading
        title={{ ne: 'प्रोफाइल', en: 'Profile' }}
        lede={{
          ne: 'आफ्नो व्यक्तिगत विवरण व्यवस्थापन गर्नुहोस्।',
          en: 'Manage your personal information.',
        }}
      />

      <div className="flex flex-col gap-4 max-w-[906px] w-full">
        {/* Who you are, before any of it is asked for again. */}
        <SectionCard className="p-4 flex flex-col gap-4">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <span className="w-16 h-16 rounded-full bg-head text-white grid place-items-center
              text-[20px] font-semibold leading-7">
              {initialsOf(user.name ?? '', user.email)}
            </span>
          )}
          <div className="flex flex-col">
            <p className="text-[14px] font-medium text-[#1E2939] leading-5">
              {user.name || user.email}
            </p>
            {user.position && (
              <p className="text-[12px] text-subtle leading-4">{user.position}</p>
            )}
            <p className="text-[12px] text-subtle leading-4 pt-1 flex items-center gap-2">
              {user.signed_in_with_google
                ? t({ ne: 'गुगलबाट साइन इन', en: 'Signed in with Google' })
                : t({ ne: 'इमेलबाट साइन इन', en: 'Signed in with email' })}
              {user.is_verified && (
                <Chip tone="ok">{t({ ne: 'प्रमाणित', en: 'Verified' })}</Chip>
              )}
            </p>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionHeading>
            {t({ ne: 'प्रोफाइलको विवरण', en: 'Profile information' })}
          </SectionHeading>

          <SectionCard className="p-5 flex flex-col gap-4">
            <div className="grid gap-10 sm:grid-cols-2">
              <Field label={t({ ne: 'पूरा नाम', en: 'Full name' })} required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={BOX}
                />
              </Field>
              {/* Shown rather than asked for: the address is what the
                  account is, and the server will not take another. */}
              <Field label={t({ ne: 'इमेल', en: 'Email' })} required>
                <input value={user.email} disabled className={BOX} />
              </Field>
            </div>

            <div className="grid gap-10 sm:grid-cols-2">
              <Field label={t({ ne: 'फोन नम्बर', en: 'Phone number' })}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+977 9801234567"
                  className={BOX}
                />
              </Field>
              <Field label={t({ ne: 'पद', en: 'Position' })}>
                <input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder={t({
                    ne: 'निर्देशक, आपतकालीन सेवा',
                    en: 'Director, Emergency Services',
                  })}
                  className={BOX}
                />
              </Field>
            </div>

            <div className="sm:max-w-[567px]">
              <Field label={t({ ne: 'संस्था', en: 'Organization' })}>
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder={t({
                    ne: 'आपतकालीन सेवा विभाग',
                    en: 'Emergency Service Department',
                  })}
                  className={BOX}
                />
              </Field>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={save}
                disabled={saving || !changed}
                className="rounded-[8px] px-4 py-2 text-[14px] font-medium leading-5 text-white
                  bg-navy-800 hover:bg-navy-700 disabled:bg-[#e1e1e1] disabled:hover:bg-[#e1e1e1]"
              >
                {saving
                  ? t({ ne: 'बचत गर्दै…', en: 'Saving…' })
                  : t({ ne: 'परिवर्तन बचत', en: 'Save changes' })}
              </button>
            </div>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t({ ne: 'खाताको विवरण', en: 'Account Information' })}
          </SectionHeading>
          <SectionCard>
            <FactRow label={t({ ne: 'खाता खुलेको', en: 'Account created' })}>
              {new Date(user.joined).toLocaleDateString(undefined, {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </FactRow>
            <FactRow label={t({ ne: 'खाता आईडी', en: 'Account ID' })}>
              <span className="font-mono text-faint break-all">{user.id}</span>
            </FactRow>
            <FactRow label={t({ ne: 'समय क्षेत्र', en: 'Timezone' })}>
              {user.timezone}
            </FactRow>
          </SectionCard>
        </div>
      </div>
    </SettingsSheet>
  );
};
