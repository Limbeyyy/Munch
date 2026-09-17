"""What somebody is allowed to be, and over which part of the programme.

A role is given at one scope and reaches exactly that far: an event covers
everything inside it, and a session covers only itself. Nothing spreads
sideways - one event's co-hosts are strangers to the next.

Speakers are read from the sessions that name them rather than stored
again here. Naming somebody as a session's speaker is what makes them its
presenter.
"""
from django.db.models import Q

from src.apps.meetings.models import Event, RoleGrant, Session

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


def grants_reaching_event(event):
    """Every grant that covers this event.

    Session-scoped grants are deliberately absent. They reach one session,
    not the event holding it - somebody asked to present one talk is not
    thereby running the whole morning.
    """
    return RoleGrant.objects.filter(Q(event=event))


def grants_reaching_session(session):
    """Every grant that covers this session: its own and its event's."""
    covering = Q(session=session) | Q(event_id=session.event_id)
    return RoleGrant.objects.filter(covering)


def roles_in_event(event, user=None, email=None) -> set:
    """The roles this person holds over a whole event."""
    if str(getattr(user, 'id', None)) == str(event.host_id):
        return {'host'}
    who = _identifies(user, email)
    if not who:
        return set()
    return set(grants_reaching_event(event).filter(who).values_list('role', flat=True))


def roles_in_session(session, user=None, email=None) -> set:
    """The roles this person holds over one session.

    Includes being its speaker, which is a presenting role by definition
    rather than by a separate grant.
    """
    if str(getattr(user, 'id', None)) == str(session.event.host_id):
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


def is_co_host(event, user) -> bool:
    """Whether this person helps run the event, without owning it."""
    return CO_HOST in roles_in_event(event, user=user)


def speaks_at(event, user=None, email=None) -> bool:
    """Whether this person is down to speak at some part of this event.

    Read from the running order: a session names its speaker by address,
    and giving that address is what makes somebody its presenter. Nothing
    has to be granted separately.
    """
    address = (email or getattr(user, 'email', '') or '').strip()
    if not address:
        return False
    return Session.objects.filter(
        event=event, speaker_email__iexact=address
    ).exists()


def participant_role_for(event, user) -> str:
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
    from src.apps.meetings.models import EventParticipant

    if str(user.id) == str(event.host_id):
        return EventParticipant.Role.HOST
    if is_co_host(event, user):
        return EventParticipant.Role.CO_HOST
    if speaks_at(event, user=user) or PRESENTER in roles_in_event(event, user=user):
        return EventParticipant.Role.PRESENTER
    return EventParticipant.Role.ATTENDEE


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
    for session in Session.objects.filter(event=event):
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

    return RoleGrant.objects.filter(
        Q(event=event)
        | Q(session__event=event)
    ).select_related('event', 'session')


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


def presenter_details(event, *, name='', phone=''):
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
        for session in Session.objects.filter(event=event).exclude(speaker_phone=''):
            if _digits(session.speaker_phone) == typed_phone:
                return session.speaker_name or session.speaker_email

    if '@' in typed_name:
        speaking = Session.objects.filter(
            event=event, speaker_email__iexact=typed_name
        ).first()
        if speaking is not None:
            return speaking.speaker_name or speaking.speaker_email

        granted = RoleGrant.objects.filter(
            email__iexact=typed_name,
            role__in=[RoleGrant.Role.PRESENTER, RoleGrant.Role.CO_HOST],
        ).filter(
            Q(event=event)
            | Q(session__event=event)
        ).first()
        if granted is not None:
            return granted.email

    return None
