"""Transcription processing tasks"""
import logging
from celery import shared_task
from django.utils import timezone
from src.apps.transcription.models import TranscriptionSegment, Transcript
from src.apps.transcription.services.transcription_service import TranscriptionService
from src.apps.monitoring.models import ErrorLog, EventLogEntry

logger = logging.getLogger(__name__)


@shared_task
def append_transcript_segment(event_id, segment_data):
    """
    Handle real-time transcription segment
    Called whenever speech-to-text returns a segment
    """
    try:
        segment = TranscriptionService.add_transcription_segment(
            event_id=event_id,
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
            f"event_{segment.event.code}",
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

        logger.info(f"Appended transcript segment for event {event_id}")

        return {
            'event_id': str(event_id),
            'segment_id': str(segment.id),
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to append transcript segment: {str(e)}")
        ErrorLog.objects.create(
            event_id=event_id,
            error_type='speech',
            severity='error',
            error_message=str(e),
            context={'task': 'append_transcript_segment'}
        )


@shared_task(bind=True, max_retries=2)
def finalize_transcript(self, event_id):
    """
    Finalize transcript when event ends
    Merges all segments and saves to Drive
    """
    try:
        from src.apps.meetings.models import Event

        event = Event.objects.get(id=event_id)

        logger.info(f"Finalizing transcript for event {event_id}")

        transcript = TranscriptionService.finalize_transcript(event_id)

        # Save to Drive as Google Doc
        from src.apps.artifacts.services import ArtifactService
        artifact_service = ArtifactService(str(event.host.id))

        # The document should have been created in create_meeting_folder
        # Now we just need to update it with the final content

        logger.info(f"Finalized transcript with {transcript.word_count} words")

        # Log event
        EventLogEntry.objects.create(
            event=event,
            event_type=EventLogEntry.EventType.TRANSCRIPTION_STARTED,
            description=f"Transcript finalized",
            user='system',
            data={'word_count': transcript.word_count}
        )

        return {
            'event_id': str(event_id),
            'word_count': transcript.word_count,
            'status': 'success'
        }

    except Exception as e:
        logger.error(f"Failed to finalize transcript: {str(e)}")
        ErrorLog.objects.create(
            event_id=event_id,
            error_type='speech',
            severity='error',
            error_message=str(e),
            context={'task': 'finalize_transcript'}
        )
        self.retry(exc=e)
