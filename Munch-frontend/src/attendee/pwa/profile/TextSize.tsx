import React from 'react';
import { AppTextSize, useOrganizer } from '../../../organizer/i18n';
import { Block, Choice, SubHead } from './bits';

/**
 * How big everything is.
 *
 * The preview sits above the choices rather than below them, because
 * the thing being chosen is how this screen's own text will look, and
 * it should change under the reader's hand as they choose.
 */
export const TextSize: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t, num, look, setLook } = useOrganizer();

  const steps: {
    id: AppTextSize; px: number; title: string; under: string;
  }[] = [
    {
      id: 'small', px: 12,
      title: t({ ne: 'सानो', en: 'Small' }),
      under: t({ ne: `${num(12)}px आधार`, en: '12px base' }),
    },
    {
      id: 'default', px: 14,
      title: t({ ne: 'सामान्य', en: 'Default' }),
      under: t({ ne: `${num(14)}px आधार`, en: '14px base' }),
    },
    {
      id: 'large', px: 16,
      title: t({ ne: 'ठूलो', en: 'Large' }),
      under: t({ ne: `${num(16)}px आधार`, en: '16px base' }),
    },
    {
      id: 'xlarge', px: 18,
      title: t({ ne: 'धेरै ठूलो', en: 'Extra large' }),
      under: t({
        ne: `${num(18)}px आधार — श्रुतिलेखनका लागि उत्तम`,
        en: '18px base — best for transcripts',
      }),
    },
  ];

  return (
    <div className="bg-[#d6e4f8] min-h-full">
      <SubHead title={t({ ne: 'अक्षरको आकार', en: 'Text size' })} onBack={onBack} />

      <Block label={t({ ne: 'नमुना', en: 'Preview' })}>
        <p className="pt-2 text-[17.5px] font-bold leading-[26.25px]
          text-[#0f172a]">
          {t({ ne: 'सत्रको शीर्षक', en: 'Session heading' })}
        </p>
        <p className="pt-1 text-[14px] leading-[22.4px] text-[#475569]">
          {t({
            ne: 'बिहान १०:०० — सारा जोन्सन आपतकालीन प्रतिकार्यका ढाँचा र संस्थाहरूले बहु-जोखिमका घटनाका लागि कसरी राम्रो तयारी गर्न सक्छन् भन्नेबारे बोल्दै।',
            en: '10:00 AM — Sarah Johnson is speaking about emergency response'
              + ' frameworks and how organizations can better prepare for'
              + ' multi-hazard events.',
          })}
        </p>
      </Block>

      <div className="h-1.5" />

      <Block label={t({ ne: 'आकार', en: 'Size' })}>
        <div role="radiogroup"
          aria-label={t({ ne: 'अक्षरको आकार', en: 'Text size' })}>
          {steps.map((one, i) => (
            <Choice
              key={one.id}
              lead={
                <span className={`size-9 rounded-[8px] grid place-items-center
                  flex-none text-[13px] font-bold leading-[19.5px] ${
                  look.textSize === one.id
                    ? 'bg-[#d6e4f8] text-[#194d97]'
                    : 'bg-[#f3f4f6] text-[#64748b]'
                }`} aria-hidden>
                  {num(one.px)}
                </span>
              }
              title={one.title}
              under={one.under}
              on={look.textSize === one.id}
              last={i === steps.length - 1}
              onPick={() => setLook((was) => ({ ...was, textSize: one.id }))}
            />
          ))}
        </div>
      </Block>
    </div>
  );
};
