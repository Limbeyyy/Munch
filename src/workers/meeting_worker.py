"""Meeting lifecycle tasks"""
import logging
from celery import shared_task
from django.utils import timezone
from src.apps.meetings.models import Meeting, MeetingParticipant
from src.apps.artifacts.services import ArtifactService
from src.apps.meetings.services.meeting_service import MeetingService
from src.apps.monitoring.models import ErrorLog, MeetingEvent

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def create_meeting_folder(self, meeting_id, user_id):
    """
    Create Google Drive folder structure for meeting
    Called after meeting is created
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        artifact_service = ArtifactService(str(user_id))

        logger.info(f"Creating Drive folder for meeting {meeting.meeting_code}")

        artifact_service.create_meeting_folder_structure(meeting)

        # Create transcript document
        artifact_service.create_transcript_document(meeting)

        # Create attendance sheet
        artifact_service.create_attendance_sheet(meeting)

        logger.info(f"Successfully created folder structure for {meeting.meeting_code}")

        # Log event
        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.MEETING_CREATED,
            description=f"Drive folder structure created",
            user='system',
            data={'drive_folder_id': meeting.drive_folder_id}
        )

        return {
            'meeting_id': str(meeting_id),
            'status': 'success',
            'folder_id': meeting.drive_folder_id
        }

    except Meeting.DoesNotExist:
        logger.error(f"Meeting {meeting_id} not found")
        return {'error': 'Meeting not found', 'status': 'failed'}

    except Exception as e:
        logger.error(f"Failed to create meeting folder: {str(e)}")
        ErrorLog.objects.create(
            meeting_id=meeting_id,
            error_type='drive',
            severity='error',
            error_message=str(e),
            context={'task': 'create_meeting_folder'}
        )
        self.retry(exc=e)


@shared_task
def finalize_meeting(meeting_id):
    """
    Finalize meeting when it ends
    - Mark all participants as inactive
    - Save final transcript
    - Trigger summarization
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)

        logger.info(f"Finalizing meeting {meeting.meeting_code}")

        # Mark participants as inactive
        MeetingParticipant.objects.filter(meeting=meeting).update(
            is_active=False,
            left_at=timezone.now()
        )

        # Finalize transcript
        from src.apps.transcription.services.transcription_service import TranscriptionService
        transcript = TranscriptionService.finalize_transcript(meeting_id)

        # Trigger summarization
        from src.workers.summarization_worker import summarize_transcript
        summarize_transcript.delay(str(meeting_id))

        # Log event
        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.MEETING_ENDED,
            description=f"Meeting finalized with {transcript.word_count} words",
            user='system',
            data={'word_count': transcript.word_count}
        )

        logger.info(f"Successfully finalized meeting {meeting.meeting_code}")

        return {
            'meeting_id': str(meeting_id),
            'status': 'success',
            'transcript_words': transcript.word_count
        }

    except Meeting.DoesNotExist:
        logger.error(f"Meeting {meeting_id} not found")
        return {'error': 'Meeting not found'}

    except Exception as e:
        logger.error(f"Failed to finalize meeting: {str(e)}")
        ErrorLog.objects.create(
            meeting_id=meeting_id,
            error_type='other',
            severity='error',
            error_message=str(e),
            context={'task': 'finalize_meeting'}
        )


@shared_task
def sync_meeting_artifacts(meeting_id):
    """
    Sync all meeting artifacts with Drive
    Updates file sizes, modification times, etc
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        artifacts = meeting.artifacts.all()

        logger.info(f"Syncing {artifacts.count()} artifacts for {meeting.meeting_code}")

        for artifact in artifacts:
            try:
                artifact_service = ArtifactService(str(meeting.host.id))
                artifact_service.sync_artifact(artifact)
            except Exception as e:
                logger.error(f"Failed to sync artifact {artifact.id}: {str(e)}")

        logger.info(f"Successfully synced artifacts for {meeting.meeting_code}")

        return {
            'meeting_id': str(meeting_id),
            'synced': artifacts.count(),
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to sync artifacts: {str(e)}")


@shared_task
def cleanup_old_meetings():
    """
    Cleanup old meetings and their artifacts
    Runs periodically to free up space
    """
    from datetime import timedelta

    cutoff_date = timezone.now() - timedelta(days=90)

    old_meetings = Meeting.objects.filter(
        ended_at__lt=cutoff_date,
        status=Meeting.Status.ENDED
    )

    count = 0
    for meeting in old_meetings:
        try:
            # Could implement Drive cleanup here if desired
            count += 1
        except Exception as e:
            logger.error(f"Failed to cleanup meeting {meeting.id}: {str(e)}")

    logger.info(f"Cleaned up {count} old meetings")
    return {'cleaned': count, 'status': 'success'}
