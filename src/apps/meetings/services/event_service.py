"""Event business logic service"""
import logging
import random
import string
from typing import Optional
from django.utils import timezone
from src.apps.meetings.models import Event, EventParticipant, EventInvite
from src.apps.monitoring.models import EventLogEntry, ErrorLog
from src.utilities.exceptions import MeetingException

logger = logging.getLogger(__name__)


class EventService:
    """Handles event lifecycle operations"""

    @staticmethod
    def generate_code(length: int = 7) -> str:
        """Generate unique event code like 'ABC-1234'"""
        chars = string.ascii_uppercase + string.digits
        parts = []
        for _ in range(2):
            parts.append(''.join(random.choices(chars, k=length // 2)))
        return '-'.join(parts)

    @staticmethod
    def create_event(host_id: str, title: str, scheduled_start, scheduled_end, **kwargs) -> Event:
        """Create a new event"""
        try:
            code = EventService.generate_code()

            event = Event.objects.create(
                host_id=host_id,
                code=code,
                title=title,
                scheduled_start=scheduled_start,
                scheduled_end=scheduled_end,
                **kwargs
            )

            # Auto-add host as a participant with host role
            from django.contrib.auth import get_user_model
            User = get_user_model()
            host = User.objects.get(id=host_id)
            EventParticipant.objects.create(
                event=event,
                user=host,
                role=EventParticipant.Role.HOST,
                is_active=True
            )

            EventLogEntry.objects.create(
                event=event,
                event_type=EventLogEntry.EventType.EVENT_CREATED,
                description=f"Event created by {event.host.email}",
                user=str(host_id),
                data={'title': title}
            )

            logger.info(f"Created event {event.code}")
            return event

        except Exception as e:
            logger.error(f"Failed to create event: {str(e)}")
            raise

    @staticmethod
    def join_event(event, user, role: str = EventParticipant.Role.ATTENDEE) -> EventParticipant:
        """Add a user to a event, or reactivate them if they left earlier."""
        if event.status == Event.Status.ENDED:
            raise MeetingException("This event has already ended")

        EventService._mark_invite_accepted(event, user)

        existing = EventParticipant.objects.filter(event=event, user=user).first()

        # The host always keeps the host role, however they arrive, and
        # anyone the host named as a co-host arrives as one rather than as
        # an attendee somebody has to promote by hand.
        from src.apps.meetings.roles import claim_grants, participant_role_for

        claim_grants(user)
        assigned = participant_role_for(event, user)
        if assigned != EventParticipant.Role.ATTENDEE:
            role = assigned

        if existing:
            if not existing.is_active:
                existing.is_active = True
                existing.left_at = None
                existing.save(update_fields=['is_active', 'left_at'])
            return existing

        active_count = event.participants.filter(is_active=True).count()
        if active_count >= event.max_participants:
            raise MeetingException("This event is full")

        participant = EventParticipant.objects.create(
            event=event,
            user=user,
            role=role,
            is_active=True,
        )

        EventLogEntry.objects.create(
            event=event,
            event_type=EventLogEntry.EventType.PARTICIPANT_JOINED,
            description=f"{user.email} joined the event",
            user=str(user.id),
            data={'role': role},
        )

        logger.info(f"{user.email} joined event {event.code}")
        return participant

    @staticmethod
    def _mark_invite_accepted(event, user):
        """Record that an invited address actually turned up."""
        from django.utils import timezone as tz

        EventInvite.objects.filter(
            event=event, email__iexact=user.email, joined_at__isnull=True
        ).update(joined_at=tz.now(), joined_user=user)

    @staticmethod
    def start_event(event_id: str) -> Event:
        """Start an active event"""
        try:
            event = Event.objects.get(id=event_id)
            event.status = Event.Status.ACTIVE
            event.started_at = timezone.now()
            event.save()

            EventLogEntry.objects.create(
                event=event,
                event_type=EventLogEntry.EventType.EVENT_STARTED,
                description=f"Event started at {event.started_at}",
                user='system'
            )

            logger.info(f"Started event {event.code}")
            return event

        except Event.DoesNotExist:
            logger.error(f"Event {event_id} not found")
            raise

    @staticmethod
    def end_event(event_id: str) -> Event:
        """End an active event"""
        try:
            event = Event.objects.get(id=event_id)

            # Close whatever is on stage first, while the room still has
            # people in it. Attendance is a snapshot of who is present when
            # a session ends, so clearing the room before taking it records
            # nobody - which is how a session everybody sat through came
            # out empty when the host ended the event early.
            from src.apps.meetings.lifecycle import (
                clear_room, close_session, discard_unpublished,
            )
            from src.apps.meetings.models import Session

            for running in event.sessions.filter(status=Session.Status.LIVE):
                close_session(running, timezone.now())

            event.status = Event.Status.ENDED
            event.ended_at = timezone.now()
            event.save()

            # Now that the register is taken, empty the room. One definition
            # of that, shared with every other way a event can end.
            clear_room(event, event.ended_at)

            # And throw away whatever was never put on the board. What
            # survives an event is exactly what its board says.
            discard_unpublished(event)

            EventLogEntry.objects.create(
                event=event,
                event_type=EventLogEntry.EventType.EVENT_ENDED,
                description=f"Event ended at {event.ended_at}",
                user='system',
                data={
                    'duration_seconds': event.duration_seconds,
                    'participants_count': EventParticipant.objects.filter(event=event).count()
                }
            )

            logger.info(f"Ended event {event.code}")
            return event

        except Event.DoesNotExist:
            logger.error(f"Event {event_id} not found")
            raise

    @staticmethod
    def get_event_state(event_id: str):
        """Get complete event state"""
        try:
            event = Event.objects.get(id=event_id)
            participants = EventParticipant.objects.filter(event=event, is_active=True)

            return {
                'event': {
                    'id': str(event.id),
                    'code': event.code,
                    'title': event.title,
                    'status': event.status,
                    'host': event.host.email,
                    'started_at': event.started_at.isoformat() if event.started_at else None,
                    'is_active': event.is_active
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

        except Event.DoesNotExist:
            logger.error(f"Event {event_id} not found")
            raise
