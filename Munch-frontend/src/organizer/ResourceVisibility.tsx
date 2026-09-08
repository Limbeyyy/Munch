import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Artifact, ResourceVisibility as Choice } from '../types';
import { errorText } from './errors';
import { Pair, useOrganizer } from './i18n';

const LABEL: Record<Choice, Pair> = {
  now: { ne: 'अहिले देखिने', en: 'Visible now' },
  after_session: { ne: 'सत्रपछि', en: 'After the session' },
  public: { ne: 'सबैलाई सार्वजनिक', en: 'Public to all' },
  organizers: { ne: 'निजी — आयोजक मात्र', en: 'Private (organizers)' },
};

const ORDER: Choice[] = ['now', 'after_session', 'public', 'organizers'];

/**
 * Who may read one shared file, and where it sits in the order.
 *
 * Four answers rather than a guess from the running order: a slide deck
 * meant to be read along with the talk and one meant to be handed out
 * afterwards are different things, and only the person sharing it knows
 * which. Organizers can change their mind later, which is the point of
 * offering the choice rather than inferring it.
 */
export const ResourceControls: React.FC<{
  meetingId: string;
  resource: Artifact;
  /** Where it sits, and how far it can move. */
  index: number;
  total: number;
  onChanged: () => void;
}> = ({ meetingId, resource, index, total, onChanged }) => {
  const { t } = useOrganizer();
  const [busy, setBusy] = useState(false);

  const change = async (patch: { visibility?: Choice; position?: number }) => {
    try {
      setBusy(true);
      await apiClient.setResourceSettings(meetingId, resource.id, patch);
      onChanged();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'बदल्न सकिएन', en: 'Could not change it' })));
    } finally { setBusy(false); }
  };

  const nudge = (by: number) => (
    <button
      type="button"
      disabled={busy || (by < 0 ? index === 0 : index === total - 1)}
      onClick={() => change({ position: Math.max(0, index + by) })}
      aria-label={by < 0 ? 'Move up' : 'Move down'}
      className="w-7 h-7 grid place-items-center rounded-md border border-navy-800/15 bg-white text-[#6E7C8E] hover:border-navy-500 disabled:opacity-40"
    >
      {by < 0 ? '↑' : '↓'}
    </button>
  );

  return (
    <span className="flex items-center gap-1.5 flex-none">
      <select
        value={resource.visibility ?? 'after_session'}
        disabled={busy}
        onChange={(e) => change({ visibility: e.target.value as Choice })}
        className="border border-navy-800/15 rounded-md px-2 py-1 text-[12.5px] bg-white disabled:opacity-60"
      >
        {ORDER.map((choice) => (
          <option key={choice} value={choice}>{t(LABEL[choice])}</option>
        ))}
      </select>
      {nudge(-1)}
      {nudge(1)}
    </span>
  );
};

export const VISIBILITY_LABEL = LABEL;
