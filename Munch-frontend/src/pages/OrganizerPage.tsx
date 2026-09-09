import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { LIST_POLL_MS, QUEUE_POLL_MS } from '../services/polling';
import {
  MEETING_STATE_LABEL, MEETING_STATE_TONE, meetingState,
} from '../organizer/sessionState';
import { useAuthStore } from '../store/authStore';
import { Meeting } from '../types';
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
import { useMeetingPulse } from '../organizer/meetingPulse';
import { ShareMeetingDialog } from '../components/ShareMeetingDialog';

const OrganizerInner: React.FC = () => {
  const { t, num, a11y, setA11y } = useOrganizer();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [view, setView] = useState('events');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const [a11yOpen, setA11yOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawer, setDrawer] = useState<Meeting | null>(null);
  const [sharing, setSharing] = useState<Meeting | null>(null);

  // One poll for both the rail's badge and the reminders page itself.
  const nudges = useNudges();

  const load = useCallback(async () => {
    try {
      setMeetings(await apiClient.listMeetings());
    } catch {
      toast.error(t({ ne: 'सत्रहरू ल्याउन सकिएन', en: 'Could not load the sessions' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Meeting state changes when a session goes on stage, which may happen
  // on another screen, so the rail's counts and badges keep up.
  useEffect(() => {
    const id = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The rail carries counts, so the queue is visible from any screen.
  useEffect(() => {
    const running = meetings.filter((m) => m.status === 'active' || m.status === 'scheduled');
    if (running.length === 0) { setPendingCount(0); return; }

    let cancelled = false;
    const count = async () => {
      const results = await Promise.allSettled(
        running.map((m) => apiClient.getPendingMessages(m.id))
      );
      if (cancelled) return;
      setPendingCount(
        results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.length : 0), 0)
      );
    };
    count();
    const id = setInterval(count, QUEUE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [meetings]);

  const badges = useMemo(() => {
    const out: Record<string, { text: string; hot?: boolean }> = {};
    if (meetings.some((m) => m.status === 'active')) {
      out.live = { text: t({ ne: 'लाइभ', en: 'Live' }), hot: true };
    }
    if (pendingCount > 0) out.moderation = { text: num(pendingCount), hot: true };
    if (meetings.length > 0) out.agenda = { text: num(meetings.length) };
    if (nudges.unread > 0) out.reminders = { text: num(nudges.unread) };
    return out;
  }, [meetings, pendingCount, nudges.unread, t, num]);

  const running = meetings.find((m) => m.status === 'active') ?? null;
  const activeTitle = running?.title;

  // A meeting ending should reach every screen at once rather than on the
  // next poll, so the dashboard listens to the room while one is running.
  useMeetingPulse(running?.meeting_code, load);

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
              <SetupView meetings={meetings} onNavigate={setView} onCreate={() => setCreateOpen(true)} />
            )}
            {view === 'live' && (
              <LiveView meetings={meetings} onChanged={load} onNavigate={setView} />
            )}
            {view === 'events' && (
              <EventsView
                onOpenRoom={(code) => navigate(`/meeting/${code}`)}
                onChanged={load}
              />
            )}
            {view === 'agenda' && <AgendaView onChanged={load} />}
            {view === 'content' && <ContentView meetings={meetings} />}
            {view === 'attendance' && <AttendanceView meetings={meetings} />}
            {view === 'people' && <PeopleView meetings={meetings} currentUserId={user?.id} />}
            {view === 'moderation' && <ModerationView meetings={meetings} />}
            {view === 'reports' && <ReportsView meetings={meetings} />}
            {view === 'settings' && <SettingsView meetings={meetings} />}
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
          meeting={drawer}
          onClose={() => setDrawer(null)}
          onShare={() => setSharing(drawer)}
          onEnter={() => navigate(`/meeting/${drawer.meeting_code}`)}
        />
      )}

      {sharing && (
        <ShareMeetingDialog
          meetingId={sharing.id}
          meetingCode={sharing.meeting_code}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
};

/** Right-hand drawer with one session's details. */
const SessionDrawer: React.FC<{
  meeting: Meeting;
  onClose: () => void;
  onShare: () => void;
  onEnter: () => void;
}> = ({ meeting, onClose, onShare, onEnter }) => {
  const { t, num } = useOrganizer();
  const minutes = Math.round(
    (+new Date(meeting.scheduled_end) - +new Date(meeting.scheduled_start)) / 60000
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
            {new Date(meeting.scheduled_start).toLocaleString()} &middot; {num(minutes)}′
          </p>
          <h2 className="text-[18px] font-semibold pr-9">{meeting.title}</h2>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: { ne: 'कोड', en: 'Code' }, value: meeting.meeting_code },
              { label: { ne: 'आयोजक', en: 'Host' }, value: meeting.host?.email ?? '—' },
              { label: { ne: 'सहभागी', en: 'Participants' }, value: num(meeting.participant_count) },
              {
                label: { ne: 'अवस्था', en: 'Status' },
                value: meeting.status,
              },
            ].map((row) => (
              <div key={row.label.en} className="bg-white border border-navy-800/15 rounded-[10px] p-3">
                <dt className="text-[12.5px] text-[#6E7C8E]">{t(row.label)}</dt>
                <dd className="text-[14px] font-medium mt-0.5">{row.value}</dd>
              </div>
            ))}
          </dl>

          {meeting.description && (
            <p className="mt-4 font-read text-[14px] leading-[1.8] text-ink-2">{meeting.description}</p>
          )}

          <div className="mt-4 bg-[#EEF3FA] border border-navy-500/20 rounded-[10px] p-3.5 text-[13px] text-ink-2">
            {t({
              ne: 'सत्रका फाइल, ट्रान्सक्रिप्ट र उपस्थिति सम्बन्धित पानाबाट हेर्न मिल्छ।',
              en: 'Files, transcript and attendance for this session live on their own pages.',
            })}
          </div>
        </div>

        <div className="border-t border-navy-800/15 bg-white px-5 py-3 flex gap-2 items-center">
          <Chip tone={MEETING_STATE_TONE[meetingState(meeting)]}>
            {t(MEETING_STATE_LABEL[meetingState(meeting)])}
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
      await apiClient.createMeeting({
        title: title.trim(),
        scheduled_start: new Date(start).toISOString(),
        scheduled_end: new Date(end).toISOString(),
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
