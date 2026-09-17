"""Participant management service"""
import logging
from django.utils import timezone
from src.apps.meetings.models import Event, EventParticipant
from src.apps.monitoring.models import EventLogEntry

logger = logging.getLogger(__name__)


class ParticipantService:
    """Handles participant operations"""

    @staticmethod
    def add_participant(event_id: str, user_id: str, role: str = 'attendee') -> EventParticipant:
        """Add/join participant to event"""
        try:
            participant, created = EventParticipant.objects.get_or_create(
                event_id=event_id,
                user_id=user_id,
                defaults={
                    'role': role,
                    'is_active': True,
                    'session_id': f"{user_id}_{timezone.now().timestamp()}"
                }
            )

            if not created and not participant.is_active:
                participant.is_active = True
                participant.left_at = None
                participant.joined_at = timezone.now()
                participant.save()

            EventLogEntry.objects.create(
                event_id=event_id,
                event_type=EventLogEntry.EventType.PARTICIPANT_JOINED,
                description=f"Participant {participant.user.email} joined",
                user=str(user_id),
                data={'role': role}
            )

            logger.info(f"Added participant {user_id} to event {event_id}")
            return participant

        except Exception as e:
            logger.error(f"Failed to add participant: {str(e)}")
            raise

    @staticmethod
    def remove_participant(event_id: str, user_id: str) -> bool:
        """Remove/leave participant from event"""
        try:
            participant = EventParticipant.objects.get(
                event_id=event_id,
                user_id=user_id
            )

            participant.is_active = False
            participant.left_at = timezone.now()
            participant.save()

            EventLogEntry.objects.create(
                event_id=event_id,
                event_type=EventLogEntry.EventType.PARTICIPANT_LEFT,
                description=f"Participant {participant.user.email} left",
                user=str(user_id),
                data={
                    'duration_seconds': (timezone.now() - participant.joined_at).total_seconds()
                }
            )

            logger.info(f"Removed participant {user_id} from event {event_id}")
            return True

        except EventParticipant.DoesNotExist:
            logger.warning(f"Participant {user_id} not found in event {event_id}")
            return False

    @staticmethod
    def update_participant_state(event_id: str, user_id: str, **updates) -> EventParticipant:
        """Update participant media state (mute, video, screen share)"""
        try:
            participant = EventParticipant.objects.get(
                event_id=event_id,
                user_id=user_id
            )

            for key, value in updates.items():
                if hasattr(participant, key):
                    setattr(participant, key, value)

            participant.save()

            logger.info(f"Updated participant {user_id} state: {updates}")
            return participant

        except EventParticipant.DoesNotExist:
            logger.error(f"Participant {user_id} not found in event {event_id}")
            raise

    @staticmethod
    def get_participants(event_id: str, only_active: bool = True):
        """Get participants for a event"""
        query = EventParticipant.objects.filter(event_id=event_id)
        if only_active:
            query = query.filter(is_active=True)

        return query
