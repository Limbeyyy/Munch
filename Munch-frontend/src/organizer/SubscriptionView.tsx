import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ProfileSummary } from '../types';
import { MAX_SAVED_METHODS, PaymentCheckout } from '../components/PaymentCheckout';
import { Invoice as InvoiceSheet } from '../components/Invoice';
import { Pair, useOrganizer } from './i18n';
import { Chip, Empty } from './ui';
import {
  SectionCard, SectionHeading, SettingsHeading, SettingsSheet,
} from './ProfileView';

/**
 * A bill that has been raised against this account.
 *
 * Nothing raises one yet: no money changes hands here, an operator
 * applies the plan. The shape is written down so the section that shows
 * them is the real thing rather than a drawing of one, and so whatever
 * wires up a payment provider has something to fill in.
 */
interface Invoice {
  id: string;
  issued_at: string;
  plan_name: string;
  /** Already formatted with its currency: this page does not do money. */
  amount: string;
  download_url?: string;
}

type SavedPaymentMethod =
  | { id: string; kind: 'wallet'; wallet: 'eSewa' | 'Khalti' | 'IME Pay'; phone: string; fullName: string }
  | { id: string; kind: 'bank'; bankName: string; accountName: string; accountNumber: string };

const PLAN_COPY: Record<string, { description: string; usd: number | null; period: string }> = {
  free: { description: 'Best for trying the system', usd: 0, period: 'Forever free' },
  starter: { description: 'Small teams and startups', usd: 49, period: 'per month' },
  growth: { description: 'Departments and mid-size organizations', usd: 129, period: 'per month' },
  business: { description: 'Large teams and organizations', usd: 299, period: 'per month' },
  enterprise: { description: 'Unlimited needs and dedicated support', usd: null, period: 'Contact us' },
};

const NPR_PER_USD = 152;

const PaymentMethodIcon: React.FC<{ kind: SavedPaymentMethod['kind'] }> = ({ kind }) => (
  <span className="w-9 h-9 rounded-[9px] bg-[#EEF3FA] text-navy-800 grid place-items-center flex-none" aria-hidden>
    {kind === 'wallet' ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 14h3" />
      </svg>
    ) : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18M2 10l10-7 10 7" />
      </svg>
    )}
  </span>
);

/** One line of the billing details: a quiet label, then the answer. */
const BillingLine: React.FC<{ label: string; children: React.ReactNode }> = ({
  label, children,
}) => (
  <div className="flex items-start gap-6">
    <span className="w-16 flex-none text-[12px] text-faint leading-5">{label}</span>
    <span className="text-[14px] text-[#364153] leading-5 min-w-0">{children}</span>
  </div>
);

/** One allowance, drawn as the design draws it: a bar under its name. */
const Meter: React.FC<{
  label: string;
  detail?: string;
  used: number;
  cap: number | null;
  right: string;
  tone: 'teal' | 'amber' | 'coral';
}> = ({ label, detail, used, cap, right, tone }) => {
  // The colour is how close to the ceiling it is, not what it counts:
  // the point of the bar is to be noticed before the ceiling is hit.
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const paint = pct >= 90 ? '#ef6b6b' : pct >= 60 ? '#f0a22b' : {
    teal: '#39b9a4', amber: '#f0a22b', coral: '#ef6b6b',
  }[tone];
  return (
    <div className="flex flex-col w-full">
      <div className="flex items-start justify-between gap-4">
        <span className="text-[16px] text-[#364153] leading-5">
          {label}
          {detail && <span className="ml-1 text-[13px] text-subtle">· {detail}</span>}
        </span>
        <span className="text-[14px] text-subtle leading-4 tabular-nums">{right}</span>
      </div>
      <div className="pt-1.5 w-full">
        <div className="meter-track bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden w-full">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${cap === null ? 0 : pct}%`, backgroundColor: paint }}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * What a host is on, and how to buy more.
 *
 * The plan chooser stays separate from checkout. A Buy action opens the
 * payment modal with the saved billing and payment-method details.
 */
export const SubscriptionView: React.FC<{
  onNavigate?: (view: string) => void;
}> = ({ onNavigate }) => {
  const { t, num } = useOrganizer();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [buyingPlan, setBuyingPlan] = useState('');
  const [paidInvoice, setPaidInvoice] = useState<{ orderId: string; amount: string; method: string } | null>(null);
  const [currency, setCurrency] = useState<'USD' | 'NPR'>('NPR');
  const [methodMenu, setMethodMenu] = useState(false);
  const [methodForm, setMethodForm] = useState<'bank' | 'wallet' | null>(null);
  const [methods, setMethods] = useState<SavedPaymentMethod[]>([]);
  const [wallet, setWallet] = useState<'eSewa' | 'Khalti' | 'IME Pay'>('eSewa');
  const [methodFields, setMethodFields] = useState({ fullName: '', phone: '', bankName: '', accountName: '', accountNumber: '' });
  // Nothing raises one yet; the section is real and therefore empty.
  const [invoices] = useState<Invoice[]>([]);

  const load = useCallback(async () => {
    try {
      const summary = await apiClient.getProfileSummary();
      setProfile(summary);
    } catch {
      toast.error(t({ ne: 'योजना ल्याउन सकिएन', en: 'Could not load the plans' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    try { setMethods(JSON.parse(localStorage.getItem('manch.payment.methods') || '[]')); } catch { setMethods([]); }
  }, []);

  const saveMethod = () => {
    if (methodForm === 'wallet' && methods.some((method) => method.kind === 'wallet')) {
      toast.error('Only one wallet allowed at once');
      return;
    }

    if (methodForm === 'bank' && methods.some((method) => method.kind === 'bank')) {
      toast.error('Only one bank allowed at once');
      return;
    }

    // Two, which is what the sketch says: one wallet and one bank is the
    // whole of how anybody here pays, and a longer list is a list
    // somebody picks the wrong row from.
    if (methods.length >= MAX_SAVED_METHODS) {
      toast.error(`Only ${MAX_SAVED_METHODS} saved payments at a time. Remove one first.`);
      return;
    }

    const next: SavedPaymentMethod = methodForm === 'wallet'
      ? { id: crypto.randomUUID(), kind: 'wallet', wallet, phone: methodFields.phone, fullName: methodFields.fullName }
      : { id: crypto.randomUUID(), kind: 'bank', bankName: methodFields.bankName, accountName: methodFields.accountName, accountNumber: methodFields.accountNumber };
    const saved = [...methods, next];
    setMethods(saved);
    localStorage.setItem('manch.payment.methods', JSON.stringify(saved));
    setMethodForm(null);
    setMethodMenu(false);
    setMethodFields({ fullName: '', phone: '', bankName: '', accountName: '', accountNumber: '' });
    toast.success('Payment method saved');
  };

  const removeMethod = (methodId: string) => {
    const updated = methods.filter((method) => method.id !== methodId);
    setMethods(updated);
    localStorage.setItem('manch.payment.methods', JSON.stringify(updated));
    toast.success('Payment method removed');
  };

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }
  if (!profile) {
    return (
      <SettingsSheet>
        <Empty>{t({ ne: 'योजना उपलब्ध छैन।', en: 'No plans to show.' })}</Empty>
      </SettingsSheet>
    );
  }

  // Somebody who has not hosted yet has no plan row, but the free trial is
  // what they would start on - so it is marked current rather than offered,
  // which the server would refuse anyway.
  const current = profile.plan ?? profile.plans.find((p) => !p.paid) ?? null;
  const { usage, remaining, user } = profile;
  const usedAttendees = usage?.attendees ?? 0;
  const totalSessionCapacity = current?.limits.events === null
    || current?.limits.sessions_per_event === null
    ? null
    : current
      ? current.limits.events * current.limits.sessions_per_event
      : null;
  const totalAttendeeCapacity = current?.limits.events === null
    || current?.limits.attendees === null
    ? null
    : current
      ? current.limits.events * current.limits.attendees
      : null;

  const capText = (cap: number | null) =>
    cap === null ? t({ ne: 'असीमित', en: 'Unlimited' }) : num(cap);

  const planPrice = (usd: number | null) => {
    if (usd === null) return 'Custom';
    if (currency === 'USD') return `$${usd}`;
    return `रू ${Math.round(usd * NPR_PER_USD).toLocaleString('en-IN')}`;
  };

  const buyingPlanData = profile.plans.find((plan) => plan.name === buyingPlan);
  const buyingPlanCopy = buyingPlanData ? PLAN_COPY[buyingPlanData.id] : undefined;
  const buyingAmount = buyingPlanCopy?.usd === null || buyingPlanCopy?.usd === undefined
    ? ''
    : String(Math.round(buyingPlanCopy.usd * NPR_PER_USD));
  const savedMethodChoices = methods.map((method) => method.kind === 'wallet'
    ? {
        id: method.id,
        kind: method.kind,
        label: `Wallet ${method.wallet}`,
        detail: `${method.fullName}\n${method.phone}`,
      }
    : {
        id: method.id,
        kind: method.kind,
        label: `Bank ${method.bankName}`,
        detail: `${method.accountName}\n${method.accountNumber}`,
      });

  /**
   * Every plan, and the way to ask for one.
   *
   * Behind the banner's button rather than laid out down the page: what
   * a host is on belongs on this page, and the shelf of everything they
   * could be on is a thing they go looking for once.
   */
  const plans = (
    <div
      className="fixed inset-0 z-[70] grid place-items-center p-4 bg-[#0b1220]/50"
      onClick={(e) => { if (e.target === e.currentTarget) setChoosing(false); }}
      role="dialog"
      aria-modal="true"
      aria-label={t({ ne: 'योजनाहरू', en: 'Plans' })}
    >
      <div className="bg-white rounded-[12px] w-full max-w-[720px] max-h-[88vh] overflow-auto
        shadow-[0px_25px_25px_rgba(0,0,0,0.25)] p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-head leading-6">
            {t({ ne: 'योजनाहरू', en: 'Plans' })}
          </h3>
          <button
            onClick={() => setChoosing(false)}
            className="text-[13px] text-subtle hover:text-head"
          >
            {t({ ne: 'बन्द', en: 'Close' })}
          </button>
        </div>
        <p className="text-[12px] text-subtle leading-4">
          {t({ ne: 'योजना छान्नुहोस् र सुरक्षित रूपमा किन्नुहोस्।', en: 'Choose a plan and buy it securely.' })}
        </p>
        <div className="self-start inline-flex gap-1 p-1 bg-[#F3F6FA] border border-line rounded-full" role="group" aria-label="Currency">
          {(['USD', 'NPR'] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              onClick={() => setCurrency(unit)}
              aria-pressed={currency === unit}
              className={`px-3 py-1 rounded-full text-[12px] ${currency === unit ? 'bg-navy-800 text-white font-medium' : 'text-subtle'}`}
            >
              {unit === 'USD' ? 'USD ($)' : 'NPR (रू)'}
            </button>
          ))}
        </div>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}
        >
          {profile.plans.map((plan) => {
            const mine = current?.id === plan.id;
            const copy = PLAN_COPY[plan.id] ?? PLAN_COPY.enterprise;
            return (
              <SectionCard
                key={plan.id}
                className={`p-4 flex flex-col gap-3 ${mine ? 'border-navy-800' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[15px] font-semibold text-head leading-5">
                    {plan.name}
                  </h4>
                  {mine && <Chip tone="ok">{t({ ne: 'हालको', en: 'Current' })}</Chip>}
                </div>
                <p className="text-[12px] text-subtle min-h-[32px]">{copy.description}</p>
                <p className="text-[21px] font-bold text-head">{planPrice(copy.usd)}</p>
                <p className="text-[11px] text-faint">{copy.period}</p>
                <dl className="flex flex-col gap-1.5 text-[12.5px]">
                  {(
                    [
                      [{ ne: 'कार्यक्रम', en: 'Events' }, plan.limits.events],
                      [{ ne: 'प्रति कार्यक्रम सत्र', en: 'Sessions per event' },
                       plan.limits.sessions_per_event],
                      [{ ne: 'सहभागी', en: 'Attendees' }, plan.limits.attendees],
                    ] as [Pair, number | null][]
                  ).map(([label, cap]) => (
                    <div key={t(label)} className="flex justify-between gap-3">
                      <dt className="text-subtle">{t(label)}</dt>
                      <dd className="text-[#364153] tabular-nums">{capText(cap)}</dd>
                    </div>
                  ))}
                </dl>
                {mine ? (
                  <button
                    disabled
                    className="w-full rounded-[8px] border-[0.6px] border-line px-3 py-1.5
                      text-[14px] leading-5 text-subtle"
                  >
                    {t({ ne: 'यही चलिरहेको छ', en: 'In use' })}
                  </button>
                ) : (
                  <button
                    onClick={() => { setBuyingPlan(plan.name); setChoosing(false); }}
                    className="w-full rounded-[8px] bg-navy-800 hover:bg-navy-700 px-3 py-1.5
                      text-[14px] leading-5 text-white"
                  >
                    {t({ ne: 'किन्नुहोस्', en: 'Buy' })}
                  </button>
                )}
              </SectionCard>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <SettingsSheet>
      <SettingsHeading
        title={{ ne: 'बिलिङ र योजना', en: 'Billing & subscription' }}
        lede={{
          ne: 'तपाईंको योजना, बिलिङ विवरण र भुक्तानी।',
          en: 'Manage your plan, billing information and payments.',
        }}
      />

      <div className="flex flex-col gap-4 max-w-[906px] w-full">
        {/* The plan, on its banner. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>{t({ ne: 'हालको योजना', en: 'Current plan' })}</SectionHeading>
          <div className="rounded-[12px] border-[0.6px] border-[#e1e1e1] p-5
            bg-gradient-to-r from-[#12386e] to-[#236cd4]">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[#efefef] leading-4
                  tracking-[0.6px] uppercase">
                  {t({ ne: 'हालको योजना', en: 'Current plan' })}
                </p>
                <p className="pt-1 text-[24px] font-bold text-white leading-8">
                  {current?.name ?? t({ ne: 'कुनै योजना छैन', en: 'No plan yet' })}
                </p>
                <p className="text-[14px] text-[#f9f9f9] leading-5">
                  {current?.paid
                    ? t({ ne: 'सशुल्क योजना', en: 'Paid plan' })
                    : t({ ne: 'निःशुल्क परीक्षण', en: 'Free trial' })}
                </p>
                <p className="pt-2 text-[12px] text-[#f5f5f5] leading-4">
                  {t({
                    ne: 'OnePG वा QR बाट योजना किन्नुहोस्।',
                    en: 'Buy this plan through OnePG or the merchant QR.',
                  })}
                </p>
              </div>
              <button
                onClick={() => setChoosing(true)}
                className="bg-white border-[0.6px] border-line rounded-[8px] px-3 py-1.5
                  text-[14px] text-[#364153] leading-5 flex-none hover:border-navy-800"
              >
                {t({ ne: 'योजना व्यवस्थापन', en: 'Manage subscription' })}
              </button>
            </div>
          </div>
        </div>

        {/* What has been spent of it. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>{t({ ne: 'यो महिना', en: 'This month' })}</SectionHeading>
          <SectionCard className="p-5 flex flex-col gap-5">
            {current && usage ? (
              <>
                <Meter
                  label={t({ ne: 'कार्यक्रम', en: 'Events' })}
                  used={usage.events}
                  cap={current.limits.events}
                  right={current.limits.events === null
                    ? t({ ne: `${num(usage.events)} · असीमित`, en: `${usage.events} · unlimited` })
                    : `${num(usage.events)} / ${num(current.limits.events)}`}
                  tone="teal"
                />
                <Meter
                  label={t({ ne: 'सत्र', en: 'Sessions' })}
                  detail={t({
                    ne: `प्रति कार्यक्रम ${capText(current.limits.sessions_per_event)}`,
                    en: `${capText(current.limits.sessions_per_event)} per event`,
                  })}
                  used={usage.sessions}
                  cap={totalSessionCapacity}
                  right={totalSessionCapacity === null
                    ? t({ ne: `${num(usage.sessions)} · असीमित`, en: `${usage.sessions} · unlimited` })
                    : `${num(usage.sessions)} / ${num(totalSessionCapacity)}`}
                  tone="amber"
                />
                <Meter
                  label={t({ ne: 'सहभागी', en: 'Attendees' })}
                  detail={t({
                    ne: `प्रति कार्यक्रम ${capText(current.limits.attendees)}`,
                    en: `${capText(current.limits.attendees)} per event`,
                  })}
                  used={usedAttendees}
                  cap={totalAttendeeCapacity}
                  right={totalAttendeeCapacity === null
                    ? t({ ne: `${num(usedAttendees)} · असीमित`, en: `${usedAttendees} · unlimited` })
                    : `${num(usedAttendees)} / ${num(totalAttendeeCapacity)}`}
                  tone="coral"
                />
                {remaining.events !== null && (
                  <p className="text-[12px] text-subtle leading-4">
                    {t({
                      ne: `${num(remaining.events)} कार्यक्रम बाँकी छ।`,
                      en: `${remaining.events} event${remaining.events === 1 ? '' : 's'} left.`,
                    })}
                  </p>
                )}
              </>
            ) : (
              <Empty>
                {t({
                  ne: 'कार्यक्रम खोल्नु भएपछि यहाँ खर्च देखिन्छ।',
                  en: 'What you have used shows here once you open an event.',
                })}
              </Empty>
            )}
          </SectionCard>
        </div>

        {/* The card an invoice would be charged to. There is none: no
            money changes hands here, so nothing is drawn as though it
            had. The section stands ready for the day one is taken. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t({ ne: 'भुक्तानीको तरिका', en: 'Payment method' })}
          </SectionHeading>
          <SectionCard className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[14px] text-subtle leading-5">
                {methods.length === 0 ? 'Nothing to show.' : `${methods.length} Saved Payments${methods.length === 1 ? '' : 's'}`}
              </p>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMethodMenu((open) => !open)}
                  className="text-[13px] text-navy-800 font-medium"
                >
                  + Add
                </button>
                {methodMenu && (
                  <div className="absolute right-0 top-7 z-10 w-36 bg-white border border-line rounded-[8px] shadow-lg p-1">
                    <button type="button" onClick={() => { setMethodForm('bank'); setMethodMenu(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#EEF3FA]">Add bank</button>
                    <button type="button" onClick={() => { setMethodForm('wallet'); setMethodMenu(false); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#EEF3FA]">Add wallet</button>
                  </div>
                )}
              </div>
            </div>
            {methods.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {methods.map((method) => (
                  <div key={method.id} className="border border-line rounded-[10px] px-3 py-2.5 flex items-start justify-between gap-3 text-[13px] text-body">
                    <div className="flex items-start gap-3 min-w-0">
                      <PaymentMethodIcon kind={method.kind} />
                      {method.kind === 'wallet' ? (
                        <div className="min-w-0">
                        <p><b className="font-medium text-head">{method.wallet}</b></p>
                        <p className="text-subtle">{method.fullName}</p>
                        <p className="text-subtle tabular-nums">{method.phone}</p>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p><b className="font-medium text-head">{method.bankName}</b></p>
                          <p className="text-subtle">{method.accountName}</p>
                          <p className="text-subtle tabular-nums">{method.accountNumber}</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMethod(method.id)}
                      className="text-[12px] text-[#B42318] hover:underline whitespace-nowrap"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Who the plan is held against. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t({ ne: 'बिलिङ विवरण', en: 'Billing information' })}
          </SectionHeading>
          <SectionCard className="px-5 py-4 flex flex-col gap-1.5">
            <BillingLine label={t({ ne: 'नाम', en: 'Name' })}>
              {user.name || user.email}
            </BillingLine>
            <BillingLine label={t({ ne: 'इमेल', en: 'Email' })}>{user.email}</BillingLine>
            <BillingLine label={t({ ne: 'ठेगाना', en: 'Address' })}>
              {user.billing_address || (
                <span className="text-faint">
                  {t({ ne: 'तोकिएको छैन', en: 'Not given' })}
                </span>
              )}
            </BillingLine>
            <div className="pt-1.5">
              <button
                onClick={() => onNavigate?.('profile')}
                className="text-[12px] text-[#155DFC] leading-4 hover:underline"
              >
                {t({ ne: 'बिलिङ विवरण सम्पादन', en: 'Edit billing information' })}
              </button>
            </div>
          </SectionCard>
        </div>

        {/* What has been charged. Nothing has. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>{t({ ne: 'बिलहरू', en: 'Invoices' })}</SectionHeading>
          <SectionCard className="bg-sheet">
            {invoices.length === 0 ? (
              <div className="px-5 py-4">
                <p className="text-[14px] text-subtle leading-5">
                  {t({ ne: 'देखाउन केही छैन।', en: 'Nothing to show.' })}
                </p>
              </div>
            ) : (
              invoices.map((one) => (
                <div
                  key={one.id}
                  className="flex items-center justify-between gap-4 px-5 py-3
                    border-b-[0.6px] border-[#f3f4f6] last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#1E2939] leading-5">
                      {new Date(one.issued_at).toLocaleDateString(undefined, {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </p>
                    <p className="text-[12px] text-faint leading-4">{one.plan_name}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-none">
                    <span className="text-[14px] text-[#364153] leading-5 tabular-nums">
                      {one.amount}
                    </span>
                    {one.download_url && (
                      <a
                        href={one.download_url}
                        className="text-[12px] text-[#155DFC] leading-4 hover:underline"
                      >
                        {t({ ne: 'डाउनलोड', en: 'Download' })}
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>

      {choosing && plans}
      {methodForm && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4 bg-[#0b1220]/50">
          <form
            onSubmit={(event) => { event.preventDefault(); saveMethod(); }}
            className="bg-white rounded-[12px] w-full max-w-[420px] p-6 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-semibold text-head">{methodForm === 'wallet' ? 'Add wallet' : 'Add bank'}</h3>
              <button type="button" onClick={() => setMethodForm(null)} className="text-[13px] text-subtle">Close</button>
            </div>
            {methodForm === 'wallet' ? (
              <>
                <label className="text-[12px] font-medium text-body">Wallet: 
                  <select value={wallet} onChange={(e) => setWallet(e.target.value as typeof wallet)} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]">
                    <option>eSewa</option><option>Khalti</option><option>IME Pay</option>
                  </select>
                </label>
                <label className="text-[12px] font-medium text-body">Full Name
                  <input required value={methodFields.fullName} onChange={(e) => setMethodFields({ ...methodFields, fullName: e.target.value })} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]" />
                </label>
                <label className="text-[12px] font-medium text-body">Phone Number
                  <input required value={methodFields.phone} onChange={(e) => setMethodFields({ ...methodFields, phone: e.target.value })} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]" />
                </label>
              </>
            ) : (
              <>
                <label className="text-[12px] font-medium text-body">Bank name
                  <input required value={methodFields.bankName} onChange={(e) => setMethodFields({ ...methodFields, bankName: e.target.value })} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]" />
                </label>
                <label className="text-[12px] font-medium text-body">Account name
                  <input required value={methodFields.accountName} onChange={(e) => setMethodFields({ ...methodFields, accountName: e.target.value })} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]" />
                </label>
                <label className="text-[12px] font-medium text-body">Account number
                  <input required value={methodFields.accountNumber} onChange={(e) => setMethodFields({ ...methodFields, accountNumber: e.target.value })} className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px]" />
                </label>
              </>
            )}
            <button type="submit" className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-4 py-2 text-[13px] font-medium">Save</button>
          </form>
        </div>
      )}
      {buyingPlan && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center p-4 bg-[#0b1220]/50"
          onClick={(event) => {
            if (event.target === event.currentTarget) { setBuyingPlan(''); setPaidInvoice(null); }
          }}
          role="dialog"
          aria-modal="true"
          aria-label={paidInvoice ? 'Invoice' : 'Upgrade Plans'}
        >
          <div className="bg-white rounded-[12px] w-full max-w-[820px] max-h-[92vh]
            overflow-auto p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[20px] font-semibold text-head">
                {paidInvoice ? 'Invoice' : 'Upgrade Plans'}
              </h3>
              <button
                type="button"
                onClick={() => { setBuyingPlan(''); setPaidInvoice(null); }}
                className="text-[13px] text-subtle hover:text-head"
              >
                Close
              </button>
            </div>

            {paidInvoice ? (
              <>
                <InvoiceSheet
                  details={{
                    number: paidInvoice.orderId.slice(-8).toUpperCase(),
                    issuedAt: new Date().toISOString(),
                    billedTo: {
                      name: user.name || user.email,
                      email: user.email,
                      phone: user.phone || undefined,
                      address: user.billing_address || undefined,
                    },
                    lines: [{
                      description: `${buyingPlan} plan · ${
                        PLAN_COPY[buyingPlanData?.id ?? '']?.period ?? 'per month'
                      }`,
                      rate: `रू ${Number(paidInvoice.amount).toLocaleString('en-IN')}`,
                      quantity: 1,
                      amount: Number(paidInvoice.amount),
                    }],
                    // Nothing charges tax here yet, and a line saying 0%
                    // is the honest way to show that.
                    taxRate: 0,
                    paidWith: paidInvoice.method,
                    orderId: paidInvoice.orderId,
                    seller: {
                      name: 'Manch',
                      email: 'billing@manch.app',
                      address: 'Kathmandu, Nepal',
                    },
                  }}
                />
                <div className="flex gap-3 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
                      px-6 py-2 text-[14px] font-medium"
                  >
                    Print or save as PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBuyingPlan(''); setPaidInvoice(null); }}
                    className="border border-line rounded-[8px] px-6 py-2 text-[14px]
                      text-body hover:border-navy-800"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <PaymentCheckout
                planName={buyingPlan}
                initialAmount={buyingAmount}
                billing={{
                  name: user.name || user.email,
                  email: user.email,
                  address: user.billing_address || 'Not given',
                }}
                savedMethods={savedMethodChoices}
                onBack={() => setBuyingPlan('')}
                onSuccess={setPaidInvoice}
              />
            )}
          </div>
        </div>
      )}
    </SettingsSheet>
  );
};
