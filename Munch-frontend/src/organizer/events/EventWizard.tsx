import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, RoleGrantRow } from '../../types';
import { ShareEventDialog } from '../../components/ShareEventDialog';
import { errorText } from '../errors';
import { Pair, useOrganizer } from '../i18n';
import { Btn, Chip } from '../ui';
import { toLocalInput } from '../EventDraftFields';
import { BackLink, Block, EventHeading, PlusGlyph, Sheet, Stepper } from './chrome';
import { CoHostDialog, Field, inputClass } from './CoHostDialog';
import { AddAgendaDialog } from './AddAgendaDialog';
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
  const today = toLocalInput(new Date()).slice(0, 10);

  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<Event | null>(event ?? null);

  const [title, setTitle] = useState(event?.title ?? '');
  const [venue, setVenue] = useState(event?.venue ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [date, setDate] = useState(event?.event_date ?? today);
  const [busy, setBusy] = useState(false);

  const [drafting, setDrafting] = useState(false);

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
    try {
      setBusy(true);
      if (saved) {
        const next = await apiClient.updateEvent(saved.id, {
          title: title.trim(), venue: venue.trim(), description, event_date: date,
        });
        setSaved(next);
      } else {
        const next = await apiClient.createEvent({
          title: title.trim(), venue: venue.trim(), event_date: date, sessions: [],
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
            <Field label={t({ ne: 'मिति', en: 'Date' })} required>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={t({ ne: 'स्थान', en: 'Venue' })}>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder={t({ ne: 'काठमाडौँ सम्मेलन केन्द्र', en: 'Kathmandu Convention Center' })}
                className={inputClass}
              />
            </Field>
          </div>

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

          {/* What is already in the running order. */}
          {sessionCount > 0 && (
            <Block label={{
              ne: `एजेन्डा · ${num(sessionCount)} सत्र`,
              en: `Agenda · ${sessionCount} sessions`,
            }}>
              {[...(saved?.sessions ?? [])]
                .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
                .map((one) => (
                  <div key={one.id} className="py-3 border-b border-line last:border-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[12.5px] text-subtle tabular-nums">
                        {new Date(one.starts_at).toLocaleTimeString([], {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      <b className="text-[14px] font-medium text-head">{one.title}</b>
                      <Chip tone="draft">
                        {num(one.duration_minutes)} {t({ ne: 'मिनेट', en: 'min' })}
                      </Chip>
                    </div>
                    {one.speaker_name && (
                      <p className="text-[13px] text-subtle mt-1.5">
                        {one.speaker_name}
                        {one.speaker_role ? ` · ${one.speaker_role}` : ''}
                      </p>
                    )}
                  </div>
                ))}
            </Block>
          )}

          <div className="flex gap-3 justify-end">
            <Btn onClick={() => setStep(0)}>{t({ ne: 'पछाडि', en: 'Back' })}</Btn>
            <Btn tone="solid" onClick={() => setStep(2)}>
              {t({ ne: 'अर्को: मानिस', en: 'Next: Peoples' })}
            </Btn>
          </div>

          {drafting && saved && (
            <AddAgendaDialog
              eventId={saved.id}
              day={saved.event_date ?? date}
              suggestedStart={nextFreeTime}
              onClose={() => setDrafting(false)}
              onAdded={async () => {
                setDrafting(false);
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
            <p className="text-[14px] text-body mt-1">
              {t({
                ne: 'तपाईंसँगै चलाउने र आउने मानिस थप्नुहोस्।',
                en: 'Add the people who run this with you, and the people coming to it.',
              })}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <Block
              label={{ ne: 'सह-आयोजक', en: 'Co-hosts' }}
              link={{ label: { ne: '+ थप्नुहोस्', en: '+ Add co-host' }, onClick: () => setAddCoHost(true) }}
            >
              {coHosts.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-[14px] text-head">
                    {t({ ne: 'अझै सह-आयोजक छैन।', en: 'No co-hosts yet.' })}
                  </p>
                  <p className="text-[13px] text-subtle mt-1.5">
                    {t({
                      ne: 'सह-आयोजकले तपाईंसँगै यो कार्यक्रम चलाउन सक्छन्।',
                      en: 'A co-host can run this event beside you.',
                    })}
                  </p>
                  <Btn tone="solid" className="mt-4" onClick={() => setAddCoHost(true)}>
                    <PlusGlyph />
                    {t({ ne: 'सह-आयोजक थप्नुहोस्', en: 'Add co-host' })}
                  </Btn>
                </div>
              ) : (
                coHosts.map((r) => (
                  <p key={r.id} className="text-[14px] text-head py-2 border-b border-line last:border-0">
                    {r.email}
                  </p>
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
                    {opener
                      ? t({
                          ne: 'लिंक वा QR बाँड्नुहोस् — बाँडेको हरेक ठेगाना अपेक्षित उपस्थितिमा गनिन्छ।',
                          en: 'Share the link or QR — everyone you share it with is counted as expected to attend.',
                        })
                      : t({
                          ne: 'निम्तो दिन पहिले एउटा बैठक चाहिन्छ।',
                          en: 'There has to be a event before anyone can be invited to one.',
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
