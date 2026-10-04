"""The questions and suggestions a host has put up for the room.

Sorting a message here is a publishing decision rather than a label. The
board is read by everyone in the event, so a direct message put on it
stops being private - which is why only the host can do it.

One definition, read by the account-holder endpoint and the guest one, so
the two cannot drift into showing different things.
"""
from django.db.models import Sum

from src.apps.meetings.models import ChatMessage, HubVote

#: Messages that were never held, or that the host let through. Nothing
#: still pending or turned down can reach the board.
LET_THROUGH = [
    ChatMessage.Moderation.NOT_REQUIRED,
    ChatMessage.Moderation.APPROVED,
]


def _answerer(message):
    """Who answered, by the name the room would recognise."""
    person = message.answered_by
    if person is None:
        return ''
    full = f"{person.first_name} {person.last_name}".strip()
    return full or person.email


def score_of(message) -> int:
    """Upvotes less downvotes."""
    return message.votes.aggregate(total=Sum('value'))['total'] or 0


def vote_of(message, *, user=None, guest=None) -> int:
    """How this reader voted: 1, -1, or 0 for not yet."""
    if user is not None and getattr(user, 'is_authenticated', False):
        vote = message.votes.filter(user=user).first()
    elif guest is not None:
        vote = message.votes.filter(guest=guest).first()
    else:
        return 0
    return vote.value if vote else 0


def cast(message, value, *, user=None, guest=None) -> int:
    """Record a vote, change one, or take it back.

    The same rule as the hub: pressing the same way twice withdraws, which
    is what a thing shaped like a toggle should do.
    """
    who = (
        {'user': user}
        if user is not None and getattr(user, 'is_authenticated', False)
        else {'guest': guest}
    )
    existing = message.votes.filter(**who).first()

    if existing and existing.value == value:
        existing.delete()
    elif existing:
        existing.value = value
        existing.save(update_fields=['value'])
    else:
        HubVote.objects.create(message=message, value=value, **who)

    return score_of(message)


def _entry(message, *, user=None, guest=None):
    return {
        'id': str(message.id),
        'body': message.body,
        'session_id': str(message.session_id) if message.session_id else None,
        'asked_by': message.sender_label,
        'asker_is_guest': message.guest_sender_id is not None,
        'was_direct': message.is_direct,
        # A question without its answer is half an exchange.
        'answer': message.answer,
        'answered_by': _answerer(message),
        'answered_at': message.answered_at,
        # The room's own sense of what most wants answering.
        'score': score_of(message),
        'upvote_count': message.votes.filter(value=1).count(),
        'downvote_count': message.votes.filter(value=-1).count(),
        'my_vote': vote_of(message, user=user, guest=guest),
        # Who a question was put to, shown at the host's request: on a
        # board of questions it usually says which speaker is meant to
        # answer. It appears only for a message the host chose to publish.
        'sent_to': message.recipient_label if message.is_direct else None,
        'created_at': message.created_at,
    }


def _hub_entry(post, *, user=None, guest=None):
    """A hub post in the shape the board is read in.

    Two tables feed one board. A question put to the host privately is
    a ChatMessage; one written into the hub from the app is a HubPost;
    once the host has let either through, the room should read them in
    one list rather than having to know which door it came in by.
    """
    from src.apps.meetings import hub

    return {
        'id': str(post.id),
        'body': post.body,
        'session_id': str(post.session_id) if post.session_id else None,
        'asked_by': post.author_label,
        'asker_is_guest': post.guest_id is not None or bool(post.guest_name),
        'was_direct': False,
        'answer': post.answer,
        'answered_by': post.answered_by,
        'answered_at': None,
        'score': hub.score_of(post),
        'upvote_count': post.votes.filter(value=1).count(),
        'downvote_count': post.votes.filter(value=-1).count(),
        'my_vote': hub.my_vote(post, user=user, guest=guest),
        'sent_to': None,
        'created_at': post.created_at,
        #: Which table it came from, so a vote goes to the right place.
        'is_hub': True,
    }


def _published_hub(event):
    """What the host has let through from the hub."""
    from src.apps.meetings.models import HubPost

    return (
        HubPost.objects.filter(event=event)
        .select_related('session', 'user', 'guest')
        .prefetch_related('votes')
    )


def board_for(event, *, user=None, guest=None) -> dict:
    """The board, highest-voted first.

    The room decides what most wants answering, so what the host sees at
    the top is what people actually care about.

    Both tables feed it. A question asked from the attendee app lands in
    HubPost and used to reach no board at all, so the room's Questions
    panel said nothing was up however many the host had approved.
    """
    sorted_messages = (
        ChatMessage.objects.filter(event=event, moderation_status__in=LET_THROUGH)
        .exclude(topic=ChatMessage.Topic.NONE)
        .select_related('sender', 'guest_sender', 'recipient', 'guest_recipient',
                        'answered_by')
        .prefetch_related('votes')
        .order_by('created_at')
    )
    rendered = [_entry(m, user=user, guest=guest) for m in sorted_messages]

    from src.apps.meetings.models import HubPost

    posts = list(_published_hub(event))
    asked = [
        _hub_entry(p, user=user, guest=guest)
        for p in posts
        if p.status == HubPost.Status.PUBLISHED
    ]
    # Hub suggestions reach the organizer and nobody else.
    #
    # This board is read by everybody in the event, so they cannot
    # simply be added to it - a suggestion is a private word with the
    # organizer, and the ChatMessage ones on it are there only because
    # the host deliberately published them. But the host has to be able
    # to read their own post, so they are here for the host alone.
    reading_it = (
        user is not None
        and getattr(user, 'is_authenticated', False)
        and str(user.id) == str(event.host_id)
    )
    offered = [
        _hub_entry(p, user=user, guest=guest)
        for p in posts
        if reading_it and p.kind == HubPost.Kind.SUGGESTION
        and p.status != HubPost.Status.DECLINED
    ]

    def of(topic, also):
        return sorted(
            [r for r, m in zip(rendered, sorted_messages) if m.topic == topic]
            + also,
            key=lambda r: (-r['score'], str(r['created_at'])),
        )

    return {
        'faq': of(ChatMessage.Topic.FAQ, asked),
        'suggestions': of(ChatMessage.Topic.SUGGESTION, offered),
    }
