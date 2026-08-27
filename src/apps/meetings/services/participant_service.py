"""Participant management service"""
import logging
from django.utils import timezone
from src.apps.meetings.models import Meeting, MeetingParticipant
from src.apps.monitoring.models import MeetingEvent

logger = logging.getLogger(__name__)


class ParticipantService:
    """Handles participant operations"""

    @staticmethod
    def add_participant(meeting_id: str, user_id: str, role: str = 'attendee') -> MeetingParticipant:
        """Add/join participant to meeting"""
        try:
            participant, created = MeetingParticipant.objects.get_or_create(
                meeting_id=meeting_id,
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

            MeetingEvent.objects.create(
                meeting_id=meeting_id,
                event_type=MeetingEvent.EventType.PARTICIPANT_JOINED,
                description=f"Participant {participant.user.email} joined",
                user=str(user_id),
                data={'role': role}
            )

            logger.info(f"Added participant {user_id} to meeting {meeting_id}")
            return participant

        except Exception as e:
            logger.error(f"Failed to add participant: {str(e)}")
            raise

    @staticmethod
    def remove_participant(meeting_id: str, user_id: str) -> bool:
        """Remove/leave participant from meeting"""
        try:
            participant = MeetingParticipant.objects.get(
                meeting_id=meeting_id,
                user_id=user_id
            )

            participant.is_active = False
            participant.left_at = timezone.now()
            participant.save()

            MeetingEvent.objects.create(
                meeting_id=meeting_id,
                event_type=MeetingEvent.EventType.PARTICIPANT_LEFT,
                description=f"Participant {participant.user.email} left",
                user=str(user_id),
                data={
                    'duration_seconds': (timezone.now() - participant.joined_at).total_seconds()
                }
            )

            logger.info(f"Removed participant {user_id} from meeting {meeting_id}")
            return True

        except MeetingParticipant.DoesNotExist:
            logger.warning(f"Participant {user_id} not found in meeting {meeting_id}")
            return False

    @staticmethod
    def update_participant_state(meeting_id: str, user_id: str, **updates) -> MeetingParticipant:
        """Update participant media state (mute, video, screen share)"""
        try:
            participant = MeetingParticipant.objects.get(
                meeting_id=meeting_id,
                user_id=user_id
            )

            for key, value in updates.items():
                if hasattr(participant, key):
                    setattr(participant, key, value)

            participant.save()

            logger.info(f"Updated participant {user_id} state: {updates}")
            return participant

        except MeetingParticipant.DoesNotExist:
            logger.error(f"Participant {user_id} not found in meeting {meeting_id}")
            raise

    @staticmethod
    def get_participants(meeting_id: str, only_active: bool = True):
        """Get participants for a meeting"""
        query = MeetingParticipant.objects.filter(meeting_id=meeting_id)
        if only_active:
            query = query.filter(is_active=True)

        return query
