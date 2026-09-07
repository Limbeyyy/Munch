"""The questions and suggestions a host has put up for the room.

Sorting a message here is a publishing decision rather than a label. The
board is read by everyone in the meeting, so a direct message put on it
stops being private - which is why only the host can do it.

One definition, read by the account-holder endpoint and the guest one, so
the two cannot drift into showing different things.
"""
from src.apps.meetings.models import ChatMessage

#: Messages that were never held, or that the host let through. Nothing
#: still pending or turned down can reach the board.
LET_THROUGH = [
    ChatMessage.Moderation.NOT_REQUIRED,
    ChatMessage.Moderation.APPROVED,
]


def _entry(message):
    return {
        'id': str(message.id),
        'body': message.body,
        'asked_by': message.sender_label,
        'asker_is_guest': message.guest_sender_id is not None,
        'was_direct': message.is_direct,
        # Who a question was put to, shown at the host's request: on a
        # board of questions it usually says which speaker is meant to
        # answer. It appears only for a message the host chose to publish.
        'sent_to': message.recipient_label if message.is_direct else None,
        'created_at': message.created_at,
    }


def board_for(meeting) -> dict:
    sorted_messages = (
        ChatMessage.objects.filter(meeting=meeting, moderation_status__in=LET_THROUGH)
        .exclude(topic=ChatMessage.Topic.NONE)
        .select_related('sender', 'guest_sender', 'recipient', 'guest_recipient')
        .order_by('created_at')
    )
    return {
        'faq': [_entry(m) for m in sorted_messages if m.topic == ChatMessage.Topic.FAQ],
        'suggestions': [
            _entry(m) for m in sorted_messages
            if m.topic == ChatMessage.Topic.SUGGESTION
        ],
    }
