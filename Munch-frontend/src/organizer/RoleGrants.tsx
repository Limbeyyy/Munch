import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { EventProgramme, ProgrammeRoles, RoleScope } from '../types';
import { Pair, useOrganizer } from './i18n';
import { Btn, Chip, Empty, Panel } from './ui';
import { errorText } from './errors';

const ROLE_LABEL: Record<'co_host' | 'presenter', Pair> = {
  co_host: { ne: 'सह-आयोजक', en: 'Co-host' },
  presenter: { ne: 'प्रस्तोता', en: 'Presenter' },
};

const SCOPE_LABEL: Record<RoleScope, Pair> = {
  event: { ne: 'पूरै कार्यक्रम', en: 'Whole event' },
  meeting: { ne: 'एउटा बैठक', en: 'One meeting' },
  session: { ne: 'एउटा सत्र', en: 'One session' },
};

const SCOPE_HINT: Record<RoleScope, Pair> = {
  event: {
    ne: 'यो कार्यक्रमका सबै बैठक र सत्रभर — कार्यक्रम चलेसम्म।',
    en: 'Every meeting and session in this programme, for as long as it runs.',
  },
  meeting: {
    ne: 'त्यही बैठक र त्यसभित्रका सत्रमा मात्र। अर्को बैठकमा लागू हुँदैन।',
    en: 'That meeting and the sessions inside it. Not the next meeting.',
  },
  session: {
    ne: 'त्यही एउटा सत्रमा मात्र।',
    en: 'That one session, and nothing else.',
  },
};

/**
 * Who helps run the programme, and over how much of it.
 *
 * A role is given at one scope and reaches exactly that far. The host
 * names a co-host by the address they know them at, so it works before
 * that person has ever signed in; the account is tied to it when they do.
 *
 * Speakers are shown alongside but are not granted here - a session names
 * its own speaker, and naming them is what makes them its presenter.
 */
export const RoleGrants: React.FC<{ event: EventProgramme | null }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const [roles, setRoles] = useState<ProgrammeRoles | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'co_host' | 'presenter'>('co_host');
  const [scope, setScope] = useState<RoleScope>('event');
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!event) { setRoles(null); return; }
    try {
      setRoles(await apiClient.getProgrammeRoles(event.id));
    } catch {
      setRoles({ granted: [], speakers: [] });
    }
  }, [event]);

  useEffect(() => { load(); }, [load]);

  const sessions = (event?.meetings ?? []).flatMap((m) =>
    m.sessions.map((s) => ({ id: s.id, label: `${s.title} — ${m.title}` }))
  );
  const targets = scope === 'meeting'
    ? (event?.meetings ?? []).map((m) => ({ id: m.id, label: m.title }))
    : scope === 'session' ? sessions : [];

  const give = async () => {
    if (!event) return;
    if (!email.trim()) {
      toast.error(t({ ne: 'इमेल लेख्नुहोस्', en: 'Give an email address' }));
      return;
    }
    if (scope !== 'event' && !scopeId) {
      toast.error(
        scope === 'meeting'
          ? t({ ne: 'कुन बैठक भन्नुहोस्', en: 'Say which meeting' })
          : t({ ne: 'कुन सत्र भन्नुहोस्', en: 'Say which session' })
      );
      return;
    }
    try {
      setBusy(true);
      await apiClient.grantRole(event.id, {
        email: email.trim(),
        role,
        scope,
        ...(scope === 'event' ? {} : { scope_id: scopeId }),
      });
      toast.success(
        t({
          ne: `${email.trim()} लाई ${t(ROLE_LABEL[role])} तोकियो`,
          en: `${email.trim()} is now a ${t(ROLE_LABEL[role]).toLowerCase()} here`,
        })
      );
      setEmail('');
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'तोक्न सकिएन', en: 'Could not set that' })));
    } finally { setBusy(false); }
  };

  const take = async (id: string, who: string) => {
    if (!event) return;
    const ok = window.confirm(
      t({
        ne: `${who} को भूमिका हटाउने?`,
        en: `Take this role away from ${who}?`,
      })
    );
    if (!ok) return;
    try {
      await apiClient.revokeRole(event.id, id);
      toast.success(t({ ne: 'हटाइयो', en: 'Removed' }));
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove it' })));
    }
  };

  if (!event) {
    return <Panel><Empty>{t({ ne: 'कार्यक्रम छान्नुहोस्।', en: 'Pick a programme.' })}</Empty></Panel>;
  }

  const field = 'w-full border border-navy-800/15 rounded-lg px-2.5 py-1.5 text-[13.5px] bg-white';

  return (
    <div className="flex flex-col gap-3.5">
      <Panel
        title={t({ ne: 'सह-आयोजक तोक्नुहोस्', en: 'Name a co-host' })}
        aside={
          <span className="text-[12.5px] text-[#6E7C8E]">
            {t({
              ne: 'खाता नभए पनि इमेलले तोक्न सकिन्छ।',
              en: 'The address is enough; they need not have signed in yet.',
            })}
          </span>
        }
      >
        <div className="px-4 pb-1">
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.4fr)_140px_150px]">
            <div>
              <label className="block text-[12px] text-[#6E7C8E] mb-1">
                {t({ ne: 'इमेल', en: 'Email' })}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                className={field}
              />
            </div>
            <div>
              <label className="block text-[12px] text-[#6E7C8E] mb-1">
                {t({ ne: 'भूमिका', en: 'Role' })}
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'co_host' | 'presenter')}
                className={field}
              >
                {(['co_host', 'presenter'] as const).map((r) => (
                  <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-[#6E7C8E] mb-1">
                {t({ ne: 'कति भरि', en: 'Covering' })}
              </label>
              <select
                value={scope}
                onChange={(e) => { setScope(e.target.value as RoleScope); setScopeId(''); }}
                className={field}
              >
                {(['event', 'meeting', 'session'] as const).map((s) => (
                  <option key={s} value={s}>{t(SCOPE_LABEL[s])}</option>
                ))}
              </select>
            </div>
          </div>

          {scope !== 'event' && (
            <div className="mt-2.5">
              <label className="block text-[12px] text-[#6E7C8E] mb-1">
                {scope === 'meeting'
                  ? t({ ne: 'कुन बैठक', en: 'Which meeting' })
                  : t({ ne: 'कुन सत्र', en: 'Which session' })}
              </label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className={`${field} max-w-lg`}
              >
                <option value="">{t({ ne: '— छान्नुहोस् —', en: '— pick one —' })}</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>{target.label}</option>
                ))}
              </select>
            </div>
          )}

          <p className="mt-2 text-[12px] text-[#6E7C8E]">{t(SCOPE_HINT[scope])}</p>

          <div className="mt-3 mb-1">
            <Btn tone="amber" disabled={busy} onClick={give}>
              {t({ ne: 'तोक्नुहोस्', en: 'Give the role' })}
            </Btn>
          </div>
        </div>
      </Panel>

      <Panel
        title={t({ ne: 'तोकिएका भूमिका', en: 'Roles given' })}
        aside={
          <span className="text-[12.5px] text-[#6E7C8E]">
            {t({
              ne: `${num(roles?.granted.length ?? 0)} जना`,
              en: `${roles?.granted.length ?? 0} ${roles?.granted.length === 1 ? 'person' : 'people'}`,
            })}
          </span>
        }
      >
        <div className="px-4">
          {!roles ? (
            <Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty>
          ) : roles.granted.length === 0 ? (
            <Empty>
              {t({
                ne: 'अझै कसैलाई तोकिएको छैन। सह-आयोजक तोक्दा त्यो जति भागमा तोक्नुभयो, त्यति भरि मात्र लागू हुन्छ।',
                en: 'Nobody yet. A role covers what you give it over, and nothing beyond.',
              })}
            </Empty>
          ) : (
            roles.granted.map((grant) => (
              <div
                key={grant.id}
                className="flex items-center gap-3 py-3 border-b border-navy-800/[.08] last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium truncate">{grant.email}</p>
                  <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                    {t(SCOPE_LABEL[grant.scope])} · {grant.scope_title}
                  </p>
                </div>
                <span className="ml-auto flex items-center gap-1.5 flex-none">
                  <Chip tone={grant.role === 'co_host' ? 'ok' : 'default'}>
                    {t(ROLE_LABEL[grant.role])}
                  </Chip>
                  {!grant.accepted && (
                    <Chip tone="draft">{t({ ne: 'पर्खाइमा', en: 'Not signed in yet' })}</Chip>
                  )}
                  <Btn sm tone="danger" onClick={() => take(grant.id, grant.email)}>
                    {t({ ne: 'हटाउने', en: 'Remove' })}
                  </Btn>
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel
        title={t({ ne: 'वक्ता — आफैँ प्रस्तोता', en: 'Speakers, presenters by definition' })}
        aside={
          <span className="text-[12.5px] text-[#6E7C8E]">
            {t({
              ne: 'सत्रमा नाम राख्दा नै प्रस्तोता बन्छन् — छुट्टै तोक्नु पर्दैन।',
              en: 'Naming somebody on a session is what makes them its presenter.',
            })}
          </span>
        }
      >
        <div className="px-4">
          {(roles?.speakers.length ?? 0) === 0 ? (
            <Empty>
              {t({
                ne: 'कुनै सत्रमा वक्ता तोकिएको छैन।',
                en: 'No session names a speaker yet.',
              })}
            </Empty>
          ) : (
            roles!.speakers.map((speaker) => (
              <div
                key={speaker.email || speaker.name}
                className="flex items-start gap-3 py-3 border-b border-navy-800/[.08] last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium truncate">{speaker.name}</p>
                  <p className="text-[12.5px] text-[#6E7C8E] mt-0.5 truncate">
                    {speaker.email || t({ ne: 'इमेल छैन', en: 'no email on file' })}
                  </p>
                  <p className="text-[12px] text-[#6E7C8E] mt-1">
                    {speaker.sessions.map((s) => `${s.title} (${s.meeting})`).join(' · ')}
                  </p>
                </div>
                <span className="ml-auto flex-none">
                  <Chip tone="default">{t(ROLE_LABEL.presenter)}</Chip>
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
};
