import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { Event, RoleGrantRow, Session } from '../../types';
import { ShareEventDialog } from '../../components/ShareEventDialog';
import { errorText } from '../errors';
import { Pair, useOrganizer } from '../i18n';
import { Btn } from '../ui';
import { toLocalInput } from '../EventDraftFields';
import { BackLink, EventHeading, PlusGlyph, Sheet, Stepper } from './chrome';
import { CoHostDialog, Field, inputClass } from './CoHostDialog';
import { AddAgendaDialog } from './AddAgendaDialog';
import { AgendaBoard } from './AgendaBoard';
import { PeopleEmpty, PeopleHeading, PersonRow, initialsOf } from './people';
import { whenLine } from './EventsDashboard';

const STEPS: Pair[] = [
  { ne: 'कार्यक्रमको विवरण', en: 'Event Details' },
  { ne: 'सत्रहरू', en: 'Sessions' },
  { ne: 'मानिस', en: 'Peoples' },
];

interface Props {
  /** Absent when building a new one; present when changing one that exists. */
  event?: Event;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/**
 * Making an event, in the three passes the design lays out.
 *
 * The first pass is the only one that has to happen: what the event is
 * called, when it is, and where. The running order and the people can be
 * skipped and added later, which is why every step after the first offers
 * a way past it.
 */
export const EventWizard: React.FC<Props> = ({ event, onClose, onSaved }) => {
  const { t, num } = useOrganizer();
  const { user } = useAuthStore();
  /** Nine tomorrow morning, which is what most events want offered. */
  const defaultStart = (() => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return toLocalInput(at);
  })();
  const plusAnHour = (from: string) =>
    toLocalInput(new Date(+new Date(from) + 60 * 60000));

  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<Event | null>(event ?? null);

  const [title, setTitle] = useState(event?.title ?? '');
  const [venue, setVenue] = useState(event?.venue ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [startsAt, setStartsAt] = useState(
    event?.scheduled_start ? toLocalInput(new Date(event.scheduled_start)) : defaultStart
  );
  const [endsAt, setEndsAt] = useState(
    event?.scheduled_end
      ? toLocalInput(new Date(event.scheduled_end))
      : plusAnHour(defaultStart)
  );
  const [busy, setBusy] = useState(false);

  const [drafting, setDrafting] = useState(false);
  /** The talk being changed, if one is. */
  const [editing, setEditing] = useState<Session | null>(null);

  const [roles, setRoles] = useState<RoleGrantRow[]>([]);
  const [invited, setInvited] = useState<{ email: string; joined: boolean }[]>([]);
  const [addCoHost, setAddCoHost] = useState(false);
  const [sharing, setSharing] = useState<{ id: string; code: string } | null>(null);

  const loadPeople = useCallback(async (eventId: string) => {
    try {
      const [grants, invites] = await Promise.all([
        apiClient.getProgrammeRoles(eventId),
        apiClient.getEventInvites(eventId),
      ]);
      setRoles(grants.granted);
      setInvited(invites.invited.map((r) => ({ email: r.email, joined: r.joined })));
    } catch {
      // Lists are context, not the point of the step.
    }
  }, []);

  useEffect(() => {
    if (step === 2 && saved) loadPeople(saved.id);
  }, [step, saved, loadPeople]);

  /** Step one: the event itself. Nothing else can exist before it does. */
  const saveDetails = async () => {
    if (!title.trim()) {
      toast.error(t({ ne: 'कार्यक्रमको नाम लेख्नुहोस्', en: 'Give the event a name' }));
      return;
    }
    if (!startsAt) {
      toast.error(t({ ne: 'सुरु हुने समय दिनुहोस्', en: 'Say when it starts' }));
      return;
    }
    if (endsAt && +new Date(endsAt) <= +new Date(startsAt)) {
      toast.error(t({
        ne: 'अन्त्य सुरुभन्दा पछि हुनुपर्छ',
        en: 'The end has to come after the start',
      }));
      return;
    }

    const from = new Date(startsAt);
    // The day is the day it starts on; there is no separate date to
    // disagree with the hours any more.
    const day = toLocalInput(from).slice(0, 10);
    const minutes = endsAt
      ? Math.max(5, Math.round((+new Date(endsAt) - +from) / 60000))
      : 60;

    try {
      setBusy(true);
      if (saved) {
        const next = await apiClient.updateEvent(saved.id, {
          title: title.trim(),
          venue: venue.trim(),
          description,
          event_date: day,
          scheduled_start: from.toISOString(),
          scheduled_end: new Date(+from + minutes * 60000).toISOString(),
        });
        setSaved(next);
      } else {
        const next = await apiClient.createEvent({
          title: title.trim(),
          venue: venue.trim(),
          description,
          event_date: day,
          scheduled_start: from.toISOString(),
          duration_minutes: minutes,
          sessions: [],
        });
        setSaved(next);
        toast.success(t({ ne: `${next.title} बन्यो`, en: `${next.title} created` }));
      }
      await onSaved();
      setStep(1);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बचत गर्न सकिएन', en: 'Could not save it' })));
    } finally {
      setBusy(false);
    }
  };

  /** Step two: one event's worth of running order at a time. */
  const sessionCount = saved?.sessions?.length ?? 0;

  /**
   * Where the running order has reached, offered as the next start.
   *
   * The dialog asks for a time rather than working one out, so it is
   * handed the end of the last talk: a morning is usually typed in order,
   * and re-reading the clock for every row is the tedious part.
   */
  const nextFreeTime = (() => {
    const order = [...(saved?.sessions ?? [])].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)
    );
    const last = order[order.length - 1];
    const from = last
      ? new Date(+new Date(last.starts_at) + last.duration_minutes * 60000)
      : saved?.scheduled_start
      ? new Date(saved.scheduled_start)
      : null;
    if (!from) return undefined;
    return `${String(from.getHours()).padStart(2, '0')}:${String(from.getMinutes()).padStart(2, '0')}`;
  })();
  const coHosts = roles.filter((r) => r.role === 'co_host');
  // The event is the room, so it is its own invitation target.
  const opener = saved;

  const hostName = [user?.first_name, user?.last_name]
    .filter(Boolean).join(' ').trim();

  const dropCoHost = async (grant: RoleGrantRow) => {
    if (!saved) return;
    try {
      await apiClient.revokeRole(saved.id, grant.id);
      toast.success(t({ ne: 'हटाइयो', en: 'Removed' }));
      await loadPeople(saved.id);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not remove them' })));
    }
  };

  const withdraw = async (email: string) => {
    if (!saved) return;
    try {
      await apiClient.withdrawEventInvite(saved.id, email);
      toast.success(t({ ne: 'निम्तो फिर्ता', en: 'Invitation withdrawn' }));
      await loadPeople(saved.id);
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'हटाउन सकिएन', en: 'Could not take them off' })));
    }
  };

  const skip = step < 2 && saved
    ? (
      <button
        onClick={() => (step === 2 ? onClose() : setStep(step + 1))}
        className="text-[14px] text-tagink underline hover:no-underline"
      >
        {t({ ne: 'छोड्नुहोस्', en: 'Skip' })}
      </button>
    )
    : null;

  return (
    <Sheet>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <BackLink label={{ ne: 'कार्यक्रम', en: 'Event' }} onClick={onClose} />
          {skip && <span className="ml-auto">{skip}</span>}
        </div>

        <EventHeading
          title={title || t({ ne: 'नयाँ कार्यक्रम', en: 'New event' })}
          under={saved ? [whenLine(saved), saved.venue].filter(Boolean).join(' · ')
                       : t({ ne: 'तीन चरणमा तयार गर्नुहोस्', en: 'Set it up in three steps' })}
        />

        <Stepper steps={STEPS} at={step} onGo={(i) => saved && setStep(i)} />
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-5 max-w-[720px]">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[20px] font-medium text-head">
                {t({ ne: 'कार्यक्रमको विवरण', en: 'Event Details' })}
              </h2>
              <p className="text-[14px] text-body mt-1">
                {t({
                  ne: 'यो कार्यक्रम के हो, कहिले र कहाँ हुन्छ।',
                  en: 'What this event is, and when and where it happens.',
                })}
              </p>
            </div>
          </div>

          <Field label={t({ ne: 'कार्यक्रमको नाम', en: 'Event name' })} required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t({ ne: 'आपतकालीन सेवा बैठक', en: 'Emergency Service Event' })}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t({ ne: 'सुरु', en: 'Starts' })} required>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {
                  setStartsAt(e.target.value);
                  // Keep the end ahead of the start rather than letting
                  // the two cross over while somebody is typing.
                  if (e.target.value && +new Date(endsAt) <= +new Date(e.target.value)) {
                    setEndsAt(plusAnHour(e.target.value));
                  }
                }}
                className={inputClass}
              />
            </Field>
            <Field label={t({ ne: 'अन्त्य', en: 'Ends' })}>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="-mt-2 text-[12.5px] text-subtle">
            {t({
              ne: 'अन्त्यको समय औपचारिक हो — कार्यक्रम आयोजकले नसकाएसम्म चलिरहन्छ।',
              en: 'The end is a formality: the event runs until the host ends it.',
            })}
          </p>

          <Field label={t({ ne: 'स्थान', en: 'Venue' })}>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={t({ ne: 'काठमाडौँ सम्मेलन केन्द्र', en: 'Kathmandu Convention Center' })}
              className={inputClass}
            />
          </Field>

          <Field label={t({ ne: 'विवरण', en: 'Description' })} hint={t({ ne: 'वैकल्पिक', en: 'optional' })}>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="flex gap-3 justify-end pt-1">
            <Btn onClick={onClose}>{t({ ne: 'रद्द', en: 'Cancel' })}</Btn>
            <Btn tone="solid" onClick={saveDetails} disabled={busy}>
              {busy
                ? t({ ne: 'बचत गर्दै…', en: 'Saving…' })
                : t({ ne: 'अर्को: सत्रहरू', en: 'Next: Sessions' })}
            </Btn>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[20px] font-medium text-head">
                {t({ ne: 'सत्रहरू', en: 'Sessions' })}
              </h2>
              <p className="text-[14px] text-body mt-1">
                {t({
                  ne: 'यो कार्यक्रमका सत्र र वक्ता मिलाउनुहोस्।',
                  en: 'Organize the sessions and speakers for this event.',
                })}
              </p>
            </div>
            {!drafting && (
              <Btn
                tone="solid"
                className="px-5 py-3 text-[16px]"
                onClick={() => setDrafting(true)}
              >
                <PlusGlyph />
                {t({ ne: 'नयाँ सत्र बनाउनुहोस्', en: 'Create New Sessions' })}
              </Btn>
            )}
          </div>

          {/* What is already in the running order, and arranging it. */}
          {saved && sessionCount > 0 && (
            <section className="bg-wash rounded-[12px] p-5">
              <h2 className="text-[12px] font-medium tracking-[.06em] uppercase
                text-subtle mb-4">
                {t({
                  ne: `एजेन्डा · ${num(sessionCount)} सत्र`,
                  en: `Agenda · ${sessionCount} sessions`,
                })}
              </h2>
              <AgendaBoard
                event={saved}
                onChanged={async () => {
                  const fresh = await apiClient.getEvent(saved.id);
                  setSaved(fresh);
                  await onSaved();
                }}
                onAdd={() => setDrafting(true)}
                onEdit={(id) => {
                  const one = (saved.sessions ?? []).find((s) => s.id === id);
                  if (one) setEditing(one);
                }}
              />
            </section>
          )}

          <div className="flex gap-3 justify-end">
            <Btn onClick={() => setStep(0)}>{t({ ne: 'पछाडि', en: 'Back' })}</Btn>
            <Btn tone="solid" onClick={() => setStep(2)}>
              {t({ ne: 'अर्को: मानिस', en: 'Next: Peoples' })}
            </Btn>
          </div>

          {(drafting || editing) && saved && (
            <AddAgendaDialog
              eventId={saved.id}
              day={saved.event_date ?? toLocalInput(new Date(saved.scheduled_start)).slice(0, 10)}
              session={editing ?? undefined}
              suggestedStart={nextFreeTime}
              onClose={() => { setDrafting(false); setEditing(null); }}
              onAdded={async () => {
                setDrafting(false);
                setEditing(null);
                const fresh = await apiClient.getEvent(saved.id);
                setSaved(fresh);
                await onSaved();
              }}
            />
          )}
        </div>
      )}

      {step === 2 && saved && (
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-[20px] font-medium text-head">
              {t({ ne: 'मानिस', en: 'Peoples' })}
            </h2>
            <p className="text-[14px] text-body mt-1.5">
              {t({
                ne: 'यो कार्यक्रमका सहभागी, वक्ता र सह-आयोजक व्यवस्थापन गर्नुहोस्।',
                en: 'Manage attendees, speakers and co-hosts for the event',
              })}
            </p>
          </div>

          {/* One list, read top to bottom: who owns the event, who runs it
              beside them, and who is coming. The two side-by-side cards
              this replaces asked the eye to start twice. */}
          <div className="flex flex-col">
            <PeopleHeading label={{ ne: 'आयोजक', en: 'Host' }} />
            <PersonRow
              initials={initialsOf(hostName, saved.host_email)}
              dark
              name={hostName || (saved.host_email ?? '')}
              suffix={t({ ne: '(तपाईं)', en: '(you)' })}
              email={saved.host_email ?? ''}
              tag={t({ ne: 'आयोजक', en: 'Host' })}
            />

            <PeopleHeading
              label={{
                ne: `सह-आयोजक · ${num(coHosts.length)}`,
                en: `Co-hosts · ${coHosts.length}`,
              }}
              action={{
                label: { ne: '+ सह-आयोजक थप्नुहोस्', en: '+ Add co-host' },
                onClick: () => setAddCoHost(true),
              }}
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
                  onRemove={() => dropCoHost(one)}
                />
              ))
            )}

            <PeopleHeading
              label={{ ne: 'सहभागी', en: 'Attendees' }}
              action={
                opener
                  ? {
                      label: { ne: '+ सहभागीलाई निम्तो', en: '+ Invite attendees' },
                      onClick: () => setSharing(opener),
                    }
                  : undefined
              }
            />
            {invited.length === 0 ? (
              <PeopleEmpty>
                {t({
                  ne: 'अझै कसैलाई निम्तो छैन।',
                  en: 'No attendees invited yet.',
                })}
              </PeopleEmpty>
            ) : (
              invited.map((row) => (
                <PersonRow
                  key={row.email}
                  initials={initialsOf('', row.email)}
                  name={row.email.split('@')[0]}
                  email={row.email}
                  tag={row.joined ? t({ ne: 'आइसके', en: 'Joined' }) : undefined}
                  onRemove={() => withdraw(row.email)}
                />
              ))
            )}
          </div>

          <div className="flex gap-3 justify-end">
            <Btn onClick={() => setStep(1)}>{t({ ne: 'पछाडि', en: 'Back' })}</Btn>
            <Btn tone="solid" onClick={onClose}>{t({ ne: 'सकियो', en: 'Done' })}</Btn>
          </div>
        </div>
      )}

      {addCoHost && saved && (
        <CoHostDialog
          eventId={saved.id}
          onClose={() => setAddCoHost(false)}
          onAdded={async () => { setAddCoHost(false); await loadPeople(saved.id); }}
        />
      )}

      {sharing && (
        <ShareEventDialog
          eventId={sharing.id}
          eventCode={sharing.code}
          onClose={() => setSharing(null)}
          onInvited={() => { if (saved) loadPeople(saved.id); }}
        />
      )}
    </Sheet>
  );
};
