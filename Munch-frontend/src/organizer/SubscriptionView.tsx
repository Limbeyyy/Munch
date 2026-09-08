import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { HostPlan, ProfileSummary, UpgradeRequestRow } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Btn, Card, Chip, Empty, Head } from './ui';
import { errorText } from './errors';

const capOf = (n: number | null, t: (p: Pair) => string, num: (n: number) => string) =>
  n === null ? t({ ne: 'असीमित', en: 'Unlimited' }) : num(n);

const STATUS: Record<UpgradeRequestRow['status'], Pair> = {
  asked: { ne: 'अनुरोध गरिएको', en: 'Requested' },
  done: { ne: 'लागू भयो', en: 'Applied' },
  declined: { ne: 'अस्वीकृत', en: 'Declined' },
};

/**
 * Where a host asks for a bigger allowance.
 *
 * No money changes hands here. The request is recorded and an operator
 * applies it, so the page says so plainly rather than implying a checkout
 * that does not exist.
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
      toast.success(
        t({
          ne: `${plan.name} को अनुरोध पठाइयो`,
          en: `Asked for ${plan.name}`,
        })
      );
      await load();
    } catch (err) {
      toast.error(errorText(err, t({ ne: 'अनुरोध पठाउन सकिएन', en: 'Could not send the request' })));
    } finally {
      setSending('');
    }
  };

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }
  if (!profile) {
    return <Card><Empty>{t({ ne: 'योजना उपलब्ध छैन।', en: 'No plans to show.' })}</Empty></Card>;
  }

  // Somebody who has not hosted yet has no plan row, but the free trial is
  // what they would start on - so it is marked current rather than offered,
  // which the server would refuse anyway.
  const current = profile.plan ?? profile.plans.find((p) => !p.paid) ?? null;
  const pending = asks.filter((a) => a.status === 'asked');

  return (
    <>
      <Head
        title={{ ne: 'योजना', en: 'Subscription' }}
        lede={{
          ne: 'तपाईं अहिले जे चलाउँदै हुनुहुन्छ, र बढाउन के छ।',
          en: 'What you are on now, and what more is available.',
        }}
      />

      <Card className="mb-3.5">
        <p className="text-[13px]">
          {t({
            ne: 'यहाँ भुक्तानी लिइँदैन। तपाईंको अनुरोध दर्ता हुन्छ र सञ्चालकले योजना लागू गर्छ — त्यसपछि सीमा आफै बढ्छ।',
            en: 'No payment is taken here. Your request is recorded and an operator applies the plan; your limits move once they do.',
          })}
        </p>
        {pending.length > 0 && (
          <p className="text-[13px] text-[#6E7C8E] mt-2">
            {t({
              ne: `${pending[0].plan_name} को अनुरोध प्रतीक्षामा छ।`,
              en: `Your request for ${pending[0].plan_name} is waiting.`,
            })}
          </p>
        )}
      </Card>

      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}
      >
        {profile.plans.map((plan) => {
          const mine = current?.id === plan.id;
          const waiting = pending.some((a) => a.plan === plan.id);
          return (
            <Card key={plan.id} className={mine ? 'ring-1 ring-saffron-500' : undefined}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[17px] font-semibold">{plan.name}</h3>
                {mine && <Chip tone="ok">{t({ ne: 'हालको', en: 'Current' })}</Chip>}
              </div>
              <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                {plan.paid
                  ? t({ ne: 'सशुल्क योजना', en: 'Paid plan' })
                  : t({ ne: 'निःशुल्क परीक्षण', en: 'Free trial' })}
              </p>

              <dl className="mt-3.5 space-y-2 text-[13px]">
                {(
                  [
                    [{ ne: 'कार्यक्रम', en: 'Events' }, plan.limits.events],
                    [{ ne: 'प्रति कार्यक्रम बैठक', en: 'Meetings per event' }, plan.limits.meetings],
                    [{ ne: 'प्रति बैठक सत्र', en: 'Sessions per meeting' }, plan.limits.sessions_per_meeting],
                    [{ ne: 'सहभागी', en: 'Attendees' }, plan.limits.attendees],
                  ] as [Pair, number | null][]
                ).map(([label, cap]) => (
                  <div key={t(label)} className="flex justify-between gap-3">
                    <dt className="text-[#6E7C8E]">{t(label)}</dt>
                    <dd>{capOf(cap, t, num)}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                {mine ? (
                  <Btn disabled>{t({ ne: 'यही चलिरहेको छ', en: 'In use' })}</Btn>
                ) : waiting ? (
                  <Btn disabled>{t({ ne: 'अनुरोध पठाइएको', en: 'Requested' })}</Btn>
                ) : (
                  <Btn
                    tone="amber"
                    disabled={sending === plan.id}
                    onClick={() => ask(plan)}
                  >
                    {sending === plan.id
                      ? t({ ne: 'पठाउँदै…', en: 'Sending…' })
                      : t({ ne: 'यो योजना माग्ने', en: 'Ask for this plan' })}
                  </Btn>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {asks.length > 0 && (
        <Card className="mt-3.5">
          <h3 className="text-[15px] font-semibold mb-2">
            {t({ ne: 'तपाईंका अनुरोध', en: 'Your requests' })}
          </h3>
          <ul className="text-[13px]">
            {asks.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-navy-800/[.08] last:border-0"
              >
                <span>
                  {a.from_plan ? `${a.from_plan} → ` : ''}
                  {a.plan_name}
                </span>
                <span className="flex items-center gap-2.5">
                  <span className="text-[#6E7C8E] text-[12px]">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                  <Chip tone={a.status === 'done' ? 'ok' : a.status === 'declined' ? 'warn' : undefined}>
                    {t(STATUS[a.status])}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
};
