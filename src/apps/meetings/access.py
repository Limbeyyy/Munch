"""Who can see which meetings, and the programmes they belong to.

Access follows the invitation. An organizer runs a programme; everyone
else reaches it because they were invited to a meeting inside it, or
because they have already joined one. Nobody sees a programme they have
no part in.

Guests are outside all of this: they hold a signed token for one meeting
and read it through their own endpoints.
"""
from django.db.models import Q


def meetings_visible_to(user):
    """A filter for the meetings this person may see.

    Membership rather than presence: somebody who joined and stepped out
    keeps their access, because the meeting is still theirs to look back on.
    An invitation counts too - being asked is what tells them the meeting
    exists in the first place.
    """
    return (
        Q(host=user)
        | Q(participants__user=user)
        | Q(invites__email__iexact=user.email)
    )


def events_visible_to(user):
    """A filter for the programmes this person may see."""
    return (
        Q(organizer=user)
        | Q(meetings__host=user)
        | Q(meetings__participants__user=user)
        | Q(meetings__invites__email__iexact=user.email)
    )


def sessions_visible_to(user):
    """The same rule, one relation further out.

    Written out rather than derived from the meeting filter: rewriting a Q
    object's internals is the kind of cleverness that breaks quietly.
    """
    return (
        Q(meeting__host=user)
        | Q(meeting__participants__user=user)
        | Q(meeting__invites__email__iexact=user.email)
    )


def can_see_meeting(meeting, user) -> bool:
    """Whether this person may look at one particular meeting."""
    if not user or not user.is_authenticated:
        return False
    if str(meeting.host_id) == str(user.id):
        return True
    if meeting.participants.filter(user=user).exists():
        return True
    return meeting.invites.filter(email__iexact=user.email).exists()
