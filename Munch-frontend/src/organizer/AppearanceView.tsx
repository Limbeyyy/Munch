import React from 'react';
import { LineSpacing, Pair, TextSize, Theme, useOrganizer } from './i18n';
import { SectionHeading, SettingsHeading, SettingsSheet } from './ProfileView';

/** The three themes, each with the swatch the design gives it. */
const THEMES: { id: Theme; label: Pair; lede: Pair; swatch: string }[] = [
  {
    id: 'light',
    label: { ne: 'उज्यालो', en: 'Light' },
    lede: { ne: 'उज्यालो रूप', en: 'Use a light interface' },
    swatch: 'theme-swatch-light bg-[#f9fafb] border-[0.6px] border-line',
  },
  {
    id: 'dark',
    label: { ne: 'अँध्यारो', en: 'Dark' },
    lede: { ne: 'अँध्यारो रूप', en: 'Use a dark interface' },
    swatch: 'theme-swatch-dark bg-[#1e2939] border-[0.6px] border-[#364153]',
  },
  {
    id: 'contrast',
    label: { ne: 'उच्च कन्ट्रास्ट', en: 'High contrast' },
    lede: {
      ne: 'गाढा किनारा र अक्षर',
      en: 'Stronger borders and text',
    },
    swatch: 'theme-swatch-contrast bg-white border-[2px] border-black',
  },
];

const SIZES: { id: TextSize; label: Pair; type: string }[] = [
  { id: 'small', label: { ne: 'सानो', en: 'small' }, type: 'text-[12px] leading-4' },
  { id: 'medium', label: { ne: 'मध्यम', en: 'medium' }, type: 'text-[14px] leading-5' },
  { id: 'large', label: { ne: 'ठूलो', en: 'large' }, type: 'text-[16px] leading-6' },
];

const SPACINGS: { id: LineSpacing; label: Pair }[] = [
  { id: 'comfortable', label: { ne: 'सहज', en: 'comfortable' } },
  { id: 'relaxed', label: { ne: 'फराकिलो', en: 'relaxed' } },
];

/**
 * How the place looks, and how a transcript reads inside it.
 *
 * Both are this browser's rather than the account's, which is the point:
 * somebody reading a transcript on a projector at the back of a hall
 * wants it larger there and not everywhere they ever sign in.
 */
export const AppearanceView: React.FC = () => {
  const { t, look, setLook } = useOrganizer();

  return (
    <SettingsSheet>
      <SettingsHeading
        title={{ ne: 'रूपरंग', en: 'Appearance' }}
        lede={{
          ne: 'मन्च तपाईंलाई कस्तो देखियोस्, त्यो यहाँबाट मिलाउनुहोस्।',
          en: 'Customize how Manch looks for you.',
        }}
      />

      <div className="flex flex-col gap-8 max-w-[672px] w-full">
        <div className="flex flex-col gap-3">
          <SectionHeading>{t({ ne: 'थिम', en: 'Theme' })}</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup"
            aria-label={t({ ne: 'थिम', en: 'Theme' })}>
            {THEMES.map((one) => {
              const chosen = look.theme === one.id;
              return (
                <button
                  key={one.id}
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setLook((v) => ({ ...v, theme: one.id }))}
                  className={`rounded-[12px] p-4 flex flex-col items-start text-left
                    border-[1.8px] ${chosen ? 'border-head' : 'border-line'}`}
                >
                  <span className={`h-14 w-full rounded-[8px] ${one.swatch}`} aria-hidden />
                  <span className="pt-3 flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`w-3.5 h-3.5 rounded-full border-[1.8px] grid place-items-center
                        ${chosen ? 'border-head' : 'border-[#d1d5dc]'}`}
                    >
                      {chosen && <span className="w-2 h-2 rounded-full bg-head" />}
                    </span>
                    <span className="text-[14px] font-medium text-head leading-5">
                      {t(one.label)}
                    </span>
                  </span>
                  <span className="pl-5 pt-0.5 text-[12px] text-subtle leading-4">
                    {t(one.lede)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t({ ne: 'प्रतिलिपिको रूप', en: 'Transcript appearance' })}
          </SectionHeading>

          <div className="bg-white border-[0.6px] border-line rounded-[12px] p-5
            flex flex-col gap-5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-body leading-4">
                {t({ ne: 'प्रतिलिपिको अक्षर आकार', en: 'Transcript text size' })}
              </span>
              <div className="pt-2 flex gap-2" role="radiogroup"
                aria-label={t({ ne: 'प्रतिलिपिको अक्षर आकार', en: 'Transcript text size' })}>
                {SIZES.map((one) => {
                  const chosen = look.transcriptSize === one.id;
                  return (
                    <button
                      key={one.id}
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setLook((v) => ({ ...v, transcriptSize: one.id }))}
                      className={`flex-1 rounded-[8px] border-[1.8px] py-2 flex flex-col
                        items-center ${chosen ? 'border-head bg-[#f9fafb]' : 'border-line'}`}
                    >
                      <span aria-hidden className={`font-medium text-head ${one.type}`}>A</span>
                      <span className="pt-0.5 text-[10px] text-subtle capitalize">
                        {t(one.label)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-body leading-4">
                {t({ ne: 'प्रतिलिपिको पङ्क्ति दूरी', en: 'Transcript line spacing' })}
              </span>
              <div className="pt-2 flex gap-2" role="radiogroup"
                aria-label={t({ ne: 'प्रतिलिपिको पङ्क्ति दूरी', en: 'Transcript line spacing' })}>
                {SPACINGS.map((one) => {
                  const chosen = look.transcriptSpacing === one.id;
                  return (
                    <button
                      key={one.id}
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setLook((v) => ({ ...v, transcriptSpacing: one.id }))}
                      className={`flex-1 rounded-[8px] border-[1.8px] py-2 text-[14px]
                        leading-5 capitalize
                        ${chosen
                          ? 'border-head bg-[#f9fafb] font-medium text-head'
                          : 'border-line text-body'}`}
                    >
                      {t(one.label)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The settings read back at you, in the thing they change. */}
            <div className="bg-[#f9fafb] border-[0.6px] border-[#f3f4f6] rounded-[8px]
              px-4 py-3 flex flex-col">
              <span className="text-[12px] font-medium text-faint leading-4
                tracking-[0.6px] uppercase">
                {t({ ne: 'झलक', en: 'Preview' })}
              </span>
              <div className="pt-2 flex flex-col gap-1">
                <span className="font-mono text-[12px] text-faint leading-4">03:48</span>
                <div data-transcript-line>
                  <p className="text-[14px] font-bold text-head leading-5">Sarah Sharma</p>
                  <p className="pt-0.5 text-[14px] text-[#364153] leading-5">
                    {t({
                      ne: 'शुक्रबारभित्र आपतकालीन प्रतिकार्य योजना टुङ्ग्याउनुपर्छ।',
                      en: 'We need to finalize the emergency response plan before Friday.',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSheet>
  );
};
