/**
 * Who is speaking, gathered from the running order.
 *
 * One definition, because two were disagreeing: the organizer grouped by
 * email and the attendee app by name, so two people the organizer had
 * given the same contact address showed as one speaker on one screen and
 * two on the other.
 *
 * A speaker is a person, and the name is who the person is. Two slots
 * belong to the same speaker only when the name and the address both
 * match: sharing an address does not make two people one, and sharing a
 * name does not make one person two.
 */

/** Just enough of a session to identify who is giving it. */
export interface Spoken {
  speaker_name?: string;
  speaker_contact?: { email: string; phone: string } | null;
}

export const speakerKey = (session: Spoken): string | null => {
  const name = session.speaker_name?.trim();
  if (!name) return null;
  const email = session.speaker_contact?.email?.trim().toLowerCase() ?? '';
  return `${name.toLowerCase()} ${email}`;
};

/**
 * Group anything carrying a session by the speaker giving it, keeping the
 * order they first appear in the day.
 */
export const groupBySpeaker = <T>(
  rows: T[],
  sessionOf: (row: T) => Spoken
): { key: string; name: string; rows: T[] }[] => {
  const order: string[] = [];
  const byKey: Record<string, { name: string; rows: T[] }> = {};

  rows.forEach((row) => {
    const session = sessionOf(row);
    const key = speakerKey(session);
    if (!key) return;
    if (!byKey[key]) {
      byKey[key] = { name: session.speaker_name!.trim(), rows: [] };
      order.push(key);
    }
    byKey[key].rows.push(row);
  });

  return order.map((key) => ({ key, name: byKey[key].name, rows: byKey[key].rows }));
};
