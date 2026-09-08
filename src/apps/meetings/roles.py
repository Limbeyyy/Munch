"""What somebody is allowed to be, and over which part of the programme.

A role is given at one scope and reaches exactly that far: an event covers
everything inside it, a meeting covers its own sessions, a session covers
only itself. Nothing spreads sideways - being co-host of the morning
meeting says nothing about the evening one, and one event's co-hosts are
strangers to the next event.

Speakers are read from the sessions that name them rather than stored
again here. Naming somebody as a session's speaker is what makes them its
presenter.
"""
from django.db.models import Q

from src.apps.meetings.models import Meeting, RoleGrant, Session

# The stored values, not the enum members. Roles from the database arrive
# as plain strings and these are mixed into the same sets; keeping one type
# throughout stops a set holding two spellings of the same role.
CO_HOST = RoleGrant.Role.CO_HOST.value
PRESENTER = RoleGrant.Role.PRESENTER.value


def _identifies(user=None, email=None):
    """Match a grant to a person, by account or by the address it names."""
    address = (email or (user.email if user else '') or '').strip()
    matched = Q()
    if user is not None and getattr(user, 'is_authenticated', True):
        matched |= Q(user=user)
        address = address or user.email
    if address:
        matched |= Q(email__iexact=address)
    return matched


def grants_reaching_meeting(meeting):
    """Every grant that covers this meeting: its own, and its event's.

    Session-scoped grants are deliberately absent. They reach one session,
    not the meeting holding it - somebody asked to present one talk is not
    thereby running the whole morning.
    """
    covering = Q(meeting=meeting)
    if meeting.event_id:
        covering |= Q(event_id=meeting.event_id)
    return RoleGrant.objects.filter(covering)


def grants_reaching_session(session):
    """Every grant that covers this session: its own, its meeting's, its event's."""
    covering = Q(session=session) | Q(meeting_id=session.meeting_id)
    if session.meeting.event_id:
        covering |= Q(event_id=session.meeting.event_id)
    return RoleGrant.objects.filter(covering)


def roles_in_meeting(meeting, user=None, email=None) -> set:
    """The roles this person holds over a whole meeting."""
    if str(getattr(user, 'id', None)) == str(meeting.host_id):
        return {'host'}
    who = _identifies(user, email)
    if not who:
        return set()
    return set(grants_reaching_meeting(meeting).filter(who).values_list('role', flat=True))


def roles_in_session(session, user=None, email=None) -> set:
    """The roles this person holds over one session.

    Includes being its speaker, which is a presenting role by definition
    rather than by a separate grant.
    """
    if str(getattr(user, 'id', None)) == str(session.meeting.host_id):
        return {'host'}

    held = set()
    address = (email or getattr(user, 'email', '') or '').strip()
    if address and session.speaker_email and \
            session.speaker_email.strip().lower() == address.lower():
        held.add(PRESENTER)

    who = _identifies(user, email)
    if who:
        held |= set(
            grants_reaching_session(session).filter(who).values_list('role', flat=True)
        )
    return held


def is_co_host(meeting, user) -> bool:
    """Whether this person helps run the meeting, without owning it."""
    return CO_HOST in roles_in_meeting(meeting, user=user)


def speaks_at(meeting, user=None, email=None) -> bool:
    """Whether this person is down to speak at some part of this meeting.

    Read from the running order: a session names its speaker by address,
    and giving that address is what makes somebody its presenter. Nothing
    has to be granted separately.
    """
    address = (email or getattr(user, 'email', '') or '').strip()
    if not address:
        return False
    return Session.objects.filter(
        meeting=meeting, speaker_email__iexact=address
    ).exists()


def participant_role_for(meeting, user) -> str:
    """The role to record when this person walks into the room.

    The host is always the host. Anyone named as a co-host arrives as one
    rather than as an attendee somebody has to promote. And a speaker
    arrives as a presenter: they gave their address when the session was
    written down, so the room already knows who they are.

    Only an account holder can be any of these. A guest is somebody who
    typed a name and a phone number at the door, and neither is proof of
    anything - which is why knowing a speaker's details gets a guest no
    further than the seats.
    """
    from src.apps.meetings.models import MeetingParticipant

    if str(user.id) == str(meeting.host_id):
        return MeetingParticipant.Role.HOST
    if is_co_host(meeting, user):
        return MeetingParticipant.Role.CO_HOST
    if speaks_at(meeting, user=user) or PRESENTER in roles_in_meeting(meeting, user=user):
        return MeetingParticipant.Role.PRESENTER
    return MeetingParticipant.Role.ATTENDEE


def claim_grants(user):
    """Attach a newly seen account to the grants that named its address.

    A host writes down an address before the person has signed in. This is
    what links the two once they do, so the grant stops depending on a
    string comparison.
    """
    return RoleGrant.objects.filter(
        email__iexact=user.email, user__isnull=True
    ).update(user=user)


def speakers_of(event):
    """Who is presenting in this programme, from the running order itself."""
    found = {}
    for session in Session.objects.filter(meeting__event=event).select_related('meeting'):
        address = (session.speaker_email or '').strip().lower()
        key = address or f'name:{(session.speaker_name or "").strip().lower()}'
        if not key or key == 'name:':
            continue
        found.setdefault(key, {
            'name': session.speaker_name,
            'email': session.speaker_email,
            'sessions': [],
        })['sessions'].append(session)
    return list(found.values())


def grants_in_event(event):
    """Every grant anywhere in this programme, whatever it is scoped to."""
    meetings = Meeting.objects.filter(event=event).values_list('id', flat=True)
    return RoleGrant.objects.filter(
        Q(event=event)
        | Q(meeting_id__in=list(meetings))
        | Q(session__meeting__event=event)
    ).select_related('event', 'meeting', 'session', 'session__meeting')


def _digits(value: str) -> str:
    """A phone number reduced to what actually identifies it."""
    return ''.join(ch for ch in (value or '') if ch.isdigit())


def account_holder(typed):
    """The account an address at the guest door belongs to, if any.

    An address identifies exactly one account here - the email column is
    unique - so somebody typing one at the guest door is either signing in
    under their own name or borrowing somebody else's. Neither belongs at
    a door that asks for no proof: the first has an account to sign in
    with, and the second would be sitting in the room under a name that is
    not theirs, with no way for anybody to tell.
    """
    address = (typed or '').strip()
    if '@' not in address:
        return None

    from src.apps.accounts.models import User

    return User.objects.filter(email__iexact=address).first()


def presenter_details(meeting, *, name='', phone=''):
    """Whether these door details belong to somebody down to present.

    A presenter is somebody the organizer named, by an address they can be
    reached at - so presenting is tied to that account and nothing else. A
    name and a phone number typed at a door prove neither, which is why
    somebody arriving with a presenter's details has to sign in instead of
    being waved through as a guest.

    Matched on the phone number the organizer wrote down, or on the address
    itself when that is what was typed in the name box. Names alone are not
    enough: two people share a name far more easily than a number.
    """
    typed_name = (name or '').strip()
    typed_phone = _digits(phone)

    if typed_phone:
        for session in Session.objects.filter(meeting=meeting).exclude(speaker_phone=''):
            if _digits(session.speaker_phone) == typed_phone:
                return session.speaker_name or session.speaker_email

    if '@' in typed_name:
        speaking = Session.objects.filter(
            meeting=meeting, speaker_email__iexact=typed_name
        ).first()
        if speaking is not None:
            return speaking.speaker_name or speaking.speaker_email

        granted = RoleGrant.objects.filter(
            email__iexact=typed_name,
            role__in=[RoleGrant.Role.PRESENTER, RoleGrant.Role.CO_HOST],
        ).filter(
            Q(meeting=meeting)
            | Q(event_id=meeting.event_id, event__isnull=False)
            | Q(session__meeting=meeting)
        ).first()
        if granted is not None:
            return granted.email

    return None
