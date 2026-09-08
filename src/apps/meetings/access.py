"""Who can see which meetings, and the programmes they belong to.

Access follows the asking. An organizer runs a programme; everyone else
reaches it because somebody put them in it - invited them, named them as a
speaker, or gave them a role over part of it - or because they have
already joined. Nobody sees a programme they have no part in.

Being named is enough on its own. A speaker should open their dashboard
and find the session they are due to give, rather than having to be sent a
link before the day exists for them at all; the same goes for a co-host.

Guests are outside all of this: they hold a signed token for one meeting
and read it through their own endpoints.
"""
from django.db.models import Q


def _named(user, **lookups):
    """A clause matching this person's address, or nothing at all.

    An empty address must match nobody. Without this guard it would match
    every session whose speaker was left blank, which is most of them.
    """
    address = (getattr(user, 'email', '') or '').strip()
    if not address:
        return Q(pk__in=[])
    matched = Q()
    for field in lookups.values():
        matched |= Q(**{f'{field}__iexact': address})
    return matched


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
        | _named(user, invited='invites__email')
        # Named on the running order, or given a role over this meeting,
        # its programme, or one of its sessions.
        | _named(user, speaks='sessions__speaker_email')
        | _named(user, granted='role_grants__email')
        | _named(user, on_event='event__role_grants__email')
        | _named(user, on_session='sessions__role_grants__email')
    )


def events_visible_to(user):
    """A filter for the programmes this person may see."""
    return (
        Q(organizer=user)
        | Q(meetings__host=user)
        | Q(meetings__participants__user=user)
        | _named(user, invited='meetings__invites__email')
        | _named(user, speaks='meetings__sessions__speaker_email')
        | _named(user, granted='role_grants__email')
        | _named(user, on_meeting='meetings__role_grants__email')
        | _named(user, on_session='meetings__sessions__role_grants__email')
    )


def sessions_visible_to(user):
    """The same rule, one relation further out.

    Written out rather than derived from the meeting filter: rewriting a Q
    object's internals is the kind of cleverness that breaks quietly.
    """
    return (
        Q(meeting__host=user)
        | Q(meeting__participants__user=user)
        | _named(user, invited='meeting__invites__email')
        # A speaker sees the whole running order of the meeting they speak
        # at: knowing what runs before and after yours is the point of one.
        | _named(user, speaks='meeting__sessions__speaker_email')
        | _named(user, granted='meeting__role_grants__email')
        | _named(user, on_event='meeting__event__role_grants__email')
        | _named(user, on_session='role_grants__email')
    )


def can_see_meeting(meeting, user) -> bool:
    """Whether this person may look at one particular meeting."""
    if not user or not user.is_authenticated:
        return False
    if str(meeting.host_id) == str(user.id):
        return True
    if meeting.participants.filter(user=user).exists():
        return True

    from src.apps.meetings.models import Meeting

    return Meeting.objects.filter(
        Q(pk=meeting.pk) & meetings_visible_to(user)
    ).exists()
