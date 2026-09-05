import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { rememberPortal } from './HomeRedirect';

type Lang = 'en' | 'np';
type Currency = 'USD' | 'NPR';

/** 1 USD in rupees. Kept here so every price moves together. */
const NPR_PER_USD = 152;

interface Plan {
  id: string;
  name: Record<Lang, string>;
  desc: Record<Lang, string>;
  usd: number | null;
  sub: Record<Lang, string>;
  features: Record<Lang, string>[];
  cta: Record<Lang, string>;
  popular?: boolean;
  tone?: 'free' | 'enterprise';
}

const PLANS: Plan[] = [
  {
    id: 'free',
    tone: 'free',
    name: { en: 'Free', np: 'निःशुल्क' },
    desc: { en: 'Best for trying the system', np: 'प्रणाली परीक्षण गर्न उत्तम' },
    usd: 0,
    sub: { en: 'Forever free', np: 'सधैं निःशुल्क' },
    features: [
      { en: '2 meetings / month', np: 'महिनामा २ वटा बैठक' },
      { en: 'Up to 100 attendees', np: '१०० जनासम्म सहभागी' },
      { en: 'Live transcription', np: 'प्रत्यक्ष ट्रान्सक्रिप्सन' },
      { en: 'Attendance tracking', np: 'उपस्थिति ट्र्याकिङ' },
      { en: 'Basic agenda & outcomes', np: 'आधारभूत एजेन्डा र नतिजा' },
    ],
    cta: { en: 'Start Free', np: 'निःशुल्क सुरु गर्नुहोस्' },
  },
  {
    id: 'starter',
    name: { en: 'Starter', np: 'स्टार्टर' },
    desc: { en: 'Small teams & startups', np: 'सानो टिम र स्टार्टअपका लागि' },
    usd: 49,
    sub: { en: 'per month', np: 'प्रति महिना' },
    features: [
      { en: '5 meetings / month', np: 'महिनामा ५ वटा बैठक' },
      { en: 'Up to 30 attendees', np: '३० जनासम्म सहभागी' },
      { en: 'Everything in Free', np: 'फ्रीमा भएका सबै सुविधा' },
      { en: 'Unlimited duration', np: 'असीमित समय' },
      { en: 'Transcript export', np: 'ट्रान्सक्रिप्ट निर्यात' },
    ],
    cta: { en: 'Choose Starter', np: 'स्टार्टर छान्नुहोस्' },
  },
  {
    id: 'growth',
    popular: true,
    name: { en: 'Growth', np: 'ग्रोथ' },
    desc: { en: 'Departments & mid-size orgs', np: 'विभाग र मध्यम संगठनका लागि' },
    usd: 129,
    sub: { en: 'per month', np: 'प्रति महिना' },
    features: [
      { en: '10 meetings / month', np: 'महिनामा १० वटा बैठक' },
      { en: 'Up to 100 attendees', np: '१०० जनासम्म सहभागी' },
      { en: 'Everything in Starter', np: 'स्टार्टरमा भएका सबै' },
      { en: 'Nepali + English transcription', np: 'नेपाली + अंग्रेजी ट्रान्सक्रिप्सन' },
      { en: 'Full organizer dashboard', np: 'पूर्ण आयोजक ड्यासबोर्ड' },
    ],
    cta: { en: 'Choose Growth', np: 'ग्रोथ छान्नुहोस्' },
  },
  {
    id: 'business',
    name: { en: 'Business', np: 'बिजनेस' },
    desc: { en: 'Large teams & organizations', np: 'ठूला टिम र संगठनका लागि' },
    usd: 299,
    sub: { en: 'per month', np: 'प्रति महिना' },
    features: [
      { en: '20 meetings / month', np: 'महिनामा २० वटा बैठक' },
      { en: 'Up to 300 attendees', np: '३०० जनासम्म सहभागी' },
      { en: 'Everything in Growth', np: 'ग्रोथमा भएका सबै' },
      { en: 'Multi-language support', np: 'बहुभाषी समर्थन' },
      { en: 'Analytics + Branding', np: 'एनालिटिक्स + ब्रान्डिङ' },
    ],
    cta: { en: 'Choose Business', np: 'बिजनेस छान्नुहोस्' },
  },
  {
    id: 'enterprise',
    tone: 'enterprise',
    name: { en: 'Enterprise', np: 'इन्टरप्राइज' },
    desc: { en: '300+ users & unlimited needs', np: '३००+ प्रयोगकर्ता र असीमित आवश्यकता' },
    usd: null,
    sub: { en: 'Contact us', np: 'हामीलाई सम्पर्क गर्नुहोस्' },
    features: [
      { en: 'Unlimited meetings', np: 'असीमित बैठक' },
      { en: 'Unlimited attendees', np: 'असीमित सहभागी' },
      { en: 'Dedicated support', np: 'समर्पित सहयोग' },
      { en: 'Custom security & SLA', np: 'अनुकूल सुरक्षा र SLA' },
      { en: 'Priority features', np: 'प्राथमिकता सुविधाहरू' },
    ],
    cta: { en: 'Contact Sales', np: 'सेल्सलाई सम्पर्क गर्नुहोस्' },
  },
];

const PACKS = [
  {
    id: 'pack10',
    name: { en: '10 Meetings Pack', np: '१० मिटिङ प्याक' },
    desc: { en: 'Valid for 6 months', np: '६ महिनासम्म मान्य' },
    usd: 79,
  },
  {
    id: 'pack100',
    name: { en: '100 Meetings Pack', np: '१०० मिटिङ प्याक' },
    desc: { en: 'Valid for 12 months', np: '१२ महिनासम्म मान्य' },
    usd: 599,
  },
];

export const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>('en');
  const [currency, setCurrency] = useState<Currency>('USD');

  const price = (usd: number) =>
    currency === 'USD'
      ? `$${usd}`
      : `रु ${Math.round(usd * NPR_PER_USD).toLocaleString('en-IN')}`;

  const t = (pair: Record<Lang, string>) => pair[lang];

  const choose = (plan: Plan) => {
    if (plan.id === 'enterprise') {
      toast(t({ en: 'Our team will be in touch.', np: 'हाम्रो टोलीले सम्पर्क गर्नेछ।' }));
      return;
    }
    if (plan.id === 'free') {
      // Someone already signed in can take up the trial here and now; anyone
      // else has to sign in before there is an account to attach it to.
      apiClient
        .startHosting()
        .then(() => {
          rememberPortal('host');
          navigate('/organizer');
        })
        .catch(() => navigate('/login'));
      return;
    }
    toast(
      t({
        en: `${plan.name.en} selected — checkout is not connected yet.`,
        np: `${plan.name.np} छानियो — भुक्तानी अझै जोडिएको छैन।`,
      })
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-center text-3xl font-bold text-slate-900">
          {t({ en: 'Meeting Management System', np: 'बैठक व्यवस्थापन प्रणाली' })}
        </h1>
        <p className="text-center text-slate-600 mt-2 mb-8 text-sm">
          {t({
            en: 'Privacy-first · You own all content · Nothing stored on our servers',
            np: 'गोपनीयता प्राथमिक · सामग्री तपाईंको · हामी केही भण्डारण गर्दैनौं',
          })}
        </p>

        {/* Language and currency */}
        <div className="flex justify-center gap-4 flex-wrap mb-10">
          <div className="flex bg-white rounded-full p-1 shadow-sm" role="group">
            {(['en', 'np'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
                  lang === l ? 'bg-blue-700 text-white' : 'text-slate-600'
                }`}
              >
                {l === 'en' ? 'English' : 'नेपाली'}
              </button>
            ))}
          </div>

          <div className="flex bg-white rounded-full p-1 shadow-sm" role="group">
            {(['USD', 'NPR'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
                  currency === c ? 'bg-blue-700 text-white' : 'text-slate-600'
                }`}
              >
                {c === 'USD' ? 'USD ($)' : 'NPR (रु)'}
              </button>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl p-6 flex flex-col shadow transition hover:-translate-y-1 ${
                plan.popular ? 'border-2 border-blue-700' : 'border-2 border-transparent'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-700 text-white text-[11px] font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                  {t({ en: 'Most Popular', np: 'सबैभन्दा लोकप्रिय' })}
                </span>
              )}

              <h2 className="text-xl font-bold text-slate-900">{t(plan.name)}</h2>
              <p className="text-slate-500 text-sm mt-1 mb-4">{t(plan.desc)}</p>

              <p className="text-3xl font-extrabold text-slate-900">
                {plan.usd === null ? t({ en: 'Custom', np: 'अनुकूल' }) : price(plan.usd)}
              </p>
              <p className="text-slate-500 text-sm mb-4">{t(plan.sub)}</p>

              <ul className="text-sm flex-1 mb-5">
                {plan.features.map((f) => (
                  <li key={f.en} className="py-1.5 border-b border-slate-100">
                    <span className="text-green-600 font-bold mr-1">✓</span>
                    {t(f)}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => choose(plan)}
                className={`w-full py-3 rounded-lg font-semibold text-white transition ${
                  plan.tone === 'free'
                    ? 'bg-green-600 hover:bg-green-700'
                    : plan.tone === 'enterprise'
                    ? 'bg-slate-900 hover:bg-slate-800'
                    : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {t(plan.cta)}
              </button>
            </div>
          ))}
        </div>

        {/* Packs */}
        <h2 className="text-center text-2xl font-bold text-slate-900 mt-14 mb-5">
          {t({
            en: 'Or buy Meeting Packs (no monthly subscription)',
            np: 'वा मिटिङ प्याक किन्नुहोस् (मासिक सदस्यता बिना)',
          })}
        </h2>

        <div className="grid gap-5 md:grid-cols-3">
          {PACKS.map((pack) => (
            <div
              key={pack.id}
              className="bg-white rounded-2xl p-6 text-center border border-slate-200 shadow-sm"
            >
              <h3 className="text-lg font-bold text-slate-900">{t(pack.name)}</h3>
              <p className="text-slate-500 text-sm mt-1 mb-3">{t(pack.desc)}</p>
              <p className="text-2xl font-extrabold text-slate-900 mb-4">
                {price(pack.usd)}
              </p>
              <button
                onClick={() =>
                  toast(t({ en: 'Checkout is not connected yet.', np: 'भुक्तानी अझै जोडिएको छैन।' }))
                }
                className="w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-800"
              >
                {t({ en: 'Buy Pack', np: 'प्याक किन्नुहोस्' })}
              </button>
            </div>
          ))}

          <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900">
              {t({ en: 'Pay Per Meeting', np: 'प्रति बैठक भुक्तानी' })}
            </h3>
            <p className="text-slate-500 text-sm mt-1 mb-3">
              {t({
                en: 'No commitment · Pay only when you use',
                np: 'प्रतिबद्धता छैन · प्रयोग गर्दा मात्र तिर्नुहोस्',
              })}
            </p>
            <p className="text-2xl font-extrabold text-slate-900 mb-4">
              {price(12)} – {price(18)}
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-800"
            >
              {t({ en: 'Start Now', np: 'अहिले सुरु गर्नुहोस्' })}
            </button>
          </div>
        </div>

        <p className="text-center text-slate-600 text-sm mt-10 leading-relaxed">
          {t({
            en: 'All plans include live transcription, Q&A, attendance tracking, agenda and outcomes.',
            np: 'सबै योजनामा प्रत्यक्ष ट्रान्सक्रिप्सन, प्रश्नोत्तर, उपस्थिति, एजेन्डा र नतिजा समावेश छ।',
          })}
          <br />
          {t({
            en: 'You fully own your meeting content.',
            np: 'तपाईंको बैठक सामग्री पूर्ण रूपमा तपाईंको हो।',
          })}
        </p>

        <div className="text-center mt-8">
          <button
            onClick={() => navigate('/login')}
            className="text-blue-700 underline underline-offset-4 text-sm"
          >
            {t({ en: 'Back to sign in', np: 'साइन इनमा फर्कनुहोस्' })}
          </button>
        </div>
      </div>
    </div>
  );
};
