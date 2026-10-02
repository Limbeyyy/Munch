import React, { useState } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { useOrganizer } from '../../../organizer/i18n';
import { Block, Row, Tile } from './bits';
import { ProfileInformation, nameOf } from './ProfileInformation';
import { NotificationSettings } from './NotificationSettings';
import { Appearance } from './Appearance';
import { TextSize } from './TextSize';
import { LanguageSettings } from './LanguageSettings';

type Page = 'list' | 'profile' | 'notifications' | 'appearance' | 'text'
  | 'language';

const ICON = {
  person: <><circle cx="12" cy="8.5" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0113 0" /></>,
  bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.5a2.5 2.5 0 114.2 2.1c-.9.7-1.8 1.2-1.8 2.4M12 17.3h.01" /></>,
  chat: <path d="M20 14a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2h12a2 2 0 012 2z" />,
  doc: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>,
};

const Icon: React.FC<{ of: keyof typeof ICON }> = ({ of }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden>
    {ICON[of]}
  </svg>
);

/**
 * Who this is, and everything about the app that is theirs to set.
 *
 * A list rather than a page of controls: each thing worth changing is
 * a question with more than two answers, and answering it on its own
 * screen leaves room to say what each answer means. The list only has
 * to say what the current answer is.
 */
export const Settings: React.FC<{
  onSubpageChange?: (isOpen: boolean) => void;
}> = ({ onSubpageChange }) => {
  const { t, lang, look } = useOrganizer();
  const { user, logout } = useAuthStore();
  const [at, setAt] = useState<Page>('list');
  const navigate = (page: Page) => {
    setAt(page);
    onSubpageChange?.(page !== 'list');
  };

  const who = nameOf(user);
  const photo = user?.avatar_url;

  if (at === 'profile') return <ProfileInformation onBack={() => navigate('list')} />;
  if (at === 'notifications') {
    return <NotificationSettings onBack={() => navigate('list')} />;
  }
  if (at === 'appearance') return <Appearance onBack={() => navigate('list')} />;
  if (at === 'text') return <TextSize onBack={() => navigate('list')} />;
  if (at === 'language') return <LanguageSettings onBack={() => navigate('list')} />;

  const themeName = {
    system: t({ ne: 'यन्त्र अनुसार', en: 'System' }),
    light: t({ ne: 'उज्यालो', en: 'Light' }),
    dark: t({ ne: 'अँध्यारो', en: 'Dark' }),
    contrast: t({ ne: 'उच्च व्यतिरेक', en: 'High contrast' }),
  }[look.theme];

  const sizeName = {
    small: t({ ne: 'सानो', en: 'Small' }),
    default: t({ ne: 'सामान्य', en: 'Default' }),
    large: t({ ne: 'ठूलो', en: 'Large' }),
    xlarge: t({ ne: 'धेरै ठूलो', en: 'Extra large' }),
  }[look.textSize];

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <header
        className="bg-white px-4 pt-3 pb-2 border-b-[0.72px] border-[#b3b3b3]"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <h1 className="text-[16px] font-semibold text-[#101828] leading-[27px]
          pt-4 text-center">
          {t({ ne: 'प्रोफाइल र सेटिङ', en: 'Profile and Settings' })}
        </h1>
      </header>

      <div className="flex flex-col gap-1.5">
        <div className="bg-white px-4 py-2">
          <div
            className="rounded-[16px] overflow-hidden px-4 py-2 flex gap-4
              items-center shadow-[0_4px_16px_rgba(37,99,235,.25),0_1px_3px_rgba(15,23,42,.2)]"
            style={{
              backgroundImage: 'linear-gradient(167.7deg,'
                + ' rgb(15,23,42) 0%, rgb(30,58,138) 60%, rgb(37,99,235) 100%)',
            }}
          >
            <span className="size-[60px] rounded-full bg-[#f3f4f6] overflow-hidden
              grid place-items-center flex-none text-[22px] font-semibold
              text-[#12386e]">
              {photo
                ? <img src={photo} alt="" className="w-full h-full object-cover" />
                : (who || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-bold leading-[25.5px] text-white
                truncate">
                {who}
              </p>
              <p className="text-[13px] leading-[19.5px] text-[#dedede] truncate">
                {user?.email}
              </p>
              <span className="mt-1 inline-block bg-[#eff6ff] text-[#2563eb]
                rounded-[12px] px-2 py-0.5 text-[11px] font-semibold
                leading-[16.5px]">
                {t({ ne: 'सहभागी', en: 'Attendee' })}
              </span>
            </div>
          </div>
        </div>

        <Block label={t({ ne: 'खाता र सुरक्षा', en: 'Account & Security' })}>
          <Row
            lead={<Tile><Icon of="person" /></Tile>}
            title={t({ ne: 'प्रोफाइल जानकारी', en: 'Profile information' })}
            last
            onGo={() => navigate('profile')}
          />
        </Block>

        <Block label={t({ ne: 'एपका प्राथमिकता', en: 'App Preferences' })}>
          <Row
            lead={<Tile><Icon of="bell" /></Tile>}
            title={t({ ne: 'सूचना', en: 'Notifications' })}
            onGo={() => navigate('notifications')}
          />
          <Row
            lead={<Tile><Icon of="sun" /></Tile>}
            title={t({ ne: 'रूप', en: 'Appearance' })}
            value={themeName}
            onGo={() => navigate('appearance')}
          />
          <Row
            lead={<Tile><Icon of="text" /></Tile>}
            title={t({ ne: 'अक्षरको आकार', en: 'Text size' })}
            value={sizeName}
            onGo={() => navigate('text')}
          />
          <Row
            lead={<Tile><Icon of="globe" /></Tile>}
            title={t({ ne: 'भाषा', en: 'Language' })}
            value={lang === 'ne' ? 'नेपाली' : 'English'}
            last
            onGo={() => navigate('language')}
          />
        </Block>

        <Block label={t({ ne: 'सहयोग', en: 'Support' })}>
          <Row
            lead={<Tile><Icon of="help" /></Tile>}
            title={t({ ne: 'सहायता केन्द्र', en: 'Help center' })}
            onGo={() => window.open('/help', '_blank', 'noopener')}
          />
          <Row
            lead={<Tile><Icon of="chat" /></Tile>}
            title={t({ ne: 'सहयोगमा सम्पर्क', en: 'Contact support' })}
            onGo={() => window.open('mailto:support@manch.app', '_self')}
          />
          <Row
            lead={<Tile><Icon of="doc" /></Tile>}
            title={t({ ne: 'नियम र सर्तहरू', en: 'Terms and Conditions' })}
            last
            onGo={() => window.open('/terms', '_blank', 'noopener')}
          />
        </Block>

        <section className="bg-white px-4 pt-5 pb-2">
          <button
            type="button"
            onClick={logout}
            className="w-full h-[50px] rounded-[12px] bg-[#fef0f2]
              border-[0.612px] border-[#fecaca] flex gap-2 items-center
              justify-center text-[14px] font-bold text-[#dc2626]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden>
              <path d="M10 20H6a2 2 0 01-2-2V6a2 2 0 012-2h4M16 16l4-4-4-4M20 12H10" />
            </svg>
            {t({ ne: 'साइन आउट', en: 'Sign out' })}
          </button>
        </section>
      </div>
    </div>
  );
};
