import { MeetingDraft } from '../types';
import { GAP_MINUTES } from './schedule';
import { spaceOut, tooCloseTogether } from './MeetingDraftFields';

/**
 * Put a running order right before it is saved, with the organizer's say-so.
 *
 * The gap is mandatory and the server will apply it either way, so the
 * useful thing to do is show what the times will become and let the
 * organizer agree to them. Returns the drafts to save, or null if they
 * would rather go back and edit.
 */
export const confirmSpacing = (
  drafts: MeetingDraft[],
  ask: (message: string) => boolean,
  gapMinutes: number = GAP_MINUTES
): MeetingDraft[] | null => {
  const tight = drafts.flatMap((draft) => tooCloseTogether(draft, gapMinutes));
  if (tight.length === 0) return drafts;

  const ok = ask(
    `${tight.join(', ')} leaves less than ${gapMinutes} minutes after the session before it.\n\n` +
      'Move it to the next free time and save?'
  );
  return ok ? drafts.map((draft) => spaceOut(draft, gapMinutes)) : null;
};
