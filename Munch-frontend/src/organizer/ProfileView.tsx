import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { ProfileSummary } from '../types';
import { Pair, useOrganizer } from './i18n';
import { BarRow, Btn, Card, Chip, Empty, Head } from './ui';

const Line: React.FC<{ label: Pair; children: React.ReactNode }> = ({ label, children }) => {
  const { t } = useOrganizer();
  return (
    <div className="flex gap-3 py-2 text-[13.5px] border-b border-navy-800/[.08] last:border-0">
      <span className="text-[#6E7C8E] w-[150px] flex-none">{t(label)}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
};

/**
 * Who somebody is here, and what their plan leaves them.
 *
 * The allowance is shown as it is spent rather than as a feature list: a
 * host wants to know whether they can open another programme today, which
 * is a different question from what the tier includes.
 */
export const ProfileView: React.FC<{ onNavigate?: (view: string) => void }> = ({
  onNavigate,
}) => {
  const { t, num } = useOrganizer();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setProfile(await apiClient.getProfileSummary());
    } catch {
      toast.error(t({ ne: 'विवरण ल्याउन सकिएन', en: 'Could not load your details' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>;
  }
  if (!profile) {
    return <Card><Empty>{t({ ne: 'विवरण उपलब्ध छैन।', en: 'Nothing to show.' })}</Empty></Card>;
  }

  const { user, plan, usage, remaining } = profile;

  const allowance: { label: Pair; used: number; cap: number | null; left: number | null }[] =
    plan && usage
      ? [
          {
            label: { ne: 'कार्यक्रम', en: 'Events' },
            used: usage.events, cap: plan.limits.events, left: remaining.events,
          },
          {
            label: { ne: 'बैठक', en: 'Meetings' },
            used: usage.meetings, cap: plan.limits.meetings, left: remaining.meetings,
          },
        ]
      : [];

  return (
    <>
      <Head
        title={{ ne: 'प्रोफाइल', en: 'Profile' }}
        lede={{
          ne: 'तपाईंको विवरण, योजना, र कति बाँकी छ।',
          en: 'Your details, your plan, and what is left of it.',
        }}
      />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        <Card>
          <div className="flex items-center gap-3">
            <span className="w-14 h-14 rounded-full bg-navy-700 text-white grid place-items-center text-[20px] font-bold flex-none">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold truncate">
                {user.name || user.email}
              </h3>
              <p className="text-[12.5px] text-[#6E7C8E] truncate">{user.email}</p>
            </div>
          </div>

          <div className="mt-4">
            <Line label={{ ne: 'भूमिका', en: 'You are' }}>
              <span className="flex gap-1.5 flex-wrap">
                {profile.is_host && (
                  <Chip tone="ok">{t({ ne: 'आयोजक', en: 'Host' })}</Chip>
                )}
                {profile.is_attendee && (
                  <Chip>{t({ ne: 'सहभागी', en: 'Attendee' })}</Chip>
                )}
                {!profile.is_host && !profile.is_attendee && (
                  <span className="text-[#6E7C8E]">
                    {t({ ne: 'अझै कतै जोडिएको छैन', en: 'Not on a programme yet' })}
                  </span>
                )}
              </span>
            </Line>
            <Line label={{ ne: 'साइन इन', en: 'Signed in with' }}>
              {user.signed_in_with_google
                ? t({ ne: 'गुगल', en: 'Google' })
                : t({ ne: 'इमेल', en: 'Email' })}
              {user.is_verified && (
                <span className="ms-1.5">
                  <Chip tone="ok">{t({ ne: 'प्रमाणित', en: 'Verified' })}</Chip>
                </span>
              )}
            </Line>
            <Line label={{ ne: 'सामेल भएको', en: 'Joined' }}>
              {new Date(user.joined).toLocaleDateString(undefined, {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </Line>
            <Line label={{ ne: 'समय क्षेत्र', en: 'Timezone' }}>{user.timezone}</Line>
          </div>
        </Card>

        <Card>
          {plan ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] text-[#6E7C8E]">
                    {t({ ne: 'तपाईंको योजना', en: 'Your plan' })}
                  </p>
                  <h3 className="text-[19px] font-semibold">
                    {plan.name}
                    {!plan.paid && (
                      <span className="ms-2 text-[12.5px] font-normal text-[#6E7C8E]">
                        {t({ ne: 'निःशुल्क परीक्षण', en: 'free trial' })}
                      </span>
                    )}
                  </h3>
                </div>
                <Btn tone="amber" onClick={() => onNavigate?.('subscription')}>
                  {t({ ne: 'योजना बदल्ने', en: 'Change plan' })}
                </Btn>
              </div>

              <div className="mt-4 space-y-3">
                {allowance.map((row) =>
                  row.cap === null ? (
                    <div key={t(row.label)} className="flex justify-between text-[13px]">
                      <span>{t(row.label)}</span>
                      <span className="text-[#6E7C8E]">
                        {t({ ne: 'असीमित', en: 'Unlimited' })}
                      </span>
                    </div>
                  ) : (
                    <BarRow
                      key={t(row.label)}
                      label={t(row.label)}
                      pct={Math.min(100, Math.round((row.used / row.cap) * 100))}
                      right={t({
                        ne: `${num(row.left ?? 0)} बाँकी · ${num(row.used)}/${num(row.cap)}`,
                        en: `${row.left} left of ${row.cap}`,
                      })}
                    />
                  )
                )}

                <div className="flex justify-between text-[13px] pt-1">
                  <span>{t({ ne: 'प्रति बैठक सत्र', en: 'Sessions per meeting' })}</span>
                  <span className="text-[#6E7C8E]">
                    {plan.limits.sessions_per_meeting === null
                      ? t({ ne: 'असीमित', en: 'Unlimited' })
                      : t({
                          ne: `${num(plan.limits.sessions_per_meeting)} सम्म`,
                          en: `up to ${plan.limits.sessions_per_meeting}`,
                        })}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span>{t({ ne: 'सहभागी', en: 'Attendees' })}</span>
                  <span className="text-[#6E7C8E]">
                    {plan.limits.attendees === null
                      ? t({ ne: 'असीमित', en: 'Unlimited' })
                      : t({
                          ne: `${num(plan.limits.attendees)} सम्म`,
                          en: `up to ${plan.limits.attendees}`,
                        })}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-[17px] font-semibold">
                {t({ ne: 'तपाईं आयोजक होइन', en: 'You are not hosting yet' })}
              </h3>
              <p className="text-[13px] text-[#6E7C8E] mt-1">
                {t({
                  ne: 'कार्यक्रम खोल्नु भए निःशुल्क परीक्षण सुरु हुन्छ — २ कार्यक्रम, प्रत्येकमा २ बैठक, प्रत्येकमा २ सत्र।',
                  en: 'Opening a programme starts the free trial: 2 events, 2 meetings each, 2 sessions each.',
                })}
              </p>
              <Btn tone="amber" className="mt-3" onClick={() => onNavigate?.('subscription')}>
                {t({ ne: 'योजना हेर्नुहोस्', en: 'See the plans' })}
              </Btn>
            </>
          )}
        </Card>
      </div>
    </>
  );
};
