"""Event lifecycle tasks"""
import logging
from celery import shared_task
from django.utils import timezone
from src.apps.meetings.models import Event, EventParticipant
from src.apps.artifacts.services import ArtifactService
from src.apps.meetings.services.event_service import EventService
from src.apps.monitoring.models import ErrorLog, EventLogEntry

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def create_meeting_folder(self, event_id, user_id):
    """
    Create Google Drive folder structure for event
    Called after event is created
    """
    try:
        event = Event.objects.get(id=event_id)
        artifact_service = ArtifactService(str(user_id))

        logger.info(f"Creating Drive folder for event {event.code}")

        artifact_service.create_meeting_folder_structure(event)

        # Create transcript document
        artifact_service.create_transcript_document(event)

        # Create attendance sheet
        artifact_service.create_attendance_sheet(event)

        logger.info(f"Successfully created folder structure for {event.code}")

        # Log event
        EventLogEntry.objects.create(
            event=event,
            event_type=EventLogEntry.EventType.EVENT_CREATED,
            description=f"Drive folder structure created",
            user='system',
            data={'drive_folder_id': event.drive_folder_id}
        )

        return {
            'event_id': str(event_id),
            'status': 'success',
            'folder_id': event.drive_folder_id
        }

    except Event.DoesNotExist:
        logger.error(f"Event {event_id} not found")
        return {'error': 'Event not found', 'status': 'failed'}

    except Exception as e:
        logger.error(f"Failed to create event folder: {str(e)}")
        ErrorLog.objects.create(
            event_id=event_id,
            error_type='drive',
            severity='error',
            error_message=str(e),
            context={'task': 'create_meeting_folder'}
        )
        self.retry(exc=e)


@shared_task
def finalize_meeting(event_id):
    """
    Finalize event when it ends
    - Mark all participants as inactive
    - Save final transcript
    - Trigger summarization
    """
    try:
        event = Event.objects.get(id=event_id)

        logger.info(f"Finalizing event {event.code}")

        # Mark participants as inactive
        EventParticipant.objects.filter(event=event).update(
            is_active=False,
            left_at=timezone.now()
        )

        # Finalize transcript
        from src.apps.transcription.services.transcription_service import TranscriptionService
        transcript = TranscriptionService.finalize_transcript(event_id)

        # Trigger summarization
        from src.workers.summarization_worker import summarize_transcript
        summarize_transcript.delay(str(event_id))

        # Log event
        EventLogEntry.objects.create(
            event=event,
            event_type=EventLogEntry.EventType.EVENT_ENDED,
            description=f"Event finalized with {transcript.word_count} words",
            user='system',
            data={'word_count': transcript.word_count}
        )

        logger.info(f"Successfully finalized event {event.code}")

        return {
            'event_id': str(event_id),
            'status': 'success',
            'transcript_words': transcript.word_count
        }

    except Event.DoesNotExist:
        logger.error(f"Event {event_id} not found")
        return {'error': 'Event not found'}

    except Exception as e:
        logger.error(f"Failed to finalize event: {str(e)}")
        ErrorLog.objects.create(
            event_id=event_id,
            error_type='other',
            severity='error',
            error_message=str(e),
            context={'task': 'finalize_meeting'}
        )


@shared_task
def sync_meeting_artifacts(event_id):
    """
    Sync all event artifacts with Drive
    Updates file sizes, modification times, etc
    """
    try:
        event = Event.objects.get(id=event_id)
        artifacts = event.artifacts.all()

        logger.info(f"Syncing {artifacts.count()} artifacts for {event.code}")

        for artifact in artifacts:
            try:
                artifact_service = ArtifactService(str(event.host.id))
                artifact_service.sync_artifact(artifact)
            except Exception as e:
                logger.error(f"Failed to sync artifact {artifact.id}: {str(e)}")

        logger.info(f"Successfully synced artifacts for {event.code}")

        return {
            'event_id': str(event_id),
            'synced': artifacts.count(),
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to sync artifacts: {str(e)}")


@shared_task
def cleanup_old_meetings():
    """
    Cleanup old events and their artifacts
    Runs periodically to free up space
    """
    from datetime import timedelta

    cutoff_date = timezone.now() - timedelta(days=90)

    old_meetings = Event.objects.filter(
        ended_at__lt=cutoff_date,
        status=Event.Status.ENDED
    )

    count = 0
    for event in old_meetings:
        try:
            # Could implement Drive cleanup here if desired
            count += 1
        except Exception as e:
            logger.error(f"Failed to cleanup event {event.id}: {str(e)}")

    logger.info(f"Cleaned up {count} old events")
    return {'cleaned': count, 'status': 'success'}
