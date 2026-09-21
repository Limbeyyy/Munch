import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { QUEUE_POLL_MS } from '../../services/polling';
import { Event, Session } from '../../types';
import { Pair, useOrganizer } from '../i18n';
import { ContactRequests } from '../ContactRequests';
import { groupBySpeaker } from '../speakers';
import { Card, Chip, Head, Tabs } from '../ui';
import { SESSION_STATE_LABEL, SESSION_STATE_TONE, sessionState } from '../sessionState';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Slot { session: Session; event: Event; }

/** One person, and every session of theirs in this programme. */
interface Speaker {
  key: string;
  name: string;
  email: string;
  phone: string;
  slots: Slot[];
  visibility: 'public' | 'private' | 'mixed';
}

interface Props { events: any[]; currentUserId?: string; }

/**
 * Who is speaking, and who is running the room.
 *
 * These are two different lists. A speaker is named on a session and often
 * has no account at all; a team member holds a role in a event and may
 * never speak. Treating them as one list was why neither read properly.
 */
export const PeopleView: React.FC<Props> = ({ currentUserId }) => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState('speakers');
  const [settingVisibility, setSettingVisibility] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);
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
    const slots: Slot[] = [event].flatMap((event) =>
      [...(event.sessions ?? [])]
        .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
        .map((session) => ({ session, event }))
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
    return [event].flatMap((event) =>
      (event.sessions ?? [])
        .filter((s) => !s.speaker_name?.trim())
        .map((session) => ({ session, event }))
    );
  }, [event]);

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
                    {e.title} · {new Date(e.event_date ?? e.scheduled_start).toLocaleDateString()}
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
          ) : tab === 'contacts' ? (
            <ContactRequests eventId={eventId || undefined} refreshMs={QUEUE_POLL_MS} />
          ) : (
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

      {slots.map(({ session, event }) => (
        <div key={session.id} className="bg-cream rounded-lg px-3 py-2 text-[12.5px] text-ink-2">
          <span className="tabular-nums">{clock(session.starts_at)}</span>
          {' · '}
          {session.title}
          <span className="block text-[11.5px] text-[#6E7C8E] mt-0.5">
            {event.title}
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
