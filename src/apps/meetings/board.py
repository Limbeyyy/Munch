"""The questions and suggestions a host has put up for the room.

Sorting a message here is a publishing decision rather than a label. The
board is read by everyone in the meeting, so a direct message put on it
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
        'asked_by': message.sender_label,
        'asker_is_guest': message.guest_sender_id is not None,
        'was_direct': message.is_direct,
        # A question without its answer is half an exchange.
        'answer': message.answer,
        'answered_by': _answerer(message),
        'answered_at': message.answered_at,
        # The room's own sense of what most wants answering.
        'score': score_of(message),
        'my_vote': vote_of(message, user=user, guest=guest),
        # Who a question was put to, shown at the host's request: on a
        # board of questions it usually says which speaker is meant to
        # answer. It appears only for a message the host chose to publish.
        'sent_to': message.recipient_label if message.is_direct else None,
        'created_at': message.created_at,
    }


def board_for(meeting, *, user=None, guest=None) -> dict:
    """The board, highest-voted first.

    The room decides what most wants answering, so what the host sees at
    the top is what people actually care about.
    """
    sorted_messages = (
        ChatMessage.objects.filter(meeting=meeting, moderation_status__in=LET_THROUGH)
        .exclude(topic=ChatMessage.Topic.NONE)
        .select_related('sender', 'guest_sender', 'recipient', 'guest_recipient',
                        'answered_by')
        .prefetch_related('votes')
        .order_by('created_at')
    )
    rendered = [_entry(m, user=user, guest=guest) for m in sorted_messages]

    def of(topic):
        return sorted(
            (r for r, m in zip(rendered, sorted_messages) if m.topic == topic),
            key=lambda r: (-r['score'], r['created_at']),
        )

    return {
        'faq': of(ChatMessage.Topic.FAQ),
        'suggestions': of(ChatMessage.Topic.SUGGESTION),
    }
