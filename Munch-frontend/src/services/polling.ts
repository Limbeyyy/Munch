/**
 * How often the screens refetch when nothing has told them to.
 *
 * Most of these are a safety net rather than the way news arrives: the
 * meeting room and the hub both have sockets, and the dashboards are
 * showing counts that can be a few seconds stale without anybody minding.
 * They used to run every eight or ten seconds, which added up to thousands
 * of requests an hour from a single open tab.
 *
 * Anything a person is actually waiting on - a guest at the door, a
 * meeting about to start - is deliberately not in here. Those stay quick,
 * and live where they are used.
 */

/** Dashboard lists: meetings, events, the attendee's programme. */
export const LIST_POLL_MS = 25000;

/** Queues and counts the organizer glances at rather than watches. */
export const QUEUE_POLL_MS = 30000;

/** Screens being actively worked in: moderation, the live view, the hub. */
export const ACTIVE_POLL_MS = 20000;

/** Files, which change rarely and are already only fetched when visible. */
export const RESOURCE_POLL_MS = 30000;
