import React from 'react';
import { useAuthStore } from '../../../store/authStore';
import { useOrganizer } from '../../../organizer/i18n';
import { SubHead } from './bits';

/** A readable name from whatever the account actually carries. */
export const nameOf = (user: {
  first_name?: string; last_name?: string; email?: string;
} | null) => {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email || '';
};

/** A line that is read, not filled in. */
const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-1 border-b-[0.65px] border-[#ccc]
    flex flex-col gap-1">
    <p className="py-0.5 capitalize text-[12px] leading-4 text-[#959595]">
      {label}
    </p>
    <p className="py-1 text-[14px] text-[#101010]">{value || '—'}</p>
  </div>
);

/**
 * Who the account says this is.
 *
 * Read only, and not because the form was not built: the name and the
 * address come from the Google account this person signed in with, and
 * a field here that let them be edited would either be overwritten on
 * the next sign-in or quietly disagree with the account they are
 * signed in as. The place to change them is Google.
 */
export const ProfileInformation: React.FC<{ onBack: () => void }> = ({
  onBack,
}) => {
  const { t } = useOrganizer();
  const { user } = useAuthStore();
  const who = nameOf(user);
  const photo = user?.avatar_url;

  return (
    <div className="bg-white min-h-full">
      <SubHead
        title={t({ ne: 'प्रोफाइल जानकारी', en: 'Profile Information' })}
        onBack={onBack}
      />

      <div className="py-4 flex justify-center">
        <span className="size-[132px] rounded-full bg-[#f3f4f6] overflow-hidden
          grid place-items-center text-[44px] font-semibold text-[#12386e]">
          {photo
            ? <img src={photo} alt="" className="w-full h-full object-cover" />
            : (who || '?').trim().charAt(0).toUpperCase()}
        </span>
      </div>

      <section className="px-4 pt-5 pb-2 flex flex-col gap-3">
        <h2 className="text-[14px] font-medium uppercase text-[#94a3b8]
          leading-[16.5px]">
          {t({ ne: 'व्यक्तिगत जानकारी', en: 'Personal information' })}
        </h2>

        <Field label={t({ ne: 'पूरा नाम', en: 'Full Name' })} value={who} />
        <Field
          label={t({ ne: 'इमेल ठेगाना', en: 'Email address' })}
          value={user?.email ?? ''}
        />

        <p className="pt-2 text-[13px] leading-[20.8px] text-[#94a3b8]">
          {t({
            ne: 'यी तपाईंले साइन इन गर्नुभएको Google खाताबाट आउँछन्, त्यसैले यहाँ परिवर्तन गर्न मिल्दैन।',
            en: 'These come from the Google account you signed in with, so they'
              + ' cannot be changed here.',
          })}
        </p>
      </section>
    </div>
  );
};
