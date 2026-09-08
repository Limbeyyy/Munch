"""Which portal a signed-in person belongs in.

Three kinds of people use Manch. A **host** runs programmes; a **attendee**
has been put on the list for someone else's; a **guest** never signs in at all
and reaches a meeting by code or QR, so they have no account here to describe.

Someone can be both host and attendee — an organizer is often on another
department's invitation list — which is why the sign-in chooser asks rather
than guesses.
"""
from src.apps.accounts.plans import plan_for, usage_for


def is_host(user) -> bool:
    """Host standing is the row, not the history: see accounts.HostAccount."""
    return hasattr(user, 'host_account')


def is_attendee(user) -> bool:
    """Whether anyone has put this person on a list."""
    from src.apps.meetings.access import meetings_visible_to
    from src.apps.meetings.models import Meeting

    return Meeting.objects.filter(meetings_visible_to(user)).exclude(host=user).exists()


def portals_for(user) -> list:
    """The portals this person may open, in the order to offer them."""
    portals = []
    if is_host(user):
        portals.append('host')
    if is_attendee(user):
        portals.append('attendee')
    return portals


def signs_in_with_google(user) -> bool:
    """Whether this account gets in through Google.

    Two places record it and they do not always agree: the sign-in stores
    the subject on the user, and the OAuth exchange stores a connection.
    Accounts exist with the second and not the first, so asking only the
    user's own column reports a Google account as a password one and hands
    somebody the wrong advice at the door.
    """
    if getattr(user, 'google_subject', None):
        return True
    return user.google_connections.filter(is_active=True).exists()


def roles_payload(user) -> dict:
    """What the sign-in chooser and the organizer dashboard need to know."""
    host = is_host(user)
    plan = plan_for(user)
    account = getattr(user, 'host_account', None)
    return {
        'is_host': host,
        'is_attendee': is_attendee(user),
        # Anyone may become a host; the free trial is what they start on.
        'can_start_hosting': not host,
        'portals': portals_for(user),
        'plan': plan.as_json() if host else None,
        'usage': usage_for(user) if host else None,
        'subscription': {
            'status': account.status,
            'current_period_end': account.current_period_end,
        } if account else None,
    }


def ensure_host(user):
    """Record host standing for someone who is plainly hosting.

    Creating a programme is itself the decision to host, so the row follows
    the act rather than making the act wait for the row.
    """
    from src.apps.accounts.models import HostAccount

    account, _ = HostAccount.objects.get_or_create(
        user=user,
        defaults={'plan': HostAccount.Plan.FREE, 'status': HostAccount.Status.TRIAL},
    )
    return account
