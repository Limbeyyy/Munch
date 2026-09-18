import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { HostPlan, ProfileSummary, UpgradeRequestRow } from '../types';
import { errorText } from './errors';
import { Pair, useOrganizer } from './i18n';
import { Chip, Empty } from './ui';
import {
  FactRow, SectionCard, SectionHeading, SettingsHeading, SettingsSheet,
} from './ProfileView';

const STATUS: Record<UpgradeRequestRow['status'], Pair> = {
  asked: { ne: 'अनुरोध गरिएको', en: 'Requested' },
  done: { ne: 'लागू भयो', en: 'Applied' },
  declined: { ne: 'अस्वीकृत', en: 'Declined' },
};

/** One allowance, drawn as the design draws it: a bar under its name. */
const Meter: React.FC<{
  label: string;
  used: number;
  cap: number | null;
  right: string;
}> = ({ label, used, cap, right }) => {
  // The colour is how close to the ceiling it is, not what it counts:
  // the point of the bar is to be noticed before the ceiling is hit.
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const paint = pct >= 90 ? '#E12121' : pct >= 60 ? '#F25219' : '#101828';
  return (
    <div className="flex flex-col w-full">
      <div className="flex items-start justify-between gap-4">
        <span className="text-[16px] text-[#364153] leading-5">{label}</span>
        <span className="text-[14px] text-subtle leading-4 tabular-nums">{right}</span>
      </div>
      <div className="pt-1.5 w-full">
        <div className="bg-[#f3f4f6] h-1.5 rounded-full overflow-hidden w-full">
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
 * What a host is on, and how to ask for more.
 *
 * No money changes hands here: the request is recorded and an operator
 * applies it. So the page carries the design's shape - the plan on its
 * banner, the allowance as it is spent, the record of what was asked for
 * - without a card on file or an invoice to download, neither of which
 * this system has ever held.
 */
export const SubscriptionView: React.FC = () => {
  const { t, num } = useOrganizer();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [asks, setAsks] = useState<UpgradeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState('');

  const load = useCallback(async () => {
    try {
      const [summary, requests] = await Promise.all([
        apiClient.getProfileSummary(),
        apiClient.getUpgradeRequests().catch(() => ({ requests: [] })),
      ]);
      setProfile(summary);
      setAsks(requests.requests || []);
    } catch {
      toast.error(t({ ne: 'योजना ल्याउन सकिएन', en: 'Could not load the plans' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const ask = async (plan: HostPlan) => {
    setSending(plan.id);
    try {
      await apiClient.requestUpgrade(plan.id);
      toast.success(t({
        ne: `${plan.name} को अनुरोध पठाइयो`,
        en: `Asked for ${plan.name}`,
      }));
      await load();
    } catch (err) {
      toast.error(errorText(err, t({
        ne: 'अनुरोध पठाउन सकिएन', en: 'Could not send the request',
      })));
    } finally {
      setSending('');
    }
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
  const pending = asks.filter((a) => a.status === 'asked');
  const { usage, remaining, user } = profile;

  const capText = (cap: number | null) =>
    cap === null ? t({ ne: 'असीमित', en: 'Unlimited' }) : num(cap);

  const plans = (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
      {profile.plans.map((plan) => {
        const mine = current?.id === plan.id;
        const waiting = pending.some((a) => a.plan === plan.id);
        return (
          <SectionCard
            key={plan.id}
            className={`p-5 flex flex-col gap-3 ${mine ? 'border-navy-800' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-head leading-5">{plan.name}</h3>
              {mine && <Chip tone="ok">{t({ ne: 'हालको', en: 'Current' })}</Chip>}
            </div>
            <p className="text-[12px] text-subtle leading-4">
              {plan.paid
                ? t({ ne: 'सशुल्क योजना', en: 'Paid plan' })
                : t({ ne: 'निःशुल्क परीक्षण', en: 'Free trial' })}
            </p>

            <dl className="flex flex-col gap-2 text-[13px]">
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

            <div className="pt-1">
              {mine ? (
                <button
                  disabled
                  className="w-full rounded-[8px] border-[0.6px] border-line px-3 py-1.5
                    text-[14px] leading-5 text-subtle"
                >
                  {t({ ne: 'यही चलिरहेको छ', en: 'In use' })}
                </button>
              ) : waiting ? (
                <button
                  disabled
                  className="w-full rounded-[8px] border-[0.6px] border-line px-3 py-1.5
                    text-[14px] leading-5 text-subtle"
                >
                  {t({ ne: 'अनुरोध पठाइएको', en: 'Requested' })}
                </button>
              ) : (
                <button
                  disabled={sending === plan.id}
                  onClick={() => ask(plan)}
                  className="w-full rounded-[8px] bg-navy-800 hover:bg-navy-700 px-3 py-1.5
                    text-[14px] leading-5 text-white disabled:opacity-50"
                >
                  {sending === plan.id
                    ? t({ ne: 'पठाउँदै…', en: 'Sending…' })
                    : t({ ne: 'यो योजना माग्ने', en: 'Ask for this plan' })}
                </button>
              )}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );

  return (
    <SettingsSheet>
      <SettingsHeading
        title={{ ne: 'बिलिङ र योजना', en: 'Billing & subscription' }}
        lede={{
          ne: 'तपाईंको योजना, बिलिङ विवरण र अनुरोधहरू।',
          en: 'Manage your plan, billing information and requests.',
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
                  {/* No card is charged, so there is no renewal date to
                      print. Saying how the plan actually changes is the
                      true version of the same line. */}
                  {t({
                    ne: 'योजना सञ्चालकले लागू गर्छ — यहाँ भुक्तानी लिइँदैन।',
                    en: 'An operator applies your plan — no payment is taken here.',
                  })}
                </p>
              </div>
              <a
                href="#manch-plans"
                className="bg-white border-[0.6px] border-line rounded-[8px] px-3 py-1.5
                  text-[14px] text-[#364153] leading-5 flex-none"
              >
                {t({ ne: 'योजना व्यवस्थापन', en: 'Manage subscription' })}
              </a>
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
                />
                <Meter
                  label={t({ ne: 'सत्र', en: 'Sessions' })}
                  used={usage.sessions}
                  cap={null}
                  right={t({
                    ne: `${num(usage.sessions)} · प्रति कार्यक्रम ${capText(current.limits.sessions_per_event)}`,
                    en: `${usage.sessions} · ${capText(current.limits.sessions_per_event)} per event`,
                  })}
                />
                <Meter
                  label={t({ ne: 'सहभागी', en: 'Attendees' })}
                  used={0}
                  cap={null}
                  right={t({
                    ne: `प्रति कार्यक्रम ${capText(current.limits.attendees)}`,
                    en: `${capText(current.limits.attendees)} per event`,
                  })}
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

        {/* Every plan, and the way to ask for one. */}
        <div className="flex flex-col gap-3" id="manch-plans">
          <SectionHeading>{t({ ne: 'योजनाहरू', en: 'Plans' })}</SectionHeading>
          {pending.length > 0 && (
            <p className="text-[12px] text-subtle leading-4">
              {t({
                ne: `${pending[0].plan_name} को अनुरोध प्रतीक्षामा छ।`,
                en: `Your request for ${pending[0].plan_name} is waiting.`,
              })}
            </p>
          )}
          {plans}
        </div>

        {/* Who the plan is held against. There is no card on file. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t({ ne: 'बिलिङ विवरण', en: 'Billing information' })}
          </SectionHeading>
          <SectionCard>
            <FactRow label={t({ ne: 'नाम', en: 'Name' })}>
              {user.name || user.email}
            </FactRow>
            <FactRow label={t({ ne: 'इमेल', en: 'Email' })}>{user.email}</FactRow>
            {user.organization_name && (
              <FactRow label={t({ ne: 'संस्था', en: 'Organization' })}>
                {user.organization_name}
              </FactRow>
            )}
            <FactRow label={t({ ne: 'भुक्तानीको तरिका', en: 'Payment method' })}>
              <span className="text-subtle">
                {t({ ne: 'कुनै कार्ड राखिएको छैन', en: 'No card is held' })}
              </span>
            </FactRow>
          </SectionCard>
          <p className="text-[12px] text-subtle leading-4">
            {t({
              ne: 'यी विवरण प्रोफाइल पानाबाट फेरिन्छन्।',
              en: 'These are changed on the Profile page.',
            })}
          </p>
        </div>

        {/* What was asked for, and what came of it. */}
        <div className="flex flex-col gap-3">
          <SectionHeading>{t({ ne: 'अनुरोधहरू', en: 'Requests' })}</SectionHeading>
          <SectionCard className="bg-sheet">
            {asks.length === 0 ? (
              <div className="px-5 py-4">
                <p className="text-[14px] text-subtle leading-5">
                  {t({
                    ne: 'अझै कुनै अनुरोध छैन।',
                    en: 'No requests yet.',
                  })}
                </p>
              </div>
            ) : (
              asks.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-4 px-5 py-3
                    border-b-[0.6px] border-[#f3f4f6] last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#1E2939] leading-5">
                      {new Date(a.created_at).toLocaleDateString(undefined, {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </p>
                    <p className="text-[12px] text-faint leading-4">
                      {a.from_plan ? `${a.from_plan} → ` : ''}{a.plan_name}
                    </p>
                  </div>
                  <Chip
                    tone={a.status === 'done' ? 'ok' : a.status === 'declined' ? 'warn' : undefined}
                  >
                    {t(STATUS[a.status])}
                  </Chip>
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>
    </SettingsSheet>
  );
};
