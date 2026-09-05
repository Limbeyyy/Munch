"""The smallest programme worth scheduling, for the tests to work on."""
import uuid

from django.utils import timezone

from src.apps.accounts.models import User
from src.apps.meetings.models import Event, Meeting, Session


def make_host(email=None):
    email = email or f'host-{uuid.uuid4().hex[:8]}@example.com'
    return User.objects.create(email=email, username=email.split('@')[0], is_verified=True)


def make_event(host, day=None):
    day = day or (timezone.now() + timezone.timedelta(days=1)).date()
    return Event.objects.create(title='Test day', organizer=host, event_date=day)


def make_meeting(host, event=None, start=None, minutes=240, title='Meeting'):
    start = start or timezone.now() + timezone.timedelta(days=1)
    return Meeting.objects.create(
        event=event,
        host=host,
        title=title,
        meeting_code=uuid.uuid4().hex[:7].upper(),
        scheduled_start=start,
        scheduled_end=start + timezone.timedelta(minutes=minutes),
    )


def make_session(meeting, start, minutes=60, title='Session', status=Session.Status.SCHEDULED):
    return Session.objects.create(
        meeting=meeting,
        title=title,
        starts_at=start,
        duration_minutes=minutes,
        status=status,
        speaker_name='A Speaker',
        speaker_email='speaker@example.com',
        speaker_phone='9800000000',
    )


def at(base, hours=0, minutes=0):
    """A time relative to a fixed base, so the arithmetic reads plainly."""
    return base + timezone.timedelta(hours=hours, minutes=minutes)
