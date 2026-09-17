import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { LIST_POLL_MS } from '../../services/polling';
import { EventProgramme } from '../../types';
import { ImportProgramme } from '../ImportProgramme';
import { useOrganizer } from '../i18n';
import { EventHeadcount, EventsDashboard } from '../events/EventsDashboard';
import { EventDetail } from '../events/EventDetail';
import { EventWizard } from '../events/EventWizard';

interface Props {
  onOpenRoom: (meetingCode: string) => void;
  onChanged: () => void;
}

/**
 * The programme, in the three screens the design gives it.
 *
 * The list is where a host lands; opening a card goes into one event, and
 * the pencil on it goes into the three-step form that builds one. Only
 * one of the three is on screen at a time, and all three read the same
 * loaded programme.
 */
export const EventsView: React.FC<Props> = ({ onOpenRoom, onChanged }) => {
  const { t } = useOrganizer();

  const [events, setEvents] = useState<EventProgramme[]>([]);
  const [counts, setCounts] = useState<Record<string, EventHeadcount>>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  /** Which screen is up: the list, one event, or the form. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.listEvents();
      setEvents(data);
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load the programme' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Whoever is watching this page did not necessarily make the change: a
  // session put on stage from another screen has to show up here too.
  useEffect(() => {
    const id = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /**
   * The two numbers a card shows that the list itself does not carry.
   *
   * They are fetched per event and quietly left at nothing when they
   * cannot be read, because a card that says how many sessions it has is
   * still worth showing when the co-host count is unavailable.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await Promise.all(
        events.map(async (event) => {
          try {
            const [grants, invites] = await Promise.all([
              apiClient.getProgrammeRoles(event.id),
              apiClient.getEventInvites(event.id),
            ]);
            return [event.id, {
              coHosts: grants.granted.filter((r) => r.role === 'co_host').length,
              attendees: invites.total_invited,
            }] as const;
          } catch {
            return [event.id, { coHosts: 0, attendees: 0 }] as const;
          }
        })
      );
      if (alive) setCounts(Object.fromEntries(rows));
    })();
    return () => { alive = false; };
  }, [events]);

  const refresh = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  const open = openId ? events.find((e) => e.id === openId) : undefined;

  if (editing) {
    const subject = editing.id ? events.find((e) => e.id === editing.id) : undefined;
    return (
      <EventWizard
        event={subject}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
    );
  }

  if (open) {
    return (
      <EventDetail
        event={open}
        onBack={() => setOpenId(null)}
        onEdit={() => setEditing({ id: open.id })}
        onOpenRoom={onOpenRoom}
        onChanged={refresh}
      />
    );
  }

  return (
    <>
      {importing && (
        <div className="mb-5">
          <ImportProgramme
            onImported={async () => { setImporting(false); await refresh(); }}
          />
        </div>
      )}

      <EventsDashboard
        events={events}
        counts={counts}
        loading={loading}
        onOpen={(event) => setOpenId(event.id)}
        onEdit={(event) => setEditing({ id: event.id })}
        onCreate={() => setEditing({ id: null })}
        onImport={() => setImporting((v) => !v)}
      />
    </>
  );
};
