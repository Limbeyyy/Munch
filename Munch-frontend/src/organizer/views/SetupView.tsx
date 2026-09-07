import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EventProgramme, Meeting } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { Btn, Card, Chip, Empty, Head, Panel } from '../ui';

interface Props {
  meetings: Meeting[];
  onNavigate: (view: string) => void;
  onCreate: () => void;
}

/** One line of the checklist, judged against what is really there. */
interface Check {
  ok: boolean;
  /** Not done, and the next thing worth doing. */
  now?: boolean;
  title: Pair;
  lede: Pair;
  action: string;
}

/** The group that holds meetings belonging to no programme. */
const LOOSE = '__loose__';

/** What an event's checklist is judged on, fetched when it is opened. */
interface Facts {
  sessions: number;
  invites: number;
  presenters: number;
  files: number;
  started: boolean;
}

export const SetupView: React.FC<Props> = ({ meetings, onNavigate, onCreate }) => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [facts, setFacts] = useState<Record<string, Facts>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  // Meetings made before events existed still deserve a checklist, so they
  // are gathered under one heading of their own.
  const loose = meetings.filter((m) => !events.some((e) => e.meetings.some((em) => em.id === m.id)));

  useEffect(() => {
    apiClient
      .listEvents()
      .then(setEvents)
      .catch(() => toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the events' })))
      .finally(() => setLoading(false));
  }, [t]);

  /** Gather an event's figures only when somebody opens it. */
  const gather = useCallback(async (
    key: string,
    meetingIds: string[],
    sessions: number | null,
    started: boolean
  ) => {
    if (facts[key] || checking[key]) return;
    setChecking((v) => ({ ...v, [key]: true }));

    const [invites, participants, files, sessionLists, granted] = await Promise.all([
      Promise.allSettled(meetingIds.map((id) => apiClient.getMeetingInvites(id))),
      Promise.allSettled(meetingIds.map((id) => apiClient.getParticipants(id))),
      Promise.allSettled(meetingIds.map((id) => apiClient.getResources(id))),
      // An event already knows its session count; a loose meeting does not.
      sessions === null
        ? Promise.allSettled(meetingIds.map((id) => apiClient.listSessions(id)))
        : Promise.resolve([]),
      // Roles are given per programme, and to addresses that need not have
      // signed in - so they are not visible in the participant lists. The
      // loose-meetings group is not a programme and has none to fetch.
      key === LOOSE
        ? Promise.resolve(null)
        : apiClient.getProgrammeRoles(key).catch(() => null),
    ]);

    const total = (rs: PromiseSettledResult<any[]>[]) =>
      rs.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.length : 0), 0);

    // Somebody counts as named whether they hold a role in the room, were
    // given one over part of the programme, or are down as a speaker -
    // which is itself a presenting role.
    const inTheRoom = participants.reduce(
      (sum, r) =>
        sum +
        (r.status === 'fulfilled'
          ? r.value.filter((p: any) => ['co_host', 'presenter'].includes(p.role)).length
          : 0),
      0
    );
    const presenters =
      inTheRoom + (granted ? granted.granted.length + granted.speakers.length : 0);

    setFacts((v) => ({
      ...v,
      [key]: {
        sessions: sessions === null ? total(sessionLists as PromiseSettledResult<any[]>[]) : sessions,
        invites: total(invites),
        presenters,
        files: total(files),
        started,
      },
    }));
    setChecking((v) => ({ ...v, [key]: false }));
  }, [facts, checking]);

  const buildChecks = (f: Facts, meetingCount: number): Check[] => {
    const list: Check[] = [
      {
        ok: f.sessions > 0,
        title: { ne: 'सत्र बनाउनुहोस्', en: 'Create the sessions' },
        lede: f.sessions
          ? { ne: `${num(f.sessions)} सत्र तालिकामा`, en: `${f.sessions} session${f.sessions === 1 ? '' : 's'} scheduled` }
          : { ne: `${num(meetingCount)} बैठक छन्, तर सत्र छैन`, en: `${meetingCount} meeting(s), but no sessions yet` },
        action: 'events',
      },
      {
        ok: f.invites > 0,
        title: { ne: 'सहभागीलाई निम्तो', en: 'Invite the attendees' },
        lede: f.invites
          ? { ne: `${num(f.invites)} निम्तो पठाइएको`, en: `${f.invites} invitation${f.invites === 1 ? '' : 's'} sent` }
          : { ne: 'निम्तोको सङ्ख्याले अपेक्षित उपस्थिति बनाउँछ', en: 'Invitations set the expected headcount' },
        action: 'attendance',
      },
      {
        ok: f.presenters > 0,
        title: { ne: 'भूमिका मिलाउनुहोस्', en: 'Set the roles' },
        lede: f.presenters
          ? { ne: `${num(f.presenters)} प्रस्तोता/सह-आयोजक`, en: `${f.presenters} presenter${f.presenters === 1 ? '' : 's'} or co-host${f.presenters === 1 ? '' : 's'}` }
          : { ne: 'प्रस्तोता र सह-आयोजक तोक्नुहोस्', en: 'Name your presenters and co-hosts' },
        action: 'people',
      },
      {
        ok: f.files > 0,
        title: { ne: 'सामग्री राख्नुहोस्', en: 'Add the materials' },
        lede: f.files
          ? { ne: `${num(f.files)} फाइल आयोजकको ड्राइभमा`, en: `${f.files} file${f.files === 1 ? '' : 's'} in the host's Drive` }
          : { ne: 'सत्रका स्लाइड र कागज अपलोड गर्नुहोस्', en: 'Upload the slides and papers for each session' },
        action: 'content',
      },
      {
        ok: true,
        title: { ne: 'हलको यन्त्र', en: 'The hall device' },
        lede: {
          ne: 'यन्त्रले बोलेको कुरा पाठमा पठाउँछ — अडियो सर्भरमा आउँदैन।',
          en: 'The device sends speech as text — no audio reaches the server.',
        },
        action: 'settings',
      },
      {
        ok: f.started,
        title: { ne: 'कार्यक्रम चलाउनुहोस्', en: 'Run the event' },
        lede: f.started
          ? { ne: 'सत्र सुरु भइसकेको छ', en: 'A session has been started' }
          : { ne: 'लाइभ नियन्त्रणबाट सुरु गर्नुहोस्', en: 'Start it from live control' },
        action: 'live',
      },
    ];

    // Mark the first outstanding item, so the eye lands on what is next.
    const next = list.find((c) => !c.ok);
    if (next) next.now = true;
    return list;
  };

  const Checklist: React.FC<{ checks: Check[] }> = ({ checks }) => (
    <div>
      {checks.map((check) => (
        <div
          key={check.title.en}
          className="flex items-center gap-3 px-4 py-3.5 border-b border-navy-800/[.08] last:border-0"
        >
          <span
            className={`w-6 h-6 rounded-full grid place-items-center flex-none text-xs border-2 ${
              check.ok
                ? 'bg-ok border-ok text-white'
                : check.now
                ? 'border-amber text-amber-700 font-bold'
                : 'border-navy-800/15 text-[#6E7C8E]'
            }`}
          >
            {check.ok ? '✓' : '!'}
          </span>
          <div className="min-w-0">
            <h4 className="text-[14.5px] font-medium">{t(check.title)}</h4>
            <p className="text-[12.5px] text-[#6E7C8E]">{t(check.lede)}</p>
          </div>
          <span className="ml-auto flex-none">
            <Btn sm onClick={() => onNavigate(check.action)}>
              {check.ok ? t({ ne: 'हेर्नुहोस्', en: 'Review' }) : t({ ne: 'पूरा गर्नुहोस्', en: 'Finish' })}
            </Btn>
          </span>
        </div>
      ))}
    </div>
  );

  const Ring: React.FC<{ done: number; total: number }> = ({ done, total }) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <div
        className="w-11 h-11 rounded-full flex-none grid place-items-center"
        style={{ background: `conic-gradient(#1B7F58 ${pct}%, #EFE8D8 0)` }}
        title={`${done}/${total}`}
      >
        <span className="w-[34px] h-[34px] rounded-full bg-white grid place-items-center text-[11px] font-semibold tabular-nums">
          {num(pct)}%
        </span>
      </div>
    );
  };

  /** One expandable row: an event, or the meetings that sit outside one. */
  const Group: React.FC<{
    id: string;
    title: string;
    subtitle: string;
    meetingIds: string[];
    sessions: number | null;
    started: boolean;
  }> = ({ id, title, subtitle, meetingIds, sessions, started }) => {
    const shown = !!open[id];
    const f = facts[id];
    const checks = f ? buildChecks(f, meetingIds.length) : null;
    const done = checks ? checks.filter((c) => c.ok).length : 0;

    return (
      <Panel
        title={
          <button
            onClick={() => {
              setOpen((v) => ({ ...v, [id]: !shown }));
              if (!shown) gather(id, meetingIds, sessions, started);
            }}
            className="flex items-center gap-2 text-left min-w-0"
          >
            <span className={`text-[#6E7C8E] transition-transform ${shown ? 'rotate-90' : ''}`}>›</span>
            <span className="text-[15.5px] font-semibold truncate">{title}</span>
          </button>
        }
        aside={
          <span className="flex items-center gap-2 text-[12.5px] text-[#6E7C8E]">
            {subtitle}
            {checks && (
              <Chip tone={done === checks.length ? 'ok' : 'warn'}>
                {t({
                  ne: `${num(done)}/${num(checks.length)} पूरा`,
                  en: `${done} of ${checks.length} done`,
                })}
              </Chip>
            )}
          </span>
        }
        actions={checks ? <Ring done={done} total={checks.length} /> : undefined}
      >
        {shown && (
          checking[id] || !checks ? (
            <Empty>{t({ ne: 'जाँच्दै…', en: 'Checking…' })}</Empty>
          ) : (
            <Checklist checks={checks} />
          )
        )}
      </Panel>
    );
  };

  return (
    <>
      <Head
        title={{ ne: 'सेटअप', en: 'Setup' }}
        lede={{
          ne: 'हरेक कार्यक्रमको आफ्नै जाँचसूची — खोल्नुहोस् र के बाँकी छ हेर्नुहोस्।',
          en: 'Each event carries its own checklist — open one to see what it still needs.',
        }}
        actions={<Btn tone="amber" onClick={onCreate}>{t({ ne: '+ नयाँ सत्र', en: '+ New session' })}</Btn>}
      />

      {loading ? (
        <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      ) : events.length === 0 && loose.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E] max-w-md mx-auto">
            {t({
              ne: 'अझै कुनै कार्यक्रम छैन। कार्यक्रम पानाबाट दिनको कार्यक्रम बनाउनुहोस्।',
              en: 'No events yet. Build a day from the Programme page.',
            })}
          </p>
          <Btn tone="amber" className="mt-4" onClick={() => onNavigate('events')}>
            {t({ ne: 'कार्यक्रम खोल्नुहोस्', en: 'Open Programme' })}
          </Btn>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <Group
              key={event.id}
              id={event.id}
              title={event.title}
              subtitle={[
                new Date(event.event_date).toLocaleDateString(undefined, {
                  weekday: 'short', day: 'numeric', month: 'short',
                }),
                event.venue,
                t({
                  ne: `${num(event.meeting_count)} बैठक · ${num(event.session_count)} सत्र`,
                  en: `${event.meeting_count} meetings · ${event.session_count} sessions`,
                }),
              ].filter(Boolean).join(' · ')}
              meetingIds={event.meetings.map((m) => m.id)}
              sessions={event.session_count}
              started={event.meetings.some((m) => !!m.started_at)}
            />
          ))}

          {loose.length > 0 && (
            <Group
              id={LOOSE}
              title={t({ ne: 'कार्यक्रम बाहिरका बैठक', en: 'Meetings outside any event' })}
              subtitle={t({
                ne: `${num(loose.length)} बैठक`,
                en: `${loose.length} meeting${loose.length === 1 ? '' : 's'}`,
              })}
              meetingIds={loose.map((m) => m.id)}
              sessions={null}
              started={loose.some((m) => !!m.started_at)}
            />
          )}
        </div>
      )}
    </>
  );
};
