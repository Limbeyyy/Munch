"""The attendee hub: questions, ideas, and suggestions to the organizer.

Three things people do in a room, kept in one place because they are the
same shape - somebody writes a line, the others vote on it, the organizer
answers or acts.

What differs is who reads them. Questions and ideas are for the room, so
they wait for the organizer to let them through. A suggestion is a private
word with the organizer and is never shown to anybody else, which is why
the author can always see their own and nobody else can.

Guests take part on the same terms as account holders. They are told apart
only where that matters: one vote each, and their own posts back.
"""
from django.db.models import Count, Q, Sum

from src.apps.meetings.models import HubPost, HubVote

#: What an attendee may still change their mind about posting under.
PUBLIC_KINDS = (HubPost.Kind.QUESTION, HubPost.Kind.IDEA)


def visible_to(meeting, *, user=None, guest=None):
    """The posts this person may read.

    Everything the organizer has let through, plus their own - including
    what is still in moderation, so somebody can see that their question
    arrived, and including their suggestions, which nobody else ever sees.
    """
    published = Q(status=HubPost.Status.PUBLISHED, kind__in=PUBLIC_KINDS)

    mine = Q(pk__in=[])
    if user is not None and getattr(user, 'is_authenticated', False):
        mine = Q(user=user)
    elif guest is not None:
        mine = Q(guest=guest)

    return (
        HubPost.objects.filter(meeting=meeting)
        .filter(published | mine)
        .select_related('session', 'user', 'guest')
        .annotate(
            score=Sum('votes__value'),
            vote_count=Count('votes'),
        )
    )


def score_of(post) -> int:
    return post.votes.aggregate(total=Sum('value'))['total'] or 0


def my_vote(post, *, user=None, guest=None):
    """How this person voted, if they did."""
    if user is not None and getattr(user, 'is_authenticated', False):
        vote = post.votes.filter(user=user).first()
    elif guest is not None:
        vote = post.votes.filter(guest=guest).first()
    else:
        return 0
    return vote.value if vote else 0


def cast(post, value, *, user=None, guest=None) -> int:
    """Record a vote, change one, or take it back.

    Voting the same way twice is read as withdrawing - the second press of
    the same button undoes the first, which is what people expect of a
    thing that looks like a toggle.
    """
    who = {'user': user} if user is not None and getattr(user, 'is_authenticated', False) \
        else {'guest': guest}
    existing = post.votes.filter(**who).first()

    if existing and existing.value == value:
        existing.delete()
    elif existing:
        existing.value = value
        existing.save(update_fields=['value'])
    else:
        HubVote.objects.create(post=post, value=value, **who)

    return score_of(post)


def as_json(post, *, user=None, guest=None) -> dict:
    """One post, as the hub draws it."""
    return {
        'id': str(post.id),
        'kind': post.kind,
        'body': post.body,
        'category': post.category,
        'status': post.status,
        'anonymous': post.anonymous,
        'author': post.author_label,
        'author_is_guest': post.guest_id is not None,
        'mine': _is_mine(post, user=user, guest=guest),
        'session_id': str(post.session_id) if post.session_id else None,
        'session_title': post.session.title if post.session_id else None,
        'score': score_of(post),
        'my_vote': my_vote(post, user=user, guest=guest),
        'answer': post.answer,
        'answered_by': post.answered_by,
        'created_at': post.created_at,
    }


def _is_mine(post, *, user=None, guest=None) -> bool:
    if user is not None and getattr(user, 'is_authenticated', False):
        return str(post.user_id) == str(user.id)
    if guest is not None:
        return str(post.guest_id) == str(guest.id)
    return False


def board_for(meeting, *, user=None, guest=None) -> dict:
    """Everything the hub shows, in the three lists it shows it in.

    Questions come highest-voted first - the room's own sense of what most
    wants answering. Ideas the same. Somebody's own suggestions stay in the
    order they sent them, which is how they remember them.
    """
    posts = list(visible_to(meeting, user=user, guest=guest))
    rendered = [as_json(p, user=user, guest=guest) for p in posts]

    def of(kind):
        return [r for r in rendered if r['kind'] == kind]

    by_score = lambda rows: sorted(rows, key=lambda r: (-r['score'], r['created_at']))

    return {
        'questions': by_score(of(HubPost.Kind.QUESTION)),
        'ideas': by_score(of(HubPost.Kind.IDEA)),
        # Only ever the asker's own; nobody else's are in `visible_to`.
        'suggestions': sorted(
            of(HubPost.Kind.SUGGESTION), key=lambda r: r['created_at'], reverse=True
        ),
    }
