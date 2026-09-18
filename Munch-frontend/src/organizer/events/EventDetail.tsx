import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { Event, RoleGrantRow, Session } from '../../types';
import { ShareEventDialog } from '../../components/ShareEventDialog';
import { errorText } from '../errors';
import { useOrganizer } from '../i18n';
import { Btn, Chip, Ic } from '../ui';
import { EVENT_STATE_LABEL, EVENT_STATE_TONE, eventState } from '../sessionState';
import { BackLink, Block, Caution, DeckTabs, EventHeading, PlusGlyph, ReadyRow, Sheet } from './chrome';
import { CoHostDialog } from './CoHostDialog';
import { PeopleEmpty, PeopleHeading, PersonRow, initialsOf } from './people';
import { AddAgendaDialog } from './AddAgendaDialog';
import { AgendaBoard } from './AgendaBoard';
import { whenLine } from './EventsDashboard';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  event: Event;
  onBack: () => void;
  onEdit: () => void;
  /** Take the host into the room the session is running in. */
  onOpenRoom: (eventCode: string) => void;
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
  const { user } = useAuthStore();
  const [tab, setTab] = useState('overview');
  const [roles, setRoles] = useState<RoleGrantRow[]>([]);
  const [invited, setInvited] = useState<{ email: string; joined: boolean }[]>([]);
  const [addCoHost, setAddCoHost] = useState(false);
  /**
   * The session being written, if one is.
   *
   * `'new'` is a fresh one; a session is one being changed. Editing used
   * to bounce out to the first step of the setup form, which is where an
   * event's name and hours live rather than a talk's.
   */
  const [writing, setWriting] = useState<Session | 'new' | null>(null);
  const [sharing, setSharing] = useState<Event | null>(null);

  const sessions = event.sessions ?? [];
  const withoutSpeaker = sessions.filter((s) => !s.speaker_name).length;
  const coHosts = roles.filter((r) => r.role === 'co_host');

  /**
   * Whether the reader owns this event.
   *
   * A co-host reads the same page; the server refuses them the lists
   * either way, so the buttons that would be refused are simply absent.
   */
  const isHost = !!user?.email
    && user.email.toLowerCase() === (event.host_email ?? '').toLowerCase();
  const hostName = isHost
    ? [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
    : '';

  /** Take somebody off the expected headcount. */
  const withdraw = async (email: string) => {
    try {
      await apiClient.withdrawEventInvite(event.id, email);
      toast.success(t({ ne: 'निम्तो फिर्ता', en: 'Invitation withdrawn' }));
      await loadPeople();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not take them off' })));
    }
  };

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

  /** The event that opens the day, which "Start event" starts. */
  const opener = [event].sort(
    (a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start)
  )[0];

  const startEvent = async () => {
    if (!opener) {
      toast.error(t({
        ne: 'यो कार्यक्रममा बैठक छैन।',
        en: 'This event has no event to start.',
      }));
      return;
    }
    onOpenRoom(opener.code);
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

  /** The end of the last talk, offered as the next one's start. */
  const nextFreeTime = (() => {
    const order = [...sessions].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    );
    const last = order[order.length - 1];
    const from = last
      ? new Date(+new Date(last.starts_at) + last.duration_minutes * 60000)
      : new Date(event.scheduled_start);
    return `${String(from.getHours()).padStart(2, '0')}:${String(from.getMinutes()).padStart(2, '0')}`;
  })();

  const startButton = (
    <Btn tone="solid" className="px-8 py-3 text-[15px]" onClick={startEvent}>
      {t({ ne: 'बैठक सुरु गर्नुहोस्', en: 'Start event' })}
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
                {/* The overview is a summary; a talk is changed where the
                    running order is arranged, so this goes there rather
                    than opening a form over the top of a summary. */}
                <button
                  onClick={() => setTab('agenda')}
                  className="ml-auto text-[13px] text-tagink hover:underline flex-none"
                >
                  {t({ ne: 'सम्पादन', en: 'Edit' })}
                </button>
              </div>
              <p className="text-[14px] font-medium text-head mt-1">{s.title}</p>
              <p className="text-[13px] text-subtle mt-0.5">
                {s.speaker_name
                  ? s.speaker_name
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
              link={{
                label: { ne: '+ सत्र थप्नुहोस्', en: '+ Add session' },
                onClick: () => setWriting('new'),
              }}
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
                {event.host_email} <span className="text-subtle font-normal">
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
              <Btn tone="solid" className="w-full py-3 text-[15px]" onClick={startEvent}>
                {t({ ne: 'बैठक सुरु गर्नुहोस्', en: 'Start event' })}
              </Btn>
            </div>
          </aside>
        </div>
      )}

      {tab === 'agenda' && (
        <div className="flex flex-col gap-5">
          <div className="border border-line rounded-[12px] overflow-hidden">
            <div className="bg-sheet px-5 py-3 flex items-center gap-3 flex-wrap">
              <b className="text-[14px] font-medium text-head">{event.title}</b>
              <span className="text-[13px] text-subtle tabular-nums">
                {clock(event.scheduled_start)}–{clock(event.scheduled_end)}
              </span>
              <span className="text-[12.5px] font-mono text-navy-800">{event.code}</span>
              <Chip tone={EVENT_STATE_TONE[eventState(event)]}>
                {t(EVENT_STATE_LABEL[eventState(event)])}
              </Chip>
              <span className="ml-auto flex-none">
                <Btn sm onClick={() => setSharing(event)}>
                  {t({ ne: 'लिंक र QR', en: 'Link & QR' })}
                </Btn>
              </span>
            </div>

            <div className="px-5 py-3">
              <AgendaBoard
                event={event}
                onChanged={onChanged}
                onAdd={() => setWriting('new')}
                onEdit={(id) => {
                  const one = sessions.find((s) => s.id === id);
                  if (one) setWriting(one);
                }}
              />
            </div>
          </div>

          <Btn className="self-start" onClick={() => setWriting('new')}>
            <PlusGlyph />
            {t({ ne: 'सत्र थप्नुहोस्', en: 'Add sessions' })}
          </Btn>
        </div>
      )}

      {tab === 'people' && (
        <div className="flex flex-col">
          <PeopleHeading label={{ ne: 'आयोजक', en: 'Host' }} />
          <PersonRow
            initials={initialsOf(hostName, event.host_email)}
            dark
            name={hostName || (event.host_email ?? '')}
            suffix={isHost ? t({ ne: '(तपाईं)', en: '(you)' }) : undefined}
            email={event.host_email ?? ''}
            tag={t({ ne: 'आयोजक', en: 'Host' })}
          />

          <PeopleHeading
            label={{
              ne: `सह-आयोजक · ${num(coHosts.length)}`,
              en: `Co-hosts · ${coHosts.length}`,
            }}
            action={
              isHost
                ? {
                    label: { ne: '+ सह-आयोजक थप्नुहोस्', en: '+ Add co-host' },
                    onClick: () => setAddCoHost(true),
                  }
                : undefined
            }
          />
          {coHosts.length === 0 ? (
            <PeopleEmpty>
              {t({
                ne: 'सह-आयोजकले तपाईंसँगै यो कार्यक्रम चलाउन सक्छन्।',
                en: 'A co-host can run this event beside you.',
              })}
            </PeopleEmpty>
          ) : (
            coHosts.map((one) => (
              <PersonRow
                key={one.id}
                initials={initialsOf('', one.email)}
                name={one.email.split('@')[0]}
                email={one.email}
                tag={t({ ne: 'सह-आयोजक', en: 'Co-host' })}
                onRemove={isHost ? () => dropCoHost(one) : undefined}
              />
            ))
          )}

          <PeopleHeading
            label={{ ne: 'सहभागी', en: 'Attendees' }}
            action={
              isHost && opener
                ? {
                    label: { ne: '+ सहभागीलाई निम्तो', en: '+ Invite attendees' },
                    onClick: () => setSharing(opener),
                  }
                : undefined
            }
          />
          {invited.length === 0 ? (
            <PeopleEmpty>
              {t({ ne: 'अझै कसैलाई निम्तो छैन।', en: 'No attendees invited yet.' })}
            </PeopleEmpty>
          ) : (
            invited.map((row) => (
              <PersonRow
                key={row.email}
                initials={initialsOf('', row.email)}
                name={row.email.split('@')[0]}
                email={row.email}
                tag={row.joined ? t({ ne: 'आइसके', en: 'Joined' }) : undefined}
                onRemove={isHost ? () => withdraw(row.email) : undefined}
              />
            ))
          )}
        </div>
      )}

      {writing && (
        <AddAgendaDialog
          eventId={event.id}
          day={(event.event_date ?? event.scheduled_start).slice(0, 10)}
          session={writing === 'new' ? undefined : writing}
          suggestedStart={nextFreeTime}
          onClose={() => setWriting(null)}
          onAdded={async () => { setWriting(null); await onChanged(); }}
        />
      )}

      {addCoHost && (
        <CoHostDialog
          eventId={event.id}
          onClose={() => setAddCoHost(false)}
          onAdded={async () => { setAddCoHost(false); await loadPeople(); }}
        />
      )}

      {sharing && (
        <ShareEventDialog
          eventId={sharing.id}
          eventCode={sharing.code}
          onClose={() => setSharing(null)}
          onInvited={() => { loadPeople(); }}
        />
      )}
    </Sheet>
  );
};
