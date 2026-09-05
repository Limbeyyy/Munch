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
