"""Background upkeep for the timetable."""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name='src.apps.meetings.tasks.write_reminders')
def write_reminders():
    """Keep everybody's reminders in step with the timetable.

    The app generates these as it reads them, which covers anybody who has
    the page open. This is for the rest: somebody who will not open it
    until tomorrow morning should still have an hour's warning waiting.
    """
    from django.utils import timezone

    from src.apps.meetings.models import Event
    from src.apps.meetings.reminders import generate_for_meeting

    upcoming = Event.objects.filter(
        scheduled_end__gte=timezone.now()
    ).exclude(status=Event.Status.ENDED)

    written = sum(generate_for_meeting(event) for event in upcoming)
    if written:
        logger.info(f"Wrote {written} reminder(s)")
    return written


@shared_task(name='src.apps.meetings.tasks.forget_guests_of_ended_meetings')
def forget_guests_of_ended_meetings():
    """Delete guest rows left behind by events that are over.

    Every ordinary way a event ends forgets its guests on the way out.
    This is for the rest: a event that ended before there was a rule
    about it, or one whose closing did not run to the end. A guest gave a
    name at a door for an afternoon, and a row about them should not
    outlive the afternoon by a year because a worker was restarted.
    """
    from src.apps.meetings.lifecycle import forget_guests
    from src.apps.meetings.models import GuestAttendee, Event

    stale = Event.objects.filter(
        status=Event.Status.ENDED,
        id__in=GuestAttendee.objects.values('event_id'),
    )
    forgotten = sum(forget_guests(event) for event in stale)
    if forgotten:
        logger.info(f"Forgot {forgotten} guest row(s) from events that are over")
    return forgotten
