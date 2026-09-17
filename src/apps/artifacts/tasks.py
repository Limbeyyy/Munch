from celery import shared_task
from django.core.cache import cache
from django.db import transaction
import logging
from src.apps.meetings.lifecycle import broadcast_event_ended
from src.apps.meetings.models import Event
from src.apps.artifacts.services.artifact_service import MeetingArtifactService
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter

logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_transcript_segment(self, event_id, user_id, content, segment_id=None):
    """
    Process and save a transcript segment
    """
    try:
        service = MeetingArtifactService(event_id, user_id)
        success = service.save_transcript(content, segment_id)
        
        if not success:
            raise Exception("Failed to save transcript")
        
        return {'event_id': event_id, 'segment_id': segment_id, 'status': 'success'}
        
    except Exception as e:
        logger.error(f"Failed to process transcript segment: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_event_note(self, event_id, user_id, content):
    """
    Process and save a event note
    """
    try:
        service = MeetingArtifactService(event_id, user_id)
        success = service.save_event_notes(content)
        
        if not success:
            raise Exception("Failed to save event note")
        
        return {'event_id': event_id, 'status': 'success'}
        
    except Exception as e:
        logger.error(f"Failed to process event note: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def export_event_artifacts(self, event_id, user_id, format='pdf'):
    """
    Export all event artifacts
    """
    try:
        service = MeetingArtifactService(event_id, user_id)
        result = service.export_event_data(format)
        
        return {
            'event_id': event_id,
            'format': format,
            'result': result
        }
        
    except Exception as e:
        logger.error(f"Failed to export event artifacts: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def sync_drive_files(self, event_id, user_id):
    """
    Synchronize Drive files with database records
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Get files from Drive folder
        files = drive_adapter.list_files(folder_id=event.drive_folder_id)
        
        with transaction.atomic():
            # Update or create artifact records
            from src.apps.artifacts.models import Artifact
            
            for file in files:
                Artifact.objects.update_or_create(
                    event=event,
                    drive_file_id=file['id'],
                    defaults={
                        'display_name': file.get('name', ''),
                        'mime_type': file.get('mimeType', ''),
                        'metadata': {
                            'modified_time': file.get('modifiedTime'),
                            'size': file.get('size'),
                            'web_view_link': file.get('webViewLink')
                        }
                    }
                )
        
        return {'event_id': event_id, 'synced_files': len(files)}
        
    except Exception as e:
        logger.error(f"Failed to sync Drive files: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=60)
def cleanup_event_resources(self, event_id):
    """
    Clean up event resources after event ends
    """
    try:
        event = Event.objects.get(id=event_id)
        
        # Archive or delete event resources
        # This could include moving files to archive folder, removing temporary data, etc.
        
        # Update event status if needed. Through the service, so the room
        # is emptied and told rather than left sitting in an ended event.
        if event.status == Event.Status.ACTIVE:
            from src.apps.meetings.services.event_service import EventService

            event = EventService.end_event(event.id)
            broadcast_event_ended(event, reason='time_elapsed')
        
        # Clear cache
        cache.delete_pattern(f'event_*_{event_id}')
        
        return {'event_id': event_id, 'status': 'cleaned_up'}
        
    except Exception as e:
        logger.error(f"Failed to cleanup event resources: {str(e)}")
        self.retry(exc=e)

@shared_task
def process_participant_attendance(event_id, user_id, action):
    """
    Process participant attendance events
    """
    try:
        event = Event.objects.get(id=event_id)
        service = MeetingArtifactService(event_id, user_id)
        
        if action == 'join':
            service.record_attendance({
                'name': user.display_name,
                'email': user.email,
                'role': 'attendee',
                'join_time': timezone.now().isoformat()
            })
        elif action == 'leave':
            # Update attendance record with leave time
            pass
        
        return {'event_id': event_id, 'user_id': user_id, 'action': action}
        
    except Exception as e:
        logger.error(f"Failed to process attendance: {str(e)}")