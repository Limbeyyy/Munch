import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, Session, Speaker as SpeakerProfile } from '../../types';
import { useOrganizer } from '../i18n';
import { groupBySpeaker } from '../speakers';
import { Card, Head } from '../ui';
import { SpeakerFace } from '../events/SpeakersStep';


interface Slot { session: Session; event: Event; }

/** One person, and every session of theirs in this programme. */
interface Speaker {
  key: string;
  name: string;
  email: string;
  phone: string;
  /** Their photograph, where the profile written for them has one. */
  photo: string | null;
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
  const [loading, setLoading] = useState(true);
  /** The profiles written for the chosen event, and what is typed. */
  const [profiles, setProfiles] = useState<SpeakerProfile[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!eventId) { setProfiles([]); return; }
    let alive = true;
    apiClient.getSpeakers(eventId)
      .then((rows) => { if (alive) setProfiles(rows); })
      .catch(() => { if (alive) setProfiles([]); });
    return () => { alive = false; };
  }, [eventId]);

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
        // From whichever of their talks carries it: a profile is put on
        // the talks a speaker gives, and one of them naming it is enough.
        photo: rows
          .map((r) => r.session.speaker_photo_url)
          .find(Boolean) ?? null,
        slots: rows,
        // Held public on one session and private on another is neither:
        // the card says so rather than picking one at random.
        visibility: states.length === 1 ? states[0] : 'mixed',
      };
    });
  }, [event]);

  /**
   * Everybody speaking at this event, however they were written down.
   *
   * A profile is the first-class thing now, so it is what a card is made
   * from. But a name typed straight onto a talk is still a speaker -
   * every event written before profiles existed has them - so those are
   * kept alongside, minus anyone a profile already covers.
   */
  const shown = useMemo(() => {
    const byName = new Map(
      speakers.map((one) => [one.name.trim().toLowerCase(), one])
    );
    const fromProfiles = profiles.map((one) => ({
      key: `profile-${one.id}`,
      name: one.full_name,
      position: one.position,
      organization: one.organization,
      photo: one.photo_url,
      agendas: one.sessions.map((s) => s.title),
      // The profile has no visibility of its own: who may read a
      // speaker's details is a property of the talk they give, which is
      // where the rule has always lived.
      onSessions: byName.get(one.full_name.trim().toLowerCase()) ?? null,
    }));
    const covered = new Set(
      profiles.map((one) => one.full_name.trim().toLowerCase())
    );
    const fromSessions = speakers
      .filter((one) => !covered.has(one.name.trim().toLowerCase()))
      .map((one) => ({
        key: one.key,
        name: one.name,
        position: '',
        organization: '',
        photo: one.photo,
        agendas: one.slots.map((slot) => slot.session.title),
        onSessions: one,
      }));

    const wanted = search.trim().toLowerCase();
    return [...fromProfiles, ...fromSessions].filter((one) =>
      one.name.toLowerCase().includes(wanted)
    );
  }, [profiles, speakers, search]);

  const unnamed = useMemo(() => {
    if (!event) return [];
    return [event].flatMap((event) =>
      (event.sessions ?? [])
        .filter((s) => !s.speaker_name?.trim())
        .map((session) => ({ session, event }))
    );
  }, [event]);


  return (
    <>
      <Head
        title={{ ne: 'वक्ताहरू', en: 'Speakers' }}
        lede={{
          ne: 'वक्ताको परिचय थप्नुहोस् र एक वा बढी सत्रमा राख्नुहोस्।',
          en: 'Add speaker profiles and assign them to one or more sessions.',
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
          {/* What is being looked for, and which event's speakers to
              look in. Side by side, as 686-27690 draws them. */}
          <div className="mb-4 flex gap-4 items-center flex-wrap">
            <div className="bg-white border border-line rounded-[8px] h-10 px-2.5
              flex gap-1 items-center w-full max-w-[348px]">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="5.5" stroke="#7f7d83" strokeWidth="1.3" />
                <path d="M12.5 12.5 L16 16" stroke="#7f7d83" strokeWidth="1.3"
                  strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t({ ne: 'वक्ता खोज्नुहोस्', en: 'Search Speakers' })}
                aria-label={t({ ne: 'वक्ता खोज्नुहोस्', en: 'Search Speakers' })}
                className="flex-1 min-w-0 bg-transparent text-[14px] text-head
                  placeholder:text-[#7f7d83] outline-none"
              />
            </div>
            {events.length > 1 && (
              <div className="flex gap-1.5 items-center">
                <label
                  htmlFor="manch-speakers-event"
                  className="text-[16px] text-black"
                >
                  {t({ ne: 'कार्यक्रम', en: 'Events' })}
                </label>
                <select
                  id="manch-speakers-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="bg-white border-[0.6px] border-line rounded-[8px]
                    h-10 px-3 w-[280px] text-[14px] text-black"
                >
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>{e.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
          ) : (
            <>
              {shown.length === 0 ? (
                <Card className="text-center py-10">
                  <p className="text-[#6E7C8E] max-w-md mx-auto">
                    {t({
                      ne: 'कुनै वक्ता छैन। कार्यक्रमको तेस्रो चरणबाट थप्नुहोस्।',
                      en: 'No speakers yet. Add them on the Speakers step of the event.',
                    })}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-5"
                  style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
                  {shown.map((one) => (
                    <article
                      key={one.key}
                      className="bg-white border-[0.6px] border-line rounded-[12px] p-4
                        flex flex-col
                        shadow-[0px_4px_3px_rgba(0,0,0,0.04),0px_2px_2px_rgba(0,0,0,0.03)]"
                    >
                      <SpeakerFace
                        name={one.name}
                        src={one.photo}
                        className="rounded-[8px] w-full aspect-square text-[36px]"
                      />
                      <p className="pt-3 text-[14px] font-medium text-head text-center">
                        {one.name}
                      </p>
                      {one.position && (
                        <p className="text-[12px] text-[#c2410c] text-center">
                          {one.position}
                        </p>
                      )}
                      {one.organization && (
                        <p className="text-[12px] text-subtle text-center">
                          {one.organization}
                        </p>
                      )}
                      <p className="mt-3 bg-[#f3f4f6] rounded-[6px] px-2 py-1
                        text-[11px] text-subtle text-center truncate">
                        {one.agendas.length === 0
                          ? t({ ne: 'कुनै कार्यसूची छैन', en: 'No agenda assigned' })
                          : one.agendas.join(', ')}
                      </p>

                    </article>
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


