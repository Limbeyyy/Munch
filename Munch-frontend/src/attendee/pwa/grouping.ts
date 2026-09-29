import { Session, SubEvent } from '../../types';

/**
 * A programme read in its named parts.
 *
 * Every screen in the attendee app that lists anything belonging to a
 * talk - the running order, the speakers, the files, the questions -
 * draws it under the same headings, so the grouping is worked out once
 * here rather than four times slightly differently.
 *
 * Talks in no group are not dropped. A heading is a way of reading the
 * day; a talk without one is still on the programme, and hiding it
 * because nobody has filed it yet would lose it from every screen at
 * once.
 */
export interface Grouped {
  id: string;
  title: string;
  description: string;
  sessions: Session[];
}

/** The word a talk in no named part is read under. */
export const UNGROUPED = '';

export const groupSessions = (
  sessions: Session[],
  groups: SubEvent[],
  looseTitle: string
): Grouped[] => {
  const byTime = (a: Session, b: Session) =>
    +new Date(a.starts_at) - +new Date(b.starts_at);

  const named = [...groups]
    .sort((a, b) => (a.position - b.position)
      || (+new Date(a.created_at) - +new Date(b.created_at)))
    .map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      sessions: sessions
        .filter((one) => one.sub_event === group.id)
        .sort(byTime),
    }))
    .filter((group) => group.sessions.length > 0);

  const loose = sessions.filter((one) => !one.sub_event).sort(byTime);
  if (loose.length === 0) return named;

  // Last, because a named part is what the host arranged and this is
  // what is left over - but present, because it is still the day.
  return [
    ...named,
    { id: UNGROUPED, title: looseTitle, description: '', sessions: loose },
  ];
};
