"""Telling people about a session before it happens, not after.

Two rhythms, because two different things are being remembered. A meeting
is somewhere you have to get to, so an hour's warning is what is useful. A
session is a talk inside a meeting you are probably already at, so fifteen
minutes is enough - and an hour's warning for each of four talks would be
noise rather than help.

Reminders are rows rather than emails sent on the spot. A row can be shown
in the app, marked as read, and generated again idempotently, none of which
a fired-and-forgotten message can do.
"""
from django.utils import timezone

#: How long before a meeting somebody wants to know about it.
MEETING_LEAD_MINUTES = 60
#: And before one talk inside it.
SESSION_LEAD_MINUTES = 15

#: The most warning worth offering. A day ahead is a diary entry, which is
#: what the calendar link is for.
MAX_LEAD_MINUTES = 1440


def leads_for(meeting):
    """How much warning this meeting's programme gives, and whether any.

    Read from the host: the hour before a meeting and the quarter before a
    talk were the rule for everybody, and they suit a conference where
    people travel in. A ward meeting down the corridor wants less, and a
    programme people fly to wants more.
    """
    account = getattr(getattr(meeting, 'host', None), 'host_account', None)
    if account is None:
        return {
            'enabled': True,
            'meeting': MEETING_LEAD_MINUTES,
            'session': SESSION_LEAD_MINUTES,
        }
    return {
        'enabled': account.reminders_enabled,
        'meeting': int(account.meeting_reminder_minutes),
        'session': int(account.session_reminder_minutes),
    }


def audience_for(meeting):
    """Everyone who should hear about this meeting.

    The people it belongs to: whoever runs it, whoever was asked, whoever
    is speaking, and whoever has already joined. Guests are not here -
    they hold a token for one room and have no account to remind.
    """
    from src.apps.accounts.models import User
    from src.apps.meetings.access import meetings_visible_to
    from src.apps.meetings.models import Meeting

    return User.objects.filter(
        id__in=Meeting.objects.filter(
            id=meeting.id
        ).values_list('participants__user_id', flat=True)
    ) | User.objects.filter(
        email__in=list(meeting.invites.values_list('email', flat=True))
        + list(meeting.sessions.exclude(speaker_email='').values_list(
            'speaker_email', flat=True))
    ) | User.objects.filter(id=meeting.host_id)


def due_at(subject, lead_minutes):
    return subject - timezone.timedelta(minutes=lead_minutes)


def generate_for_meeting(meeting, now=None):
    """Write the reminders this meeting owes, without writing them twice.

    Idempotent: the row is keyed on who it is for and what it is about, so
    running this again after the timetable moves updates when it is due
    rather than adding another.
    """
    from src.apps.meetings.models import Reminder

    now = now or timezone.now()
    if meeting.status == meeting.Status.ENDED:
        return 0

    leads = leads_for(meeting)
    # A host who has turned reminders off is not owed the argument that
    # they might want them; nothing is written at all.
    if not leads['enabled']:
        return 0

    people = list(audience_for(meeting).distinct())
    if not people:
        return 0

    written = 0

    if meeting.scheduled_start > now:
        when = due_at(meeting.scheduled_start, leads['meeting'])
        for person in people:
            _, created = Reminder.objects.update_or_create(
                user=person, meeting=meeting, session=None,
                kind=Reminder.Kind.MEETING,
                defaults={'due_at': when, 'starts_at': meeting.scheduled_start},
            )
            written += int(created)

    for session in meeting.sessions.all():
        if session.starts_at <= now or session.status != session.Status.SCHEDULED:
            continue
        when = due_at(session.starts_at, leads['session'])
        for person in people:
            _, created = Reminder.objects.update_or_create(
                user=person, meeting=meeting, session=session,
                kind=Reminder.Kind.SESSION,
                defaults={'due_at': when, 'starts_at': session.starts_at},
            )
            written += int(created)

    return written


def calendar_link(*, title, starts_at, ends_at, details='', location='') -> str:
    """A link that puts this in somebody's Google Calendar.

    A template link rather than an API call: it needs no tokens, no scopes
    and no consent screen, works for anybody with a Google account, and
    lets the person see what they are adding before they add it.
    """
    from urllib.parse import urlencode

    stamp = '%Y%m%dT%H%M%SZ'
    query = urlencode({
        'action': 'TEMPLATE',
        'text': title,
        'dates': f"{starts_at.astimezone(timezone.utc).strftime(stamp)}/"
                 f"{ends_at.astimezone(timezone.utc).strftime(stamp)}",
        'details': details,
        'location': location,
    })
    return f'https://calendar.google.com/calendar/render?{query}'
