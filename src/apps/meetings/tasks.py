"""Background upkeep for the timetable."""
import logging

from celery import shared_task

from src.apps.meetings.lifecycle import sweep_expired

logger = logging.getLogger(__name__)


@shared_task(name='src.apps.meetings.tasks.close_expired_sessions')
def close_expired_sessions():
    """End anything still on stage past the time it was given.

    The organizer and attendee panels already close overrunning sessions as
    they read them, which covers every case where somebody is watching.
    This is for the case where nobody is: a hall that emptied out on Friday
    should not still be showing a live session on Monday.

    Sessions nobody ever started are untouched — those read as never
    started, which is a different thing entirely.
    """
    closed = sweep_expired()
    if closed:
        logger.info(f"Closed {closed} session(s) that ran past their slot")
    return closed


@shared_task(name='src.apps.meetings.tasks.write_reminders')
def write_reminders():
    """Keep everybody's reminders in step with the timetable.

    The app generates these as it reads them, which covers anybody who has
    the page open. This is for the rest: somebody who will not open it
    until tomorrow morning should still have an hour's warning waiting.
    """
    from django.utils import timezone

    from src.apps.meetings.models import Meeting
    from src.apps.meetings.reminders import generate_for_meeting

    upcoming = Meeting.objects.filter(
        scheduled_end__gte=timezone.now()
    ).exclude(status=Meeting.Status.ENDED)

    written = sum(generate_for_meeting(meeting) for meeting in upcoming)
    if written:
        logger.info(f"Wrote {written} reminder(s)")
    return written
