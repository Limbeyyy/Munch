"""Who can see which events, and the programmes they belong to.

Access follows the asking. An organizer runs a programme; everyone else
reaches it because somebody put them in it - invited them, named them as a
speaker, or gave them a role over part of it - or because they have
already joined. Nobody sees a programme they have no part in.

Being named is enough on its own. A speaker should open their dashboard
and find the session they are due to give, rather than having to be sent a
link before the day exists for them at all; the same goes for a co-host.

Guests are outside all of this: they hold a signed token for one event
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


def events_visible_to(user):
    """A filter for the events this person may see.

    Membership rather than presence: somebody who joined and stepped out
    keeps their access, because the event is still theirs to look back on.
    An invitation counts too - being asked is what tells them the event
    exists in the first place.
    """
    return (
        Q(host=user)
        | Q(participants__user=user)
        | _named(user, invited='invites__email')
        # Named on the running order, or given a role over the event or
        # one of its sessions.
        | _named(user, speaks='sessions__speaker_email')
        | _named(user, granted='role_grants__email')
        | _named(user, on_session='sessions__role_grants__email')
    )


def events_attended_by(user):
    """The events this person may see for some reason other than running one.

    The attendee side's rule. Hosting an event is not attending it: a
    host opening the app on their phone is looking at other people's
    programmes, and their own SOS has no business appearing there with
    nobody having asked them to it.

    Never their own event, by any route. A host cannot be invited to
    what they are running, cannot be a participant in it, and does not
    meet it in the app - the event is theirs to run and the host portal
    is where it is run from.

    The one trap is the participant row. Creating an event gives the
    host one straight away, in the host role, so matching on
    participation alone would hand every host their own programmes back.
    The role has to be true of *their* row and not of any row on the
    event - otherwise one attendee turning up to Rahul's own event would
    satisfy it and put SOS back on his phone.

    Both halves therefore have to reach the database in one `filter()`
    call, which is what makes Django join the table once and test them
    against the same row. Splitting them over chained `.filter()` calls
    would join it twice and quietly lose the rule, so callers pass this
    whole thing to a single filter.
    """
    from src.apps.meetings.models import EventParticipant

    went = Q(
        participants__user=user,
        participants__role__in=[
            EventParticipant.Role.CO_HOST,
            EventParticipant.Role.PRESENTER,
            EventParticipant.Role.ATTENDEE,
        ],
    )

    return (
        went
        | _named(user, invited='invites__email')
        | _named(user, speaks='sessions__speaker_email')
        | _named(user, granted='role_grants__email')
        | _named(user, on_session='sessions__role_grants__email')
    ) & ~Q(host=user)


def sessions_visible_to(user):
    """The same rule, one relation further out.

    Written out rather than derived from the event filter: rewriting a Q
    object's internals is the kind of cleverness that breaks quietly.
    """
    return (
        Q(event__host=user)
        | Q(event__participants__user=user)
        | _named(user, invited='event__invites__email')
        # A speaker sees the whole running order of the event they speak
        # at: knowing what runs before and after yours is the point of one.
        | _named(user, speaks='event__sessions__speaker_email')
        | _named(user, granted='event__role_grants__email')
        | _named(user, on_session='role_grants__email')
    )


def can_see_event(event, user) -> bool:
    """Whether this person may look at one particular event."""
    if not user or not user.is_authenticated:
        return False
    if str(event.host_id) == str(user.id):
        return True
    if event.participants.filter(user=user).exists():
        return True

    from src.apps.meetings.models import Event

    return Event.objects.filter(
        Q(pk=event.pk) & events_visible_to(user)
    ).exists()
