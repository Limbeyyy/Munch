import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { LIST_POLL_MS, QUEUE_POLL_MS } from '../services/polling';
import {
  EVENT_STATE_LABEL, EVENT_STATE_TONE, eventState,
} from '../organizer/sessionState';
import { useAuthStore } from '../store/authStore';
import { Event } from '../types';
import { OrganizerProvider, useOrganizer } from '../organizer/i18n';
import { Modal, OrganizerShell } from '../organizer/OrganizerShell';
import { Btn, Chip } from '../organizer/ui';
import { SetupView } from '../organizer/views/SetupView';
import { EventsView } from '../organizer/views/EventsView';
import { LiveView } from '../organizer/views/LiveView';
import { AgendaView } from '../organizer/views/AgendaView';
import { ContentView } from '../organizer/views/ContentView';
import { AttendanceView } from '../organizer/views/AttendanceView';
import { PeopleView } from '../organizer/views/PeopleView';
import { ModerationView } from '../organizer/views/ModerationView';
import { ReportsView } from '../organizer/views/ReportsView';
import { SettingsView } from '../organizer/views/SettingsView';
import { ProfileView } from '../organizer/ProfileView';
import { SubscriptionView } from '../organizer/SubscriptionView';
import { RemindersView } from '../organizer/RemindersView';
import { useNudges } from '../organizer/nudges';
import { useEventPulse } from '../organizer/eventPulse';
import { unseenSince, useSeen } from '../organizer/seen';
import { ShareEventDialog } from '../components/ShareEventDialog';

const OrganizerInner: React.FC = () => {
  const { t, num, a11y, setA11y } = useOrganizer();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  /**
   * The desk, on every arrival.
   *
   * A refresh mid-morning used to land on the programme, which is where
   * a day is built rather than run - so the host had to navigate back to
   * the thing they were in the middle of. The desk is what somebody
   * opening this while an event is on wants first, and it says plainly
   * when there is nothing to run.
   */
  const [view, setView] = useState('live');
  const [events, setEventRooms] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  /** Everything still awaiting a decision, with when each arrived. */
  const [queue, setQueue] = useState<{ id: string; created_at: string }[]>([]);

  const [a11yOpen, setA11yOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawer, setDrawer] = useState<Event | null>(null);
  const [sharing, setSharing] = useState<Event | null>(null);

  // One poll for both the rail's badge and the reminders page itself.
  const nudges = useNudges();

  const load = useCallback(async () => {
    try {
      setEventRooms(await apiClient.listEventRooms());
    } catch {
      toast.error(t({ ne: 'सत्रहरू ल्याउन सकिएन', en: 'Could not load the sessions' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Event state changes when a session goes on stage, which may happen
  // on another screen, so the rail's counts and badges keep up.
  useEffect(() => {
    const id = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The rail carries counts, so the queue is visible from any screen.
  useEffect(() => {
    const running = events.filter((m) => m.status === 'active' || m.status === 'scheduled');
    if (running.length === 0) { setQueue([]); return; }

    let cancelled = false;
    const count = async () => {
      const results = await Promise.allSettled(
        running.map((m) => apiClient.getPendingMessages(m.id))
      );
      if (cancelled) return;
      setQueue(
        results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])) as any
      );
    };
    count();
    const id = setInterval(count, QUEUE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [events]);

  // A badge says something has arrived that has not been looked at. Being
  // in the section is looking at it, so the count goes while the queue
  // itself stays exactly as it was.
  const seen = useSeen(view);

  useEffect(() => {
    // Reminders carry their own read mark, on the account rather than in
    // this browser, so opening the page puts the badge down everywhere.
    if (view === 'reminders' && nudges.unread > 0) nudges.markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, nudges.unread]);

  const badges = useMemo(() => {
    const out: Record<string, { text: string; hot?: boolean }> = {};
    if (events.some((m) => m.status === 'active')) {
      out.live = { text: t({ ne: 'लाइभ', en: 'Live' }), hot: true };
    }
    const news = unseenSince(queue, seen.moderation ?? 0, (m) => m.created_at);
    if (news > 0) out.moderation = { text: num(news), hot: true };
    if (events.length > 0) out.agenda = { text: num(events.length) };
    if (nudges.unread > 0) out.reminders = { text: num(nudges.unread) };
    return out;
  }, [events, queue, nudges.unread, seen, t, num]);

  const running = events.find((m) => m.status === 'active') ?? null;
  const activeTitle = running?.title;

  // A event ending should reach every screen at once rather than on the
  // next poll, so the dashboard listens to the room while one is running.
  useEventPulse(running?.code, load);

  return (
    <>
      <OrganizerShell
        view={view}
        onNavigate={setView}
        badges={badges}
        eventName={activeTitle}
        onOpenA11y={() => setA11yOpen(true)}
      >
        {loading ? (
          <p className="text-[#6E7C8E]">{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</p>
        ) : (
          <>
            {view === 'setup' && (
              <SetupView events={events} onNavigate={setView} onCreate={() => setCreateOpen(true)} />
            )}
            {view === 'live' && (
              <LiveView events={events} onChanged={load} onNavigate={setView} />
            )}
            {view === 'events' && (
              <EventsView
                onOpenRoom={(code) => navigate(`/event/${code}`)}
                onChanged={load}
              />
            )}
            {view === 'agenda' && <AgendaView onChanged={load} />}
            {view === 'content' && <ContentView events={events} />}
            {view === 'attendance' && <AttendanceView events={events} />}
            {view === 'people' && <PeopleView events={events} currentUserId={user?.id} />}
            {view === 'moderation' && <ModerationView events={events} />}
            {view === 'reports' && <ReportsView events={events} />}
            {view === 'settings' && <SettingsView />}
            {view === 'reminders' && <RemindersView page={nudges.page} loading={nudges.loading} onRead={nudges.markRead} />}
            {view === 'profile' && <ProfileView onNavigate={setView} />}
            {view === 'subscription' && <SubscriptionView />}
          </>
        )}
      </OrganizerShell>

      {/* Accessibility */}
      <Modal
        open={a11yOpen}
        onClose={() => setA11yOpen(false)}
        title={t({ ne: 'पहुँच', en: 'Accessibility' })}
        lede={t({ ne: 'डिजाइन उही रहन्छ — पढ्न सजिलो मात्र हुन्छ।', en: 'Same design, just easier to read.' })}
        footer={<Btn tone="solid" onClick={() => setA11yOpen(false)}>{t({ ne: 'भयो', en: 'Done' })}</Btn>}
      >
        <div className="flex flex-col gap-3">
          {([
            ['big', { ne: 'ठूलो अक्षर', en: 'Larger text' }],
            ['contrast', { ne: 'गाढा किनारा', en: 'Stronger borders' }],
            ['calm', { ne: 'चलायमान कम', en: 'Reduce motion' }],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 text-[13.5px] cursor-pointer">
              <input
                type="checkbox"
                checked={a11y[key]}
                onChange={() => setA11y((v) => ({ ...v, [key]: !v[key] }))}
                className="w-4 h-4 accent-[#1B7F58]"
              />
              {t(label)}
            </label>
          ))}
        </div>
      </Modal>

      {createOpen && (
        <CreateSessionModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await load(); }}
        />
      )}

      {/* Session drawer */}
      {drawer && (
        <SessionDrawer
          event={drawer}
          onClose={() => setDrawer(null)}
          onShare={() => setSharing(drawer)}
          onEnter={() => navigate(`/event/${drawer.code}`)}
        />
      )}

      {sharing && (
        <ShareEventDialog
          eventId={sharing.id}
          eventCode={sharing.code}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
};

/** Right-hand drawer with one session's details. */
const SessionDrawer: React.FC<{
  event: Event;
  onClose: () => void;
  onShare: () => void;
  onEnter: () => void;
}> = ({ event, onClose, onShare, onEnter }) => {
  const { t, num } = useOrganizer();
  const minutes = Math.round(
    (+new Date(event.scheduled_end) - +new Date(event.scheduled_start)) / 60000
  );

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-navy-900/45" onClick={onClose} />
      <aside
        className="fixed top-0 right-0 h-[100dvh] w-full max-w-[620px] bg-cream z-[61] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-navy-800 text-white px-5 py-4 relative">
          <button
            onClick={onClose}
            aria-label={t({ ne: 'बन्द', en: 'Close' })}
            className="absolute top-3 right-3.5 w-[30px] h-[30px] rounded-full text-2xl leading-none hover:bg-white/15"
          >
            ×
          </button>
          <p className="text-[12.5px] text-[#AFC6E6]">
            {new Date(event.scheduled_start).toLocaleString()} &middot; {num(minutes)}′
          </p>
          <h2 className="text-[18px] font-semibold pr-9">{event.title}</h2>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: { ne: 'कोड', en: 'Code' }, value: event.code },
              { label: { ne: 'आयोजक', en: 'Host' }, value: event.host?.email ?? '—' },
              { label: { ne: 'सहभागी', en: 'Participants' }, value: num(event.participant_count) },
              {
                label: { ne: 'अवस्था', en: 'Status' },
                value: event.status,
              },
            ].map((row) => (
              <div key={row.label.en} className="bg-white border border-navy-800/15 rounded-[10px] p-3">
                <dt className="text-[12.5px] text-[#6E7C8E]">{t(row.label)}</dt>
                <dd className="text-[14px] font-medium mt-0.5">{row.value}</dd>
              </div>
            ))}
          </dl>

          {event.description && (
            <p className="mt-4 font-read text-[14px] leading-[1.8] text-ink-2">{event.description}</p>
          )}

          <div className="mt-4 bg-[#EEF3FA] border border-navy-500/20 rounded-[10px] p-3.5 text-[13px] text-ink-2">
            {t({
              ne: 'सत्रका फाइल, ट्रान्सक्रिप्ट र उपस्थिति सम्बन्धित पानाबाट हेर्न मिल्छ।',
              en: 'Files, transcript and attendance for this session live on their own pages.',
            })}
          </div>
        </div>

        <div className="border-t border-navy-800/15 bg-white px-5 py-3 flex gap-2 items-center">
          <Chip tone={EVENT_STATE_TONE[eventState(event)]}>
            {t(EVENT_STATE_LABEL[eventState(event)])}
          </Chip>
          <span className="ml-auto flex gap-2">
            <Btn sm onClick={onShare}>{t({ ne: 'लिङ्क बाँड्नुहोस्', en: 'Share link' })}</Btn>
            <Btn sm tone="solid" onClick={onEnter}>{t({ ne: 'कोठामा जानुहोस्', en: 'Enter room' })}</Btn>
          </span>
        </div>
      </aside>
    </>
  );
};

/** Create a session without leaving the organizer. */
const CreateSessionModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({
  onClose, onCreated,
}) => {
  const { t } = useOrganizer();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [end, setEnd] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim()) {
      toast.error(t({ ne: 'सत्रको नाम लेख्नुहोस्', en: 'Give the session a name' }));
      return;
    }
    if (new Date(start) >= new Date(end)) {
      toast.error(t({ ne: 'अन्त्य सुरुभन्दा पछि हुनुपर्छ', en: 'The end must come after the start' }));
      return;
    }
    try {
      setBusy(true);
      const from = new Date(start);
      await apiClient.createEvent({
        title: title.trim(),
        event_date: new Date(from.getTime() - from.getTimezoneOffset() * 60000)
          .toISOString().slice(0, 10),
        scheduled_start: from.toISOString(),
        duration_minutes: Math.max(
          5, Math.round((+new Date(end) - +from) / 60000)
        ),
      });
      toast.success(t({ ne: 'सत्र बन्यो', en: 'Session created' }));
      onCreated();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'बनाउन सकिएन', en: 'Could not create it' }));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t({ ne: 'नयाँ सत्र', en: 'New session' })}
      footer={
        <>
          <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
          <Btn tone="amber" onClick={create} disabled={busy}>
            {busy ? t({ ne: 'बन्दै…', en: 'Creating…' }) : t({ ne: 'बनाउनुहोस्', en: 'Create' })}
          </Btn>
        </>
      }
    >
      <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
        {t({ ne: 'सत्रको नाम', en: 'Session name' })}
      </label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full border border-navy-800/15 rounded-[9px] px-3 py-2 mb-3"
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">{t({ ne: 'सुरु', en: 'Start' })}</label>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full border border-navy-800/15 rounded-[9px] px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">{t({ ne: 'अन्त्य', en: 'End' })}</label>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full border border-navy-800/15 rounded-[9px] px-3 py-2"
          />
        </div>
      </div>
    </Modal>
  );
};

export const OrganizerPage: React.FC = () => (
  <OrganizerProvider>
    <OrganizerInner />
  </OrganizerProvider>
);
