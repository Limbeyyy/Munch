"""Meeting business logic service"""
import logging
import random
import string
from typing import Optional
from django.utils import timezone
from src.apps.meetings.models import Meeting, MeetingParticipant, MeetingInvite
from src.apps.monitoring.models import MeetingEvent, ErrorLog
from src.utilities.exceptions import MeetingException

logger = logging.getLogger(__name__)


class MeetingService:
    """Handles meeting lifecycle operations"""

    @staticmethod
    def generate_meeting_code(length: int = 7) -> str:
        """Generate unique meeting code like 'ABC-1234'"""
        chars = string.ascii_uppercase + string.digits
        parts = []
        for _ in range(2):
            parts.append(''.join(random.choices(chars, k=length // 2)))
        return '-'.join(parts)

    @staticmethod
    def create_meeting(host_id: str, title: str, scheduled_start, scheduled_end, **kwargs) -> Meeting:
        """Create a new meeting"""
        try:
            meeting_code = MeetingService.generate_meeting_code()

            meeting = Meeting.objects.create(
                host_id=host_id,
                meeting_code=meeting_code,
                title=title,
                scheduled_start=scheduled_start,
                scheduled_end=scheduled_end,
                **kwargs
            )

            # Auto-add host as a participant with host role
            from django.contrib.auth import get_user_model
            User = get_user_model()
            host = User.objects.get(id=host_id)
            MeetingParticipant.objects.create(
                meeting=meeting,
                user=host,
                role=MeetingParticipant.Role.HOST,
                is_active=True
            )

            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.MEETING_CREATED,
                description=f"Meeting created by {meeting.host.email}",
                user=str(host_id),
                data={'title': title}
            )

            logger.info(f"Created meeting {meeting.meeting_code}")
            return meeting

        except Exception as e:
            logger.error(f"Failed to create meeting: {str(e)}")
            raise

    @staticmethod
    def join_meeting(meeting, user, role: str = MeetingParticipant.Role.ATTENDEE) -> MeetingParticipant:
        """Add a user to a meeting, or reactivate them if they left earlier."""
        if meeting.status == Meeting.Status.ENDED:
            raise MeetingException("This meeting has already ended")

        MeetingService._mark_invite_accepted(meeting, user)

        existing = MeetingParticipant.objects.filter(meeting=meeting, user=user).first()

        # The host always keeps the host role, however they arrive, and
        # anyone the host named as a co-host arrives as one rather than as
        # an attendee somebody has to promote by hand.
        from src.apps.meetings.roles import claim_grants, participant_role_for

        claim_grants(user)
        assigned = participant_role_for(meeting, user)
        if assigned != MeetingParticipant.Role.ATTENDEE:
            role = assigned

        if existing:
            if not existing.is_active:
                existing.is_active = True
                existing.left_at = None
                existing.save(update_fields=['is_active', 'left_at'])
            return existing

        active_count = meeting.participants.filter(is_active=True).count()
        if active_count >= meeting.max_participants:
            raise MeetingException("This meeting is full")

        participant = MeetingParticipant.objects.create(
            meeting=meeting,
            user=user,
            role=role,
            is_active=True,
        )

        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.PARTICIPANT_JOINED,
            description=f"{user.email} joined the meeting",
            user=str(user.id),
            data={'role': role},
        )

        logger.info(f"{user.email} joined meeting {meeting.meeting_code}")
        return participant

    @staticmethod
    def _mark_invite_accepted(meeting, user):
        """Record that an invited address actually turned up."""
        from django.utils import timezone as tz

        MeetingInvite.objects.filter(
            meeting=meeting, email__iexact=user.email, joined_at__isnull=True
        ).update(joined_at=tz.now(), joined_user=user)

    @staticmethod
    def start_meeting(meeting_id: str) -> Meeting:
        """Start an active meeting"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)
            meeting.status = Meeting.Status.ACTIVE
            meeting.started_at = timezone.now()
            meeting.save()

            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.MEETING_STARTED,
                description=f"Meeting started at {meeting.started_at}",
                user='system'
            )

            logger.info(f"Started meeting {meeting.meeting_code}")
            return meeting

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            raise

    @staticmethod
    def end_meeting(meeting_id: str) -> Meeting:
        """End an active meeting"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)
            meeting.status = Meeting.Status.ENDED
            meeting.ended_at = timezone.now()
            meeting.save()

            # Mark all participants as inactive
            MeetingParticipant.objects.filter(meeting=meeting).update(
                is_active=False,
                left_at=timezone.now()
            )

            # Guests hold no participant row, so close their sessions too.
            from src.apps.meetings.models import GuestAttendee
            GuestAttendee.objects.filter(
                meeting=meeting, status=GuestAttendee.Status.ADMITTED
            ).update(status=GuestAttendee.Status.LEFT)

            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.MEETING_ENDED,
                description=f"Meeting ended at {meeting.ended_at}",
                user='system',
                data={
                    'duration_seconds': meeting.duration_seconds,
                    'participants_count': MeetingParticipant.objects.filter(meeting=meeting).count()
                }
            )

            logger.info(f"Ended meeting {meeting.meeting_code}")
            return meeting

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            raise

    @staticmethod
    def get_meeting_state(meeting_id: str):
        """Get complete meeting state"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)
            participants = MeetingParticipant.objects.filter(meeting=meeting, is_active=True)

            return {
                'meeting': {
                    'id': str(meeting.id),
                    'code': meeting.meeting_code,
                    'title': meeting.title,
                    'status': meeting.status,
                    'host': meeting.host.email,
                    'started_at': meeting.started_at.isoformat() if meeting.started_at else None,
                    'is_active': meeting.is_active
                },
                'participants': {
                    'count': participants.count(),
                    'list': [{
                        'id': str(p.user.id),
                        'name': p.user.display_name,
                        'role': p.role,
                        'is_muted': p.is_muted,
                        'is_video_on': p.is_video_on,
                        'is_screen_sharing': p.is_screen_sharing
                    } for p in participants]
                }
            }

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            raise
