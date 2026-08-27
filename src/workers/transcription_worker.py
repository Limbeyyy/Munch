"""Transcription processing tasks"""
import logging
from celery import shared_task
from django.utils import timezone
from src.apps.transcription.models import TranscriptionSegment, Transcript
from src.apps.transcription.services.transcription_service import TranscriptionService
from src.apps.monitoring.models import ErrorLog, MeetingEvent

logger = logging.getLogger(__name__)


@shared_task
def append_transcript_segment(meeting_id, segment_data):
    """
    Handle real-time transcription segment
    Called whenever speech-to-text returns a segment
    """
    try:
        segment = TranscriptionService.add_transcription_segment(
            meeting_id=meeting_id,
            speaker_id=segment_data.get('speaker_id'),
            speaker_name=segment_data.get('speaker_name'),
            text=segment_data.get('text'),
            start_time=segment_data.get('start_time'),
            end_time=segment_data.get('end_time'),
            is_final=segment_data.get('is_final', False),
            confidence=segment_data.get('confidence', 0.0)
        )

        # Broadcast to WebSocket clients
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"meeting_{segment.meeting.meeting_code}",
            {
                'type': 'transcription_update',
                'segment': {
                    'speaker_name': segment.speaker_name,
                    'text': segment.text,
                    'is_final': segment.is_final,
                    'confidence': segment.confidence
                }
            }
        )

        logger.info(f"Appended transcript segment for meeting {meeting_id}")

        return {
            'meeting_id': str(meeting_id),
            'segment_id': str(segment.id),
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to append transcript segment: {str(e)}")
        ErrorLog.objects.create(
            meeting_id=meeting_id,
            error_type='speech',
            severity='error',
            error_message=str(e),
            context={'task': 'append_transcript_segment'}
        )


@shared_task(bind=True, max_retries=2)
def finalize_transcript(self, meeting_id):
    """
    Finalize transcript when meeting ends
    Merges all segments and saves to Drive
    """
    try:
        from src.apps.meetings.models import Meeting

        meeting = Meeting.objects.get(id=meeting_id)

        logger.info(f"Finalizing transcript for meeting {meeting_id}")

        transcript = TranscriptionService.finalize_transcript(meeting_id)

        # Save to Drive as Google Doc
        from src.apps.artifacts.services import ArtifactService
        artifact_service = ArtifactService(str(meeting.host.id))

        # The document should have been created in create_meeting_folder
        # Now we just need to update it with the final content

        logger.info(f"Finalized transcript with {transcript.word_count} words")

        # Log event
        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.TRANSCRIPTION_STARTED,
            description=f"Transcript finalized",
            user='system',
            data={'word_count': transcript.word_count}
        )

        return {
            'meeting_id': str(meeting_id),
            'word_count': transcript.word_count,
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to finalize transcript: {str(e)}")
        ErrorLog.objects.create(
            meeting_id=meeting_id,
            error_type='speech',
            severity='error',
            error_message=str(e),
            context={'task': 'finalize_transcript'}
        )
        self.retry(exc=e)
