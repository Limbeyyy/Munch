import { Session, SubEvent } from '../../types';

/**
 * A programme read in its named parts.
 *
 * Every screen that lists anything belonging to a talk - the running
 * order, the speakers, the files, the questions, and the host's own
 * board where the headings are written - draws it under the same
 * headings, so the grouping is worked out once here rather than
 * several times slightly differently.
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

/**
 * @param keepEmpty Keep a named part that nothing has been filed under.
 *
 * False for anyone reading the programme: a heading with nothing under
 * it tells a reader nothing and reads as a gap in the day.
 *
 * True for the host arranging it, who wrote the heading a moment ago
 * and is about to put talks under it. Dropping it there would make the
 * thing they just created appear not to have been created.
 */
export const groupSessions = (
  sessions: Session[],
  groups: SubEvent[],
  looseTitle: string,
  keepEmpty = false
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
    .filter((group) => keepEmpty || group.sessions.length > 0);

  const loose = sessions.filter((one) => !one.sub_event).sort(byTime);
  if (loose.length === 0) return named;

  // Last, because a named part is what the host arranged and this is
  // what is left over - but present, because it is still the day.
  return [
    ...named,
    { id: UNGROUPED, title: looseTitle, description: '', sessions: loose },
  ];
};
