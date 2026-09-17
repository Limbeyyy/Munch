import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EventMeeting, EventProgramme, RoleGrantRow, Session } from '../../types';
import { ShareMeetingDialog } from '../../components/ShareMeetingDialog';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Ic } from '../ui';
import { MEETING_STATE_LABEL, MEETING_STATE_TONE, meetingState } from '../sessionState';
import { BackLink, Block, Caution, DeckTabs, EventHeading, PlusGlyph, ReadyRow, Sheet } from './chrome';
import { CoHostDialog } from './CoHostDialog';
import { whenLine } from './EventsDashboard';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  event: EventProgramme;
  onBack: () => void;
  onEdit: () => void;
  /** Take the host into the room the session is running in. */
  onOpenRoom: (meetingCode: string) => void;
  onChanged: () => Promise<void> | void;
}

/**
 * One event, opened.
 *
 * Overview answers "is this ready to run"; Agenda is the running order
 * itself and where it is driven from; People is who stands where. The
 * three are the same event, so the heading and the way in stay put.
 */
export const EventDetail: React.FC<Props> = ({
  event, onBack, onEdit, onOpenRoom, onChanged,
}) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('overview');
  const [roles, setRoles] = useState<RoleGrantRow[]>([]);
  const [invited, setInvited] = useState<{ email: string; joined: boolean }[]>([]);
  const [addCoHost, setAddCoHost] = useState(false);
  const [sharing, setSharing] = useState<EventMeeting | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const sessions = event.meetings.flatMap((m) => m.sessions);
  const withoutSpeaker = sessions.filter((s) => !s.speaker_name).length;
  const coHosts = roles.filter((r) => r.role === 'co_host');

  const loadPeople = useCallback(async () => {
    try {
      const [grants, invites] = await Promise.all([
        apiClient.getProgrammeRoles(event.id),
        apiClient.getEventInvites(event.id),
      ]);
      setRoles(grants.granted);
      setInvited(invites.invited.map((r) => ({ email: r.email, joined: r.joined })));
    } catch {
      // The lists are context; the screen still shows the event without them.
    }
  }, [event.id]);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  /** The meeting that opens the day, which "Start meeting" starts. */
  const opener = [...event.meetings].sort(
    (a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start)
  )[0];

  const startMeeting = async () => {
    if (!opener) {
      toast.error(t({
        ne: 'यो कार्यक्रममा बैठक छैन।',
        en: 'This event has no meeting to start.',
      }));
      return;
    }
    onOpenRoom(opener.meeting_code);
  };

  const runSession = async (session: Session, action: 'start' | 'end', code: string) => {
    try {
      setBusy(session.id);
      if (action === 'start') {
        await apiClient.startSession(session.id);
        toast.success(t({ ne: `${session.title} मञ्चमा`, en: `${session.title} is on stage` }));
        await onChanged();
        onOpenRoom(code);
        return;
      }
      const done = await apiClient.endSession(session.id);
      toast.success(t({
        ne: `सत्र सकियो — ${num(done.attendance_recorded)} जनाको उपस्थिति दर्ता`,
        en: `Session ended — attendance recorded for ${done.attendance_recorded}`,
      }));
      await onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'गर्न सकिएन', en: 'That did not work' })));
    } finally {
      setBusy(null);
    }
  };

  const dropCoHost = async (grant: RoleGrantRow) => {
    try {
      await apiClient.revokeRole(event.id, grant.id);
      toast.success(t({ ne: 'हटाइयो', en: 'Removed' }));
      await loadPeople();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove them' })));
    }
  };

  const startButton = (
    <Btn tone="solid" className="px-8 py-3 text-[15px]" onClick={startMeeting}>
      {t({ ne: 'बैठक सुरु गर्नुहोस्', en: 'Start meeting' })}
    </Btn>
  );

  const agendaRows = (
    <div className="flex flex-col">
      {sessions.length === 0 ? (
        <p className="text-[13px] text-subtle py-2">
          {t({ ne: 'अझै सत्र छैन।', en: 'No sessions yet.' })}
        </p>
      ) : (
        [...sessions]
          .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
          .map((s) => (
            <div key={s.id} className="py-3 border-b border-line last:border-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[12.5px] text-subtle tabular-nums">
                  {clock(s.starts_at)} – {clock(new Date(+new Date(s.starts_at) + s.duration_minutes * 60000).toISOString())}
                </span>
                <button
                  onClick={onEdit}
                  className="ml-auto text-[13px] text-tagink hover:underline flex-none"
                >
                  {t({ ne: 'सम्पादन', en: 'Edit' })}
                </button>
              </div>
              <p className="text-[14px] font-medium text-head mt-1">{s.title}</p>
              <p className="text-[13px] text-subtle mt-0.5">
                {s.speaker_name
                  ? `${s.speaker_name}${s.hall ? ` · ${s.hall}` : ''}`
                  : <i className="text-faint">{t({ ne: 'वक्ता तोकिएको छैन', en: 'No speaker assigned' })}</i>}
              </p>
            </div>
          ))
      )}
      {withoutSpeaker > 0 && (
        <div className="pt-3">
          <Caution>
            {t({
              ne: `${num(withoutSpeaker)} सत्रमा वक्ता तोकिएको छैन`,
              en: `${withoutSpeaker} session${withoutSpeaker === 1 ? '' : 's'} has no speaker assigned`,
            })}
          </Caution>
        </div>
      )}
    </div>
  );

  return (
    <Sheet>
      <div className="flex flex-col gap-5">
        <BackLink label={{ ne: 'कार्यक्रम', en: 'Event' }} onClick={onBack} />
        <EventHeading
          title={event.title}
          under={[whenLine(event), event.venue].filter(Boolean).join(' · ')}
          action={startButton}
        />
        <DeckTabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: { ne: 'सारांश', en: 'Overview' } },
            { id: 'agenda', label: { ne: 'एजेन्डा', en: 'Agenda' } },
            { id: 'people', label: { ne: 'मानिस', en: 'People' } },
          ]}
        />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <Block
              label={{ ne: 'कार्यक्रमको विवरण', en: 'Event details' }}
              link={{ label: { ne: 'सम्पादन', en: 'Edit' }, onClick: onEdit }}
            >
              <h3 className="text-[17px] font-medium text-head">{event.title}</h3>
              {event.venue && (
                <p className="flex items-center gap-2 text-[14px] text-body mt-3">
                  <span className="text-faint flex-none">
                    <Ic d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" size={15} />
                  </span>
                  {event.venue}
                </p>
              )}
              <p className="flex items-center gap-2 text-[14px] text-body mt-2">
                <span className="text-faint flex-none">
                  <Ic d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" size={15} />
                </span>
                {whenLine(event)}
              </p>
            </Block>

            <Block
              label={{
                ne: `एजेन्डा · ${num(sessions.length)} सत्र`,
                en: `Agenda · ${sessions.length} sessions`,
              }}
              link={{ label: { ne: '+ सत्र थप्नुहोस्', en: '+ Add session' }, onClick: onEdit }}
            >
              {agendaRows}
            </Block>

            <Block
              label={{ ne: 'मानिस', en: 'People' }}
              link={{
                label: { ne: 'मानिस व्यवस्थापन', en: 'Manage people' },
                onClick: () => setTab('people'),
              }}
            >
              <p className="text-[13px] text-subtle">{t({ ne: 'आयोजक', en: 'Host' })}</p>
              <p className="text-[14px] font-medium text-head mt-1">
                {event.organizer_email} <span className="text-subtle font-normal">
                  ({t({ ne: 'तपाईं', en: 'you' })})
                </span>
              </p>

              <p className="text-[13px] text-subtle mt-4">
                {t({ ne: 'सह-आयोजक', en: 'Co-hosts' })} · {num(coHosts.length)}
              </p>
              {coHosts.map((r) => (
                <p key={r.id} className="text-[14px] text-head mt-1">{r.email}</p>
              ))}

              <p className="text-[13px] text-subtle mt-4">
                {t({ ne: 'सहभागी', en: 'Attendees' })} · {num(invited.length)}
              </p>
            </Block>
          </div>

          <aside className="bg-white border border-line rounded-[12px] p-5">
            <h2 className="text-[12px] font-medium tracking-[.06em] uppercase text-subtle mb-4">
              {t({ ne: 'तयारी', en: 'Event readiness' })}
            </h2>
            <ul className="flex flex-col gap-3">
              <ReadyRow done={!!event.title && !!event.venue}>
                {t({ ne: 'कार्यक्रमको विवरण', en: 'Event details' })}
              </ReadyRow>
              <ReadyRow done={sessions.length > 0}>
                {num(sessions.length)} {t({ ne: 'सत्र थपियो', en: 'sessions added' })}
              </ReadyRow>
              <ReadyRow done={coHosts.length > 0}>
                {num(coHosts.length)} {t({ ne: 'सह-आयोजक थपियो', en: 'co-hosts added' })}
              </ReadyRow>
              <ReadyRow done={invited.length > 0}>
                {num(invited.length)} {t({ ne: 'सहभागीलाई निम्तो', en: 'attendees invited' })}
              </ReadyRow>
              <ReadyRow done={withoutSpeaker === 0 && sessions.length > 0}>
                {t({ ne: 'हरेक सत्रमा वक्ता', en: 'Every session has a speaker' })}
              </ReadyRow>
            </ul>
            <div className="mt-5">
              <Btn tone="solid" className="w-full py-3 text-[15px]" onClick={startMeeting}>
                {t({ ne: 'बैठक सुरु गर्नुहोस्', en: 'Start meeting' })}
              </Btn>
            </div>
          </aside>
        </div>
      )}

      {tab === 'agenda' && (
        <div className="flex flex-col gap-5">
          {event.meetings.length === 0 ? (
            <p className="text-[14px] text-subtle">
              {t({ ne: 'यो कार्यक्रममा अझै बैठक छैन।', en: 'This event has no meetings yet.' })}
            </p>
          ) : (
            [...event.meetings]
              .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))
              .map((meeting) => (
                <div key={meeting.id} className="border border-line rounded-[12px] overflow-hidden">
                  <div className="bg-sheet px-5 py-3 flex items-center gap-3 flex-wrap">
                    <b className="text-[14px] font-medium text-head">{meeting.title}</b>
                    <span className="text-[13px] text-subtle tabular-nums">
                      {clock(meeting.scheduled_start)}–{clock(meeting.scheduled_end)}
                    </span>
                    <span className="text-[12.5px] font-mono text-navy-800">
                      {meeting.meeting_code}
                    </span>
                    <Chip tone={MEETING_STATE_TONE[meetingState(meeting)]}>
                      {t(MEETING_STATE_LABEL[meetingState(meeting)])}
                    </Chip>
                    <span className="ml-auto flex-none">
                      <Btn sm onClick={() => setSharing(meeting)}>
                        {t({ ne: 'लिंक र QR', en: 'Link & QR' })}
                      </Btn>
                    </span>
                  </div>

                  <div className="px-5 py-2">
                    {meeting.sessions.length === 0 ? (
                      <p className="text-[13px] text-subtle py-2">
                        {t({ ne: 'सत्र थपिएको छैन।', en: 'No sessions added.' })}
                      </p>
                    ) : (
                      meeting.sessions.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 py-3 border-b border-line last:border-0"
                        >
                          <span className="font-mono text-[12.5px] text-subtle tabular-nums w-[52px] flex-none">
                            {clock(s.starts_at)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] text-head truncate">{s.title}</span>
                            <span className="text-[12.5px] text-faint">
                              {num(s.duration_minutes)}′
                              {s.hall && ` · ${s.hall}`}
                              {s.speaker_name && ` · ${s.speaker_name}`}
                            </span>
                          </span>
                          <span className="flex-none">
                            {s.status === 'live' ? (
                              <Btn sm tone="danger" disabled={busy === s.id}
                                   onClick={() => runSession(s, 'end', meeting.meeting_code)}>
                                {t({ ne: 'सकाउने', en: 'End' })}
                              </Btn>
                            ) : s.status === 'scheduled' || s.status === 'skipped' ? (
                              <Btn sm tone="solid" disabled={busy === s.id}
                                   onClick={() => runSession(s, 'start', meeting.meeting_code)}>
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
          <Btn className="self-start" onClick={onEdit}>
            <PlusGlyph />
            {t({ ne: 'सत्र थप्नुहोस्', en: 'Add sessions' })}
          </Btn>
        </div>
      )}

      {tab === 'people' && (
        <div className="grid gap-5 lg:grid-cols-2 items-start">
          <Block
            label={{ ne: 'सह-आयोजक', en: 'Co-hosts' }}
            link={{ label: { ne: '+ थप्नुहोस्', en: '+ Add co-host' }, onClick: () => setAddCoHost(true) }}
          >
            {coHosts.length === 0 ? (
              <p className="text-[13px] text-subtle">
                {t({ ne: 'अझै सह-आयोजक छैन।', en: 'No co-hosts yet.' })}
              </p>
            ) : (
              coHosts.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-line last:border-0">
                  <span className="w-9 h-9 rounded-full bg-tagbg text-navy-800 grid place-items-center
                    font-semibold text-[14px] flex-none" aria-hidden>
                    {r.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[14px] text-head truncate min-w-0 flex-1">{r.email}</span>
                  <Btn sm tone="danger" onClick={() => dropCoHost(r)}>
                    {t({ ne: 'हटाउने', en: 'Remove' })}
                  </Btn>
                </div>
              ))
            )}
          </Block>

          <Block
            label={{ ne: 'सहभागी', en: 'Attendees' }}
            link={
              opener
                ? { label: { ne: 'निम्तो दिनुहोस्', en: 'Invite attendees' },
                    onClick: () => setSharing(opener) }
                : undefined
            }
          >
            {invited.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[14px] text-head">
                  {t({ ne: 'अझै कसैलाई निम्तो छैन।', en: 'No attendees invited yet.' })}
                </p>
                <p className="text-[13px] text-subtle mt-1.5">
                  {t({
                    ne: 'लिंक वा QR बाँड्नुहोस् — बाँडेको हरेक ठेगाना अपेक्षित उपस्थितिमा गनिन्छ।',
                    en: 'Share the link or QR — everyone you share it with is counted as expected to attend.',
                  })}
                </p>
                {opener && (
                  <Btn tone="solid" className="mt-4" onClick={() => setSharing(opener)}>
                    {t({ ne: 'सहभागीलाई निम्तो', en: 'Invite attendees' })}
                  </Btn>
                )}
              </div>
            ) : (
              invited.map((row) => (
                <div key={row.email} className="flex items-center gap-3 py-2.5 border-b border-line last:border-0">
                  <span className="text-[14px] text-head truncate min-w-0 flex-1">{row.email}</span>
                  {row.joined
                    ? <Chip tone="ok">{t({ ne: 'आइसके', en: 'Joined' })}</Chip>
                    : <Chip tone="draft">{t({ ne: 'पर्खिँदै', en: 'Not yet' })}</Chip>}
                </div>
              ))
            )}
          </Block>
        </div>
      )}

      {addCoHost && (
        <CoHostDialog
          eventId={event.id}
          onClose={() => setAddCoHost(false)}
          onAdded={async () => { setAddCoHost(false); await loadPeople(); }}
        />
      )}

      {sharing && (
        <ShareMeetingDialog
          meetingId={sharing.id}
          meetingCode={sharing.meeting_code}
          onClose={() => setSharing(null)}
          onInvited={() => { loadPeople(); }}
        />
      )}
    </Sheet>
  );
};
