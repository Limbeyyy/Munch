import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EventProgramme, MeetingDraft, Session } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Card, Chip, Empty, Head, Panel } from '../ui';
import { Modal } from '../OrganizerShell';
import {
  MeetingDraftFields,
  emptyMeeting,
  toApiMeeting,
  toLocalInput,
} from '../MeetingDraftFields';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  onOpenRoom: (meetingCode: string) => void;
  onChanged: () => void;
}

/**
 * The programme: events, the meetings inside them, and each meeting's
 * running order. This is where the day is built and where it is driven
 * from once it is under way.
 */
export const EventsView: React.FC<Props> = ({ onOpenRoom, onChanged }) => {
  const { t, num } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [newEvent, setNewEvent] = useState(false);
  const [addMeetingTo, setAddMeetingTo] = useState<EventProgramme | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.listEvents();
      setEvents(data);
      // Open the first event, so the page is never a wall of closed rows.
      setExpanded((prev) =>
        Object.keys(prev).length || !data[0] ? prev : { [data[0].id]: true }
      );
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the programme' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const runSession = async (session: Session, action: 'start' | 'end') => {
    try {
      setBusy(session.id);
      if (action === 'start') {
        await apiClient.startSession(session.id);
        toast.success(t({ ne: `${session.title} मञ्चमा`, en: `${session.title} is on stage` }));
      } else {
        const done = await apiClient.endSession(session.id);
        toast.success(
          t({
            ne: `सत्र सकियो — ${num(done.attendance_recorded)} जनाको उपस्थिति दर्ता`,
            en: `Session ended — attendance recorded for ${done.attendance_recorded}`,
          })
        );
      }
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'गर्न सकिएन', en: 'That did not work' }));
    } finally { setBusy(null); }
  };

  const removeEvent = async (event: EventProgramme) => {
    const ok = window.confirm(
      t({
        ne: `"${event.title}" हटाउने?\n\nयसभित्रका ${num(event.meeting_count)} बैठक र ${num(event.session_count)} सत्र पनि हट्नेछन्।`,
        en: `Delete "${event.title}"?\n\nIts ${event.meeting_count} meeting(s) and ${event.session_count} session(s) go with it.`,
      })
    );
    if (!ok) return;
    try {
      await apiClient.deleteEvent(event.id);
      toast.success(t({ ne: 'कार्यक्रम हटाइयो', en: 'Event deleted' }));
      await load();
      onChanged();
    } catch {
      toast.error(t({ ne: 'हटाउन सकिएन', en: 'Could not delete it' }));
    }
  };

  const sessionChip = (s: Session) =>
    s.status === 'live' ? <Chip tone="live">{t({ ne: 'मञ्चमा', en: 'On stage' })}</Chip>
    : s.status === 'done' ? <Chip tone="ok">{t({ ne: 'सकियो', en: 'Done' })}</Chip>
    : <Chip tone="draft">{t({ ne: 'आउँदै', en: 'Upcoming' })}</Chip>;

  return (
    <>
      <Head
        title={{ ne: 'कार्यक्रम', en: 'Programme' }}
        lede={{
          ne: 'एउटा कार्यक्रमभित्र धेरै बैठक, र हरेक बैठकभित्र त्यसको सत्रहरू।',
          en: 'An event holds meetings, and each meeting holds the sessions that make it up.',
        }}
        actions={<Btn tone="amber" onClick={() => setNewEvent(true)}>
          {t({ ne: '+ नयाँ कार्यक्रम', en: '+ New event' })}
        </Btn>}
      />

      {loading ? (
        <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
      ) : events.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[#6E7C8E] max-w-md mx-auto">
            {t({
              ne: 'अझै कुनै कार्यक्रम छैन। दिनको कार्यक्रम बनाउनुहोस् — बिहान र बेलुकाका बैठक, र तीभित्रका सत्र।',
              en: "No programme yet. Build the day — morning and evening meetings, and the sessions inside each.",
            })}
          </p>
          <Btn tone="amber" className="mt-4" onClick={() => setNewEvent(true)}>
            {t({ ne: 'पहिलो कार्यक्रम बनाउनुहोस्', en: 'Create the first event' })}
          </Btn>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {events.map((event) => {
            const open = !!expanded[event.id];
            return (
              <Panel
                key={event.id}
                title={
                  <button
                    onClick={() => setExpanded((v) => ({ ...v, [event.id]: !open }))}
                    className="flex items-center gap-2 text-left"
                  >
                    <span className={`text-[#6E7C8E] transition-transform ${open ? 'rotate-90' : ''}`}>
                      ›
                    </span>
                    <span className="text-[15.5px] font-semibold">{event.title}</span>
                  </button>
                }
                aside={
                  <span className="flex items-center gap-2 text-[12.5px] text-[#6E7C8E]">
                    {new Date(event.event_date).toLocaleDateString(undefined, {
                      weekday: 'long', day: 'numeric', month: 'short',
                    })}
                    {event.venue && <span>· {event.venue}</span>}
                    <Chip>{num(event.meeting_count)} {t({ ne: 'बैठक', en: 'meetings' })}</Chip>
                    <Chip>{num(event.session_count)} {t({ ne: 'सत्र', en: 'sessions' })}</Chip>
                  </span>
                }
                actions={
                  <>
                    <Btn sm onClick={() => setAddMeetingTo(event)}>
                      {t({ ne: '+ बैठक', en: '+ Meeting' })}
                    </Btn>
                    <Btn sm tone="danger" onClick={() => removeEvent(event)}>
                      {t({ ne: 'हटाउने', en: 'Delete' })}
                    </Btn>
                  </>
                }
              >
                {open && (
                  <div className="px-4 py-3 flex flex-col gap-3">
                    {event.meetings.length === 0 ? (
                      <Empty>
                        {t({
                          ne: 'यो कार्यक्रममा अझै बैठक छैन।',
                          en: 'This event has no meetings yet.',
                        })}
                      </Empty>
                    ) : (
                      [...event.meetings]
                        .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))
                        .map((meeting) => (
                          <div key={meeting.id} className="border border-navy-800/15 rounded-xl overflow-hidden">
                            <div className="bg-[#FBFAF6] px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap">
                              <b className="text-[14px]">{meeting.title}</b>
                              <span className="text-[12.5px] text-[#6E7C8E] tabular-nums">
                                {clock(meeting.scheduled_start)}–{clock(meeting.scheduled_end)}
                              </span>
                              <span className="text-[12.5px] font-mono text-navy-700">
                                {meeting.meeting_code}
                              </span>
                              {meeting.status === 'active' && (
                                <Chip tone="live">{t({ ne: 'चलिरहेको', en: 'Live' })}</Chip>
                              )}
                              <span className="ml-auto flex gap-1.5">
                                <Btn sm onClick={() => onOpenRoom(meeting.meeting_code)}>
                                  {t({ ne: 'कोठा', en: 'Room' })}
                                </Btn>
                              </span>
                            </div>

                            <div className="px-3.5 py-2">
                              {meeting.sessions.length === 0 ? (
                                <p className="text-[12.5px] text-[#6E7C8E] py-1.5">
                                  {t({ ne: 'सत्र थपिएको छैन।', en: 'No sessions added.' })}
                                </p>
                              ) : (
                                meeting.sessions.map((s) => (
                                  <div
                                    key={s.id}
                                    className="flex items-center gap-3 py-2 border-b border-navy-800/[.06] last:border-0"
                                  >
                                    <span className="text-[13px] tabular-nums text-[#6E7C8E] w-[46px] flex-none">
                                      {clock(s.starts_at)}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-[13.5px] truncate">{s.title}</span>
                                      <span className="text-[12px] text-[#6E7C8E]">
                                        {num(s.duration_minutes)}′
                                        {s.hall && ` · ${s.hall}`}
                                        {s.speaker_name && ` · ${s.speaker_name}`}
                                        {s.attendance_count > 0 &&
                                          ` · ${num(s.attendance_count)} ${t({ ne: 'उपस्थित', en: 'present' })}`}
                                      </span>
                                    </span>
                                    <span className="ml-auto flex items-center gap-1.5 flex-none">
                                      {sessionChip(s)}
                                      {s.status === 'live' ? (
                                        <Btn sm tone="danger" disabled={busy === s.id}
                                             onClick={() => runSession(s, 'end')}>
                                          {t({ ne: 'सकाउने', en: 'End' })}
                                        </Btn>
                                      ) : s.status === 'scheduled' ? (
                                        <Btn sm tone="solid" disabled={busy === s.id}
                                             onClick={() => runSession(s, 'start')}>
                                          {t({ ne: 'मञ्चमा', en: 'On stage' })}
                                        </Btn>
                                      ) : null}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {newEvent && (
        <NewEventModal
          onClose={() => setNewEvent(false)}
          onCreated={async () => { setNewEvent(false); await load(); onChanged(); }}
        />
      )}

      {addMeetingTo && (
        <AddMeetingModal
          event={addMeetingTo}
          onClose={() => setAddMeetingTo(null)}
          onAdded={async () => { setAddMeetingTo(null); await load(); onChanged(); }}
        />
      )}
    </>
  );
};

/** Build a whole day: the event, its meetings, and their sessions. */
const NewEventModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({
  onClose, onCreated,
}) => {
  const { t } = useOrganizer();
  const today = toLocalInput(new Date()).slice(0, 10);

  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState(today);
  const [meetings, setMeetings] = useState<MeetingDraft[]>([emptyMeeting(today, 9)]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      toast.error(t({ ne: 'कार्यक्रमको नाम लेख्नुहोस्', en: 'Give the event a name' }));
      return;
    }
    const named = meetings.filter((m) => m.title.trim());
    if (named.length !== meetings.length) {
      toast.error(t({ ne: 'हरेक बैठकको नाम चाहिन्छ', en: 'Every meeting needs a name' }));
      return;
    }
    try {
      setBusy(true);
      const created = await apiClient.createEvent({
        title: title.trim(),
        venue: venue.trim(),
        event_date: date,
        meetings: named.map(toApiMeeting),
      });
      toast.success(
        t({
          ne: `${created.title} बन्यो — ${created.meeting_count} बैठक, ${created.session_count} सत्र`,
          en: `${created.title} created — ${created.meeting_count} meetings, ${created.session_count} sessions`,
        })
      );
      onCreated();
    } catch (e: any) {
      const detail = e.response?.data;
      toast.error(
        typeof detail === 'object' && detail
          ? Object.values(detail).flat().join(' ')
          : t({ ne: 'बनाउन सकिएन', en: 'Could not create it' })
      );
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t({ ne: 'नयाँ कार्यक्रम', en: 'New event' })}
      lede={t({
        ne: 'दिन, त्यसभित्रका बैठक, र हरेक बैठकभित्रका सत्र — एकैचोटि।',
        en: 'The day, the meetings inside it, and each meeting’s sessions — all at once.',
      })}
      footer={
        <>
          <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn tone="amber" onClick={save} disabled={busy}>
            {busy ? t({ ne: 'बन्दै…', en: 'Creating…' }) : t({ ne: 'कार्यक्रम बनाउनुहोस्', en: 'Create event' })}
          </Btn>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px]">
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'कार्यक्रमको नाम', en: 'Event name' })}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t({ ne: 'आइतबारको कार्यक्रम', en: 'Sunday programme' })}
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
          />
        </div>
        <div>
          <label className="block text-[12px] text-[#6E7C8E] mb-1">
            {t({ ne: 'मिति', en: 'Date' })}
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[13.5px]"
          />
        </div>
      </div>

      <div className="mt-2.5">
        <label className="block text-[12px] text-[#6E7C8E] mb-1">
          {t({ ne: 'स्थान', en: 'Venue' })}
        </label>
        <input
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          className="w-full border border-navy-800/15 rounded-lg px-2.5 py-2 text-[14px]"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {meetings.map((meeting, i) => (
          <MeetingDraftFields
            key={i}
            index={i}
            meeting={meeting}
            onChange={(next) => setMeetings((v) => v.map((m, j) => (j === i ? next : m)))}
            onRemove={
              meetings.length > 1
                ? () => setMeetings((v) => v.filter((_, j) => j !== i))
                : undefined
            }
          />
        ))}
        <Btn
          onClick={() => setMeetings((v) => [...v, emptyMeeting(date, 14)])}
          className="self-start"
        >
          {t({ ne: '+ अर्को बैठक', en: '+ Another meeting' })}
        </Btn>
      </div>
    </Modal>
  );
};

/** Add one more meeting, with its sessions, to an event already running. */
const AddMeetingModal: React.FC<{
  event: EventProgramme;
  onClose: () => void;
  onAdded: () => void;
}> = ({ event, onClose, onAdded }) => {
  const { t } = useOrganizer();
  const [meeting, setMeeting] = useState<MeetingDraft>(() => emptyMeeting(event.event_date, 14));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!meeting.title.trim()) {
      toast.error(t({ ne: 'बैठकको नाम लेख्नुहोस्', en: 'Give the meeting a name' }));
      return;
    }
    try {
      setBusy(true);
      const created = await apiClient.addMeetingToEvent(event.id, toApiMeeting(meeting));
      toast.success(
        t({
          ne: `${created.title} थपियो (${created.meeting_code})`,
          en: `${created.title} added (${created.meeting_code})`,
        })
      );
      onAdded();
    } catch (e: any) {
      const detail = e.response?.data;
      toast.error(
        typeof detail === 'object' && detail
          ? Object.values(detail).flat().join(' ')
          : t({ ne: 'थप्न सकिएन', en: 'Could not add it' })
      );
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t({ ne: 'बैठक थप्नुहोस्', en: 'Add a meeting' })}
      lede={`${event.title} · ${new Date(event.event_date).toLocaleDateString()}`}
      footer={
        <>
          <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn tone="amber" onClick={save} disabled={busy}>
            {busy ? t({ ne: 'थप्दै…', en: 'Adding…' }) : t({ ne: 'थप्नुहोस्', en: 'Add meeting' })}
          </Btn>
        </>
      }
    >
      <MeetingDraftFields meeting={meeting} onChange={setMeeting} />
    </Modal>
  );
};
