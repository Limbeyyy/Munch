import React from 'react';
import { Lang, useOrganizer } from '../../../organizer/i18n';
import { Choice, Glyph, SubHead } from './bits';

/**
 * Which language the app speaks.
 *
 * Each is named in both, because somebody who has landed in the wrong
 * one still has to be able to find their way out of it.
 */
export const LanguageSettings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t, lang, setLang } = useOrganizer();

  const options: { id: Lang; flag: string; title: string; under: string }[] = [
    { id: 'en', flag: '🇬🇧', title: 'English', under: 'English' },
    { id: 'ne', flag: '🇳🇵', title: 'Nepali', under: 'नेपाली' },
  ];

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <SubHead title={t({ ne: 'भाषा', en: 'Language' })} onBack={onBack} />
      <section className="bg-white px-4 pt-5 pb-2 flex flex-col gap-[15px]">
        <h2 className="text-[14px] font-medium uppercase text-[#94a3b8]
          leading-[16.5px]">
          {t({ ne: 'एपको भाषा', en: 'App language' })}
        </h2>

        <div role="radiogroup" aria-label={t({ ne: 'भाषा', en: 'Language' })}>
          {options.map((one) => (
            <Choice
              key={one.id}
              lead={<Glyph>{one.flag}</Glyph>}
              title={one.title}
              under={one.under}
              on={lang === one.id}
              onPick={() => setLang(one.id)}
            />
          ))}
        </div>

        <p className="text-[13px] leading-[20.8px] text-[#94a3b8]">
          {t({
            ne: 'एपको भाषाले इन्टरफेस चलाउँछ। श्रुतिलेखनको भाषा प्रत्येक कार्यक्रममा आयोजकले तोक्छन्।',
            en: 'The app language controls the interface. Transcription language is'
              + ' set per event by the organizer.',
          })}
        </p>
      </section>
    </div>
  );
};
