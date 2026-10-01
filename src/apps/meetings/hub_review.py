"""Putting what the room wrote in front of the host.

An attendee's question goes into HubPost. Every screen the host reviews
from read ChatMessage, and nothing read HubPost at all - so a question
asked from the app sat at `pending` for ever, invisible to the one
person who could let it through, and visible to nobody but its author
because only its author's own posts come back unpublished.

This is the join. The host's queues already speak one shape, so a hub
post is rendered in that shape rather than giving the screens a second
kind of thing to understand.

Suggestions come too. They need no approval to reach anybody - they are
addressed to the organizer and `hub.PUBLIC_KINDS` keeps them off the
board whatever their status - but the host still has to see them, which
was the other half of what was missing.
"""
from src.apps.meetings.models import HubPost

#: hub status -> the pile the host's screens sort it into.
PILE = {
    HubPost.Status.PENDING: 'pending',
    HubPost.Status.LOOKING: 'pending',
    HubPost.Status.PUBLISHED: 'approved',
    HubPost.Status.ADDRESSED: 'approved',
    HubPost.Status.DECLINED: 'rejected',
}

#: Which board the host's screens call each kind.
TOPIC = {
    HubPost.Kind.QUESTION: 'faq',
    HubPost.Kind.IDEA: 'faq',
    HubPost.Kind.SUGGESTION: 'suggestion',
}

DECISION = {
    'approve': {
        HubPost.Kind.SUGGESTION: HubPost.Status.ADDRESSED,
        None: HubPost.Status.PUBLISHED,
    },
    'decline': {None: HubPost.Status.DECLINED},
    'remove': {None: HubPost.Status.DECLINED},
}


def held_for(event):
    """Everything the room has written that the host has a say over."""
    return (
        HubPost.objects.filter(event=event)
        .select_related('session', 'user', 'guest')
        .order_by('-created_at')
    )


def as_message(post) -> dict:
    """One hub post in the shape the host's queues already read.

    Marked with `is_hub` so the screen knows which endpoint decides it,
    and so nothing mistakes it for a private message between two people.
    """
    return {
        'id': str(post.id),
        'body': post.body,
        'moderation_status': PILE.get(post.status, 'pending'),
        'created_at': post.created_at,
        'is_direct': False,
        'sender_id': str(post.user_id or post.guest_id or ''),
        'sender_name': post.author_label,
        'sender_email': None,
        'sender_is_guest': post.guest_id is not None,
        'recipient_id': None,
        'recipient_name': None,
        'recipient_is_guest': False,
        'topic': TOPIC.get(post.kind, 'none'),
        'session': str(post.session_id) if post.session_id else None,
        'session_title': post.session.title if post.session_id else None,
        'moderated_by_name': None,
        'moderated_at': None,
        #: What it was written as, and where the decision has to be sent.
        'kind': post.kind,
        'is_hub': True,
    }


def decide(post, decision) -> HubPost:
    """Let one through, or turn it down.

    A suggestion that is let through is marked addressed rather than
    published: publishing is for things the room reads, and a
    suggestion is not one of those whatever its status says.
    """
    wanted = DECISION[decision]
    post.status = wanted.get(post.kind, wanted[None])
    post.save(update_fields=['status'])
    return post
