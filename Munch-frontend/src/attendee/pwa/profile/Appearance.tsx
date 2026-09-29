import React from 'react';
import { Theme, useOrganizer } from '../../../organizer/i18n';
import { Block, Choice, Glyph, SubHead } from './bits';

/**
 * Light, dark, or whatever the device is doing.
 *
 * System is the honest default for a phone: somebody who has set their
 * handset to turn dark at dusk has already answered this question, and
 * asking again only gives them a way to disagree with themselves.
 */
export const Appearance: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t, look, setLook } = useOrganizer();

  const options: {
    id: Theme; glyph: string; title: string; under: string;
  }[] = [
    {
      id: 'system', glyph: '🌓',
      title: t({ ne: 'यन्त्र अनुसार', en: 'System default' }),
      under: t({ ne: 'तपाईंको यन्त्रको सेटिङ मान्छ', en: 'Follows your device setting' }),
    },
    {
      id: 'light', glyph: '☀️',
      title: t({ ne: 'उज्यालो', en: 'Light' }),
      under: t({ ne: 'सधैं उज्यालो देखिन्छ', en: 'Always use light appearance' }),
    },
    {
      id: 'dark', glyph: '🌙',
      title: t({ ne: 'अँध्यारो', en: 'Dark' }),
      under: t({ ne: 'सधैं अँध्यारो देखिन्छ', en: 'Always use dark appearance' }),
    },
  ];

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <SubHead title={t({ ne: 'रूप', en: 'Appearance' })} onBack={onBack} />
      <Block label={t({ ne: 'रूप', en: 'Appearance' })}>
        <div role="radiogroup" aria-label={t({ ne: 'रूप', en: 'Appearance' })}>
          {options.map((one, i) => (
            <Choice
              key={one.id}
              lead={<Glyph>{one.glyph}</Glyph>}
              title={one.title}
              under={one.under}
              on={look.theme === one.id}
              last={i === options.length - 1}
              onPick={() => setLook((was) => ({ ...was, theme: one.id }))}
            />
          ))}
        </div>
      </Block>
    </div>
  );
};
