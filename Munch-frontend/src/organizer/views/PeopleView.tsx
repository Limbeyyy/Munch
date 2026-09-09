import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { QUEUE_POLL_MS } from '../../services/polling';
import {
  AttendanceReport, EventMeeting, EventProgramme, MeetingParticipant, Session,
} from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { ContactRequests } from '../ContactRequests';
import { groupBySpeaker } from '../speakers';
import { RoleGrants } from '../RoleGrants';
import { Card, Chip, Empty, Head, Panel, Tabs } from '../ui';
import { SESSION_STATE_LABEL, SESSION_STATE_TONE, sessionState } from '../sessionState';

type Role = 'host' | 'co_host' | 'presenter' | 'attendee';

const ROLE_LABEL: Record<Role, Pair> = {
  host: { ne: 'आयोजक', en: 'Host' },
  co_host: { ne: 'सह-आयोजक', en: 'Co-host' },
  presenter: { ne: 'प्रस्तोता', en: 'Presenter' },
  attendee: { ne: 'सहभागी', en: 'Attendee' },
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const nameOf = (
  user?: { first_name?: string; last_name?: string; email?: string } | null
) => {
  if (!user) return '—';
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || user.email
    || '—';
};

interface Slot { session: Session; meeting: EventMeeting; }

/** One person, and every session of theirs in this programme. */
interface Speaker {
  key: string;
  name: string;
  email: string;
  phone: string;
  slots: Slot[];
  visibility: 'public' | 'private' | 'mixed';
}

interface Props { meetings: any[]; currentUserId?: string; }

/**
 * Who is speaking, and who is running the room.
 *
 * These are two different lists. A speaker is named on a session and often
 * has no account at all; a team member holds a role in a meeting and may
 * never speak. Treating them as one list was why neither read properly.
 */
export const PeopleView: React.FC<Props> = ({ currentUserId }) => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState('speakers');
  const [participants, setParticipants] = useState<Record<string, MeetingParticipant[]>>({});
  const [turnout, setTurnout] = useState<Record<string, AttendanceReport | null>>({});
  const [changing, setChanging] = useState<string | null>(null);
  const [settingVisibility, setSettingVisibility] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [grantCount, setGrantCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .listEvents()
      .then((list) => {
        setEvents(list);
        setEventId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the events' })))
      .finally(() => setLoading(false));
  }, [t]);

  const event = events.find((e) => e.id === eventId) ?? null;

  /**
   * The team of each meeting, and how many seats its sessions filled.
   *
   * Everyone who was there, not everyone who is there: ending a meeting
   * empties the room, so asking the room's question here showed a finished
   * meeting as having had no team at all.
   */
  const loadParticipants = useCallback(async () => {
    if (!event) { setParticipants({}); setTurnout({}); return; }
    const results = await Promise.allSettled(
      event.meetings.map(async (m) => [
        m.id,
        await apiClient.getParticipants(m.id, true),
        await apiClient.getAttendance(m.id).catch(() => null),
      ] as const)
    );
    const next: Record<string, MeetingParticipant[]> = {};
    const seats: Record<string, AttendanceReport | null> = {};
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      next[r.value[0]] = r.value[1];
      seats[r.value[0]] = r.value[2];
    });
    setParticipants(next);
    setTurnout(seats);
  }, [event]);

  useEffect(() => { loadParticipants(); }, [loadParticipants]);

  // Just the counts for the tab labels; each panel fetches its own list.
  useEffect(() => {
    if (!eventId) { setGrantCount(0); return; }
    apiClient
      .getProgrammeRoles(eventId)
      .then((roles) => setGrantCount(roles.granted.length))
      .catch(() => setGrantCount(0));
  }, [eventId, tab]);

  // Only the count, so the tab can say how many are waiting. The list
  // itself is the shared component's business.
  useEffect(() => {
    if (!eventId) { setPendingRequests(0); return; }
    apiClient
      .listContactRequests({ event: eventId, status: 'pending' })
      .then((rows) => setPendingRequests(rows.length))
      .catch(() => setPendingRequests(0));
  }, [eventId, tab]);

  /**
   * Speakers come from the running order, not from anybody's account.
   *
   * One speaker is one person, however many sessions they hold. Two people
   * who happen to share a name are told apart by their email, which is the
   * thing that actually identifies a contact; only where no email was
   * given does the name have to stand in for one.
   */
  const speakers = useMemo((): Speaker[] => {
    if (!event) return [];

    // In the order they first appear in the day.
    const slots: Slot[] = event.meetings.flatMap((meeting) =>
      [...meeting.sessions]
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .map((session) => ({ session, meeting }))
    );

    return groupBySpeaker(slots, (slot) => slot.session).map(({ key, name, rows }) => {
      const first = rows[0].session;
      const states = Array.from(new Set(rows.map((r) => r.session.speaker_visibility)));
      return {
        key,
        name,
        email: first.speaker_contact?.email ?? '',
        phone: first.speaker_contact?.phone ?? '',
        slots: rows,
        // Held public on one session and private on another is neither:
        // the card says so rather than picking one at random.
        visibility: states.length === 1 ? states[0] : 'mixed',
      };
    });
  }, [event]);

  const unnamed = useMemo(() => {
    if (!event) return [];
    return event.meetings.flatMap((meeting) =>
      meeting.sessions
        .filter((s) => !s.speaker_name?.trim())
        .map((session) => ({ session, meeting }))
    );
  }, [event]);

  const changeRole = async (meeting: EventMeeting, p: MeetingParticipant, role: Role) => {
    if (role === p.role || !p.user) return;
    if (role === 'host') {
      const ok = window.confirm(
        t({
          ne: `${nameOf(p.user)} लाई “${meeting.title}” को आयोजक बनाउने?\n\nतपाईं सह-आयोजक हुनुहुनेछ।`,
          en: `Make ${nameOf(p.user)} the host of “${meeting.title}”?\n\nYou become a co-host.`,
        })
      );
      if (!ok) return;
    }
    try {
      setChanging(p.id);
      await apiClient.updateParticipantRole(meeting.id, p.user.id, role);
      await loadParticipants();
      const label = t(ROLE_LABEL[role]);
      toast.success(
        t({
          ne: `${nameOf(p.user)} अब ${label}`,
          en: `${nameOf(p.user)} is now ${label.toLowerCase()}`,
        })
      );
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'भूमिका बदल्न सकिएन', en: 'Could not change the role' }));
    } finally { setChanging(null); }
  };

  /**
   * List a speaker publicly, or take them back off the list.
   *
   * Every session this person holds moves together, because the setting
   * describes the person rather than one appearance. The server is what
   * actually enforces it; this reloads so the card shows what was stored
   * rather than what was clicked.
   */
  const setVisibility = async (speaker: Speaker, visibility: 'public' | 'private') => {
    if (speaker.visibility === visibility) return;
    try {
      setSettingVisibility(speaker.key);
      await apiClient.setSpeakerVisibility(
        speaker.slots.map((s) => s.session.id),
        visibility
      );
      const list = await apiClient.listEvents();
      setEvents(list);
      toast.success(
        visibility === 'public'
          ? t({
              ne: `${speaker.name} को सम्पर्क सबैले देख्न सक्छन्`,
              en: `${speaker.name}'s details are open to attendees`,
            })
          : t({
              ne: `${speaker.name} को सम्पर्क अब अनुरोध गरेर मात्र`,
              en: `${speaker.name}'s details now go through you`,
            })
      );
    } catch (e: any) {
      toast.error(
        e.response?.data?.error ?? t({ ne: 'बदल्न सकिएन', en: 'Could not change it' })
      );
    } finally {
      setSettingVisibility(null);
    }
  };

  const teamCount = Object.values(participants).reduce((n, rows) => n + rows.length, 0);

  return (
    <>
      <Head
        title={{ ne: 'वक्ता र टोली', en: 'Speakers and team' }}
        lede={{
          ne: 'वक्ता सत्रमा तोकिन्छन् — खाता नभए पनि हुन्छ। टोली भनेको कोठा चलाउने भूमिका हो।',
          en: 'Speakers are named on sessions and need no account. The team is who runs the room.',
        }}
      />

      {!loading && events.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E]">
            {t({ ne: 'अझै कुनै कार्यक्रम छैन।', en: 'No events yet.' })}
          </p>
        </Card>
      ) : (
        <>
          {events.length > 1 && (
            <div className="mb-4">
              <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
                {t({ ne: 'कुन कार्यक्रम', en: 'Which event' })}
              </label>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {new Date(e.event_date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'speakers', label: { ne: `वक्ता (${num(speakers.length)})`, en: `Speakers (${speakers.length})` } },
              { id: 'team', label: { ne: `टोली (${num(teamCount)})`, en: `Team (${teamCount})` } },
              {
                id: 'roles',
                label: { ne: `भूमिका (${num(grantCount)})`, en: `Roles (${grantCount})` },
              },
              {
                id: 'contacts',
                label: pendingRequests > 0
                  ? { ne: `सम्पर्क अनुरोध (${num(pendingRequests)})`, en: `Contact requests (${pendingRequests})` }
                  : { ne: 'सम्पर्क अनुरोध', en: 'Contact requests' },
              },
            ]}
          />

          {loading ? (
            <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
          ) : tab === 'roles' ? (
            <RoleGrants event={event} />
          ) : tab === 'contacts' ? (
            <ContactRequests eventId={eventId || undefined} refreshMs={QUEUE_POLL_MS} />
          ) : tab === 'speakers' ? (
            <>
              {speakers.length === 0 ? (
                <Card className="text-center py-10">
                  <p className="text-[#6E7C8E] max-w-md mx-auto">
                    {t({
                      ne: 'कुनै सत्रमा वक्ता तोकिएको छैन। सत्रहरू पानाबाट नाम राख्नुहोस्।',
                      en: 'No session names a speaker yet. Add them from the Sessions page.',
                    })}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))' }}>
                  {speakers.map((speaker) => (
                    <SpeakerCard
                      key={speaker.key}
                      speaker={speaker}
                      busy={settingVisibility === speaker.key}
                      onSetVisibility={(v) => setVisibility(speaker, v)}
                    />
                  ))}
                </div>
              )}

              {unnamed.length > 0 && (
                <div className="mt-4 bg-amber/[.12] border border-amber/40 rounded-[10px] px-4 py-3">
                  <p className="text-[13px] text-ink-2">
                    {t({
                      ne: `${num(unnamed.length)} सत्रमा वक्ताको नाम छैन।`,
                      en: `${unnamed.length} session${unnamed.length === 1 ? ' has' : 's have'} no speaker named.`,
                    })}
                  </p>
                  <p className="text-[12.5px] text-[#6E7C8E] mt-1">
                    {unnamed.slice(0, 6).map(({ session }) => session.title).join(' · ')}
                    {unnamed.length > 6 && ' …'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3.5">
              {(event?.meetings.length ?? 0) === 0 && (
                <Panel><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No meetings.' })}</Empty></Panel>
              )}

              {event?.meetings.map((meeting) => {
                const rows = participants[meeting.id] ?? [];
                const seats = turnout[meeting.id] ?? null;
                const isHost = meeting.id && rows.some(
                  (p) => p.role === 'host' && p.user?.id === currentUserId
                );

                return (
                  <Panel
                    key={meeting.id}
                    title={meeting.title}
                    aside={
                      <span className="text-[12.5px] text-[#6E7C8E]">
                        {t({
                          ne: `${num(rows.length)} जना`,
                          en: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`,
                        })}
                        {seats && seats.sessions.length > 0 && (
                          <>
                            {' · '}
                            {t({
                              ne: `${num(seats.session_attendance_total)} सत्र-उपस्थिति`,
                              en: `${seats.session_attendance_total} across ${seats.sessions.length} session${seats.sessions.length === 1 ? '' : 's'}`,
                            })}
                          </>
                        )}
                      </span>
                    }
                  >
                    {seats && seats.sessions.length > 0 && (
                      <div className="px-3.5 py-2.5 border-b border-navy-800/[.08] flex gap-x-4 gap-y-1 flex-wrap">
                        {seats.sessions.map((session) => (
                          <span key={session.id} className="text-[12.5px] text-[#6E7C8E]">
                            {session.title}
                            {' · '}
                            <span className="text-navy-900 font-medium tabular-nums">
                              {num(session.attended_count)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {rows.length === 0 ? (
                      <Empty>
                        {t({
                          ne: 'यो बैठकमा अझै कोही भित्रिएको छैन।',
                          en: 'Nobody has joined this meeting yet.',
                        })}
                      </Empty>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse min-w-[560px]">
                          <thead>
                            <tr className="bg-[#FBFAF6]">
                              {[
                                { ne: 'नाम', en: 'Name' },
                                { ne: 'भूमिका', en: 'Role' },
                                { ne: 'अवस्था', en: 'Status' },
                                { ne: 'भूमिका बदल्ने', en: 'Change role' },
                              ].map((h, i) => (
                                <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2.5 border-b border-navy-800/15">
                                  {t(h)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((p) => (
                              <tr key={p.id} className="hover:bg-[#FBFAF6]">
                                <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                                  <div className="flex items-center gap-2.5">
                                    <span className="w-8 h-8 rounded-full bg-navy-700 text-white grid place-items-center text-xs font-semibold flex-none">
                                      {nameOf(p.user).charAt(0).toUpperCase()}
                                    </span>
                                    <span className="text-[13.5px] font-medium truncate">{nameOf(p.user)}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                                  <Chip tone={p.role === 'host' ? 'ok' : p.role === 'attendee' ? 'draft' : 'default'}>
                                    {t(ROLE_LABEL[p.role as Role])}
                                  </Chip>
                                </td>
                                <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                                  {p.is_active
                                    ? <Chip tone="live">{t({ ne: 'हलमा', en: 'In the room' })}</Chip>
                                    : <Chip tone="draft">{t({ ne: 'बाहिर', en: 'Away' })}</Chip>}
                                </td>
                                <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                                  <select
                                    value={p.role}
                                    disabled={!isHost || changing === p.id || p.user?.id === currentUserId}
                                    onChange={(e) => changeRole(meeting, p, e.target.value as Role)}
                                    title={
                                      !isHost
                                        ? t({ ne: 'यो बैठकका आयोजकले मात्र बदल्न सक्छन्', en: "Only this meeting's host can change roles" })
                                        : p.user?.id === currentUserId
                                        ? t({ ne: 'आफ्नो भूमिका आफैँ बदल्न मिल्दैन', en: 'You cannot change your own role' })
                                        : undefined
                                    }
                                    className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white disabled:opacity-50"
                                  >
                                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                                      <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                );
              })}

              <p className="text-[12.5px] text-[#6E7C8E]">
                {t({
                  ne: 'भूमिका बैठकपिच्छे हुन्छ — कोही एउटा बैठकमा प्रस्तोता र अर्कोमा सहभागी हुन सक्छन्।',
                  en: 'Roles belong to a meeting: somebody can present at one and simply attend another.',
                })}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
};


/**
 * One speaker, with what the organizer knows about them.
 *
 * The card carries this speaker's own details - name, how to reach them,
 * the sessions they hold - drawn from their own sessions rather than from
 * anything shared with the card next to it.
 *
 * The visibility control is a single choice with two values, not two
 * switches, so "both at once" is not a state the interface can reach.
 */
const SpeakerCard: React.FC<{
  speaker: Speaker;
  busy: boolean;
  onSetVisibility: (visibility: 'public' | 'private') => void;
}> = ({ speaker, busy, onSetVisibility }) => {
  const { t, num } = useOrganizer();
  const { name, email, phone, slots, visibility } = speaker;

  const CHOICES: { id: 'public' | 'private'; label: Pair }[] = [
    { id: 'public', label: { ne: 'सार्वजनिक', en: 'Public' } },
    { id: 'private', label: { ne: 'निजी', en: 'Private' } },
  ];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex gap-3 items-center">
        <span className="w-12 h-12 rounded-full bg-navy-700 text-white grid place-items-center text-[17px] font-bold flex-none">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold truncate">{name}</h3>
          <p className="text-[12.5px] text-[#6E7C8E]">
            {t({
              ne: `${num(slots.length)} सत्र`,
              en: `${slots.length} session${slots.length === 1 ? '' : 's'}`,
            })}
          </p>
        </div>
      </div>

      {(email || phone) && (
        <div className="text-[12.5px] text-ink-2 leading-relaxed">
          {email && <div className="truncate" title={email}>{email}</div>}
          {phone && <div className="tabular-nums">{phone}</div>}
        </div>
      )}

      <div>
        <p className="text-[11.5px] text-[#6E7C8E] mb-1.5">
          {t({ ne: 'सम्पर्क कसले देख्ने', en: 'Contact visibility' })}
        </p>
        <div className="inline-flex rounded-lg border border-navy-800/15 overflow-hidden">
          {CHOICES.map((choice) => {
            const on = visibility === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => onSetVisibility(choice.id)}
                className={`px-3 py-1.5 text-[12.5px] transition disabled:opacity-60 ${
                  on
                    ? 'bg-navy-700 text-white font-medium'
                    : 'bg-white text-ink-2 hover:bg-cream'
                }`}
              >
                {t(choice.label)}
              </button>
            );
          })}
        </div>

        <p className="text-[11.5px] text-[#6E7C8E] mt-1.5">
          {visibility === 'public'
            ? t({
                ne: 'सत्र सकिएपछि सहभागीहरूले सम्पर्क देख्न सक्छन्।',
                en: 'Attendees can see the contact once the session is over.',
              })
            : visibility === 'private'
            ? t({
                ne: 'सहभागीले अनुरोध गर्नुपर्छ, र तपाईंले अनुमति दिनुपर्छ।',
                en: 'Attendees must ask, and you decide.',
              })
            : t({
                ne: 'यिनका सत्रहरूमा फरक-फरक छ — कुनै एउटा छान्नुहोस्।',
                en: 'Their sessions disagree — pick one to settle them.',
              })}
        </p>
      </div>

      {slots.map(({ session, meeting }) => (
        <div key={session.id} className="bg-cream rounded-lg px-3 py-2 text-[12.5px] text-ink-2">
          <span className="tabular-nums">{clock(session.starts_at)}</span>
          {' · '}
          {session.title}
          {session.hall && <span className="text-[#6E7C8E]"> · {session.hall}</span>}
          <span className="block text-[11.5px] text-[#6E7C8E] mt-0.5">
            {meeting.title}
            <span className="ms-1.5">
              <Chip tone={SESSION_STATE_TONE[sessionState(session)]}>
                {t(SESSION_STATE_LABEL[sessionState(session)])}
              </Chip>
            </span>
            {visibility === 'mixed' && (
              <span className="ms-1.5">
                <Chip tone={session.speaker_visibility === 'public' ? 'ok' : 'draft'}>
                  {session.speaker_visibility === 'public'
                    ? t({ ne: 'सार्वजनिक', en: 'Public' })
                    : t({ ne: 'निजी', en: 'Private' })}
                </Chip>
              </span>
            )}
          </span>
        </div>
      ))}
    </Card>
  );
};
