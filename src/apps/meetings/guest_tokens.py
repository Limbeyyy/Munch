"""Signed tokens that identify a guest without an account.

A guest has no User row, so they cannot hold a JWT. Instead they get a signed
token naming their GuestAttendee row; the signature is what proves they are
the person the host admitted.
"""
from django.core import signing

SALT = 'munch.meeting.guest'
MAX_AGE_SECONDS = 60 * 60 * 12


def make_guest_token(guest) -> str:
    return signing.dumps(
        {'guest_id': str(guest.id), 'meeting_code': guest.meeting.meeting_code},
        salt=SALT,
    )


def read_guest_token(token: str):
    """Return the token payload, or None if it is invalid or expired."""
    try:
        return signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    except (signing.BadSignature, signing.SignatureExpired):
        return None


def resolve_guest(token: str):
    """Return the GuestAttendee a token refers to, or None."""
    from src.apps.meetings.models import GuestAttendee

    payload = read_guest_token(token)
    if not payload:
        return None
    return GuestAttendee.objects.select_related('meeting').filter(
        id=payload.get('guest_id')
    ).first()
