import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { EventMeeting, EventProgramme } from '../types';
import { OrganizerProvider, useOrganizer } from '../organizer/i18n';
import { Card, Tabs } from '../organizer/ui';
import { AttendeeShell } from '../attendee/AttendeeShell';
import { Spine, SpineItem } from '../attendee/Spine';
import { SessionDrawer } from '../attendee/SessionDrawer';
import { DashboardView } from '../attendee/views/DashboardView';
import { SessionsView } from '../attendee/views/SessionsView';
import { SpeakersView } from '../attendee/views/SpeakersView';
import { HubView } from '../attendee/views/HubView';

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** A readable name from whatever the account actually carries. */
const nameOf = (user: { first_name?: string; last_name?: string; email?: string } | null) => {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email || '';
};

const AttendeeInner: React.FC = () => {
  const { t, num } = useOrganizer();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [view, setView] = useState('dash');
  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState('');
  const [attended, setAttended] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<SpineItem | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [day, setDay] = useState('');
  const [canOrganize, setCanOrganize] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiClient.listEvents();
      setEvents(list);
      // Somebody who runs a programme gets the organizer panel offered.
      setCanOrganize(list.length > 0);
      setEventId((prev) => prev || list[0]?.id || '');
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the programme' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // The organizer decides what is on stage, so the attendee's view has to
  // follow it rather than wait for a reload.
  useEffect(() => {
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const event = events.find((e) => e.id === eventId) ?? events[0] ?? null;

  const items = useMemo<SpineItem[]>(() => {
    if (!event) return [];
    const out: SpineItem[] = [];
    event.meetings.forEach((meeting) =>
      meeting.sessions.forEach((session) => out.push({ session, meeting }))
    );
    return out.sort((a, b) => +new Date(a.session.starts_at) - +new Date(b.session.starts_at));
  }, [event]);

  const live = items.find((i) => i.session.status === 'live') ?? null;

  // Which sessions this person was recorded at. Read per finished session,
  // because attendance is only settled once a session closes.
  useEffect(() => {
    const finished = items.filter((i) => i.session.status === 'done');
    if (finished.length === 0 || !user) { setAttended(new Set()); return; }

    let cancelled = false;
    Promise.allSettled(
      finished.map((i) =>
        apiClient.getSessionAttendance(i.session.id).then((rows) => [i.session.id, rows] as const)
      )
    ).then((results) => {
      if (cancelled) return;
      const mine = new Set<string>();
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        const [sessionId, rows] = r.value;
        const me = rows.some(
          (row) => !row.is_guest && (row.name === user.email || row.name === nameOf(user))
        );
        if (me) mine.add(sessionId);
      });
      setAttended(mine);
    });
    return () => { cancelled = true; };
  }, [items, user]);

  // The live session's clock, anchored to when the server started it.
  useEffect(() => {
    if (!live?.session.started_at) { setElapsed(0); return; }
    const origin = new Date(live.session.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live?.session.started_at]);

  const days = useMemo(() => {
    const seen: string[] = [];
    items.forEach((i) => {
      const k = dayKey(i.session.starts_at);
      if (!seen.includes(k)) seen.push(k);
    });
    return seen;
  }, [items]);

  const activeDay = days.includes(day) ? day : days[0] ?? '';

  const enterRoom = (meeting: EventMeeting) => navigate(`/meeting/${meeting.meeting_code}`);

  return (
    <>
      <AttendeeShell
        view={view}
        onNavigate={setView}
        counts={{
          agenda: items.length ? num(items.length) : undefined,
          sessions: items.filter((i) => i.session.status === 'done').length
            ? num(items.filter((i) => i.session.status === 'done').length)
            : undefined,
        } as Record<string, string>}
        who={{
          name: nameOf(user) || t({ ne: 'सहभागी', en: 'Attendee' }),
          detail: user?.email ?? '',
        }}
        eventTitle={event?.title}
        eventDetail={
          event
            ? [
                new Date(event.event_date).toLocaleDateString(undefined, {
                  weekday: 'long', day: 'numeric', month: 'long',
                }),
                event.venue,
              ].filter(Boolean).join(' · ')
            : undefined
        }
        onSwitchToOrganizer={canOrganize ? () => navigate('/organizer') : undefined}
        onLeave={logout}
      >
        {loading ? (
          <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
        ) : events.length === 0 ? (
          <Card className="text-center py-12">
            <h2 className="text-[19px] font-semibold">
              {t({ ne: 'तपाईं कुनै कार्यक्रममा हुनुहुन्न', en: 'You are not on a programme yet' })}
            </h2>
            <p className="text-[#6E7C8E] mt-2 max-w-md mx-auto">
              {t({
                ne: 'आयोजकले निम्तो पठाएपछि वा बैठकको कोड हालेपछि कार्यक्रम यहाँ देखिन्छ।',
                en: 'Once an organizer invites you, or you join with a meeting code, the day appears here.',
              })}
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-4 px-4 py-2 rounded-[10px] bg-amber text-[#20160A] font-semibold text-sm"
            >
              {t({ ne: 'कोडबाट जोडिनुहोस्', en: 'Join with a code' })}
            </button>
          </Card>
        ) : (
          <>
            {events.length > 1 && (
              <select
                value={event?.id ?? ''}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full max-w-md border border-navy-800/15 rounded-[10px] px-3 py-2 bg-white text-sm mb-5"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {new Date(e.event_date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            )}

            {view === 'dash' && (
              <DashboardView
                event={event}
                items={items}
                live={live}
                attendedIds={attended}
                onOpen={setOpen}
                onNavigate={setView}
                onJoinRoom={enterRoom}
                elapsed={elapsed}
              />
            )}

            {view === 'agenda' && (
              <>
                <div className="mb-4">
                  <h1 className="text-[26px] font-semibold">{t({ ne: 'एजेन्डा', en: 'Agenda' })}</h1>
                  <p className="text-sm text-[#6E7C8E] mt-1">
                    {t({
                      ne: 'आयोजकले समय सार्दा यो सूची आफैँ मिल्छ।',
                      en: 'When the organizer moves a time, this list follows.',
                    })}
                  </p>
                </div>
                {days.length > 1 && (
                  <Tabs
                    active={activeDay}
                    onChange={setDay}
                    tabs={days.map((d, i) => ({
                      id: d,
                      label: {
                        ne: `दिन ${num(i + 1)}`,
                        en: `Day ${i + 1} · ${new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
                      },
                    }))}
                  />
                )}
                <Spine
                  items={items.filter((i) => dayKey(i.session.starts_at) === activeDay)}
                  onOpen={setOpen}
                />
              </>
            )}

            {view === 'sessions' && (
              <SessionsView items={items} attendedIds={attended} onOpen={setOpen} />
            )}

            {view === 'hub' && (
              <HubView
                meetings={event?.meetings ?? []}
                myName={nameOf(user)}
              />
            )}

            {view === 'connect' && <SpeakersView items={items} onOpen={setOpen} />}
          </>
        )}
      </AttendeeShell>

      {open && <SessionDrawer item={open} onClose={() => setOpen(null)} />}
    </>
  );
};

export const AttendeePage: React.FC = () => (
  <OrganizerProvider>
    <AttendeeInner />
  </OrganizerProvider>
);
