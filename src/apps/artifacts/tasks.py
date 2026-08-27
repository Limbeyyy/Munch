from celery import shared_task
from django.core.cache import cache
from django.db import transaction
import logging
from src.apps.meetings.models import Meeting
from src.apps.artifacts.services.artifact_service import MeetingArtifactService
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter

logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_transcript_segment(self, meeting_id, user_id, content, segment_id=None):
    """
    Process and save a transcript segment
    """
    try:
        service = MeetingArtifactService(meeting_id, user_id)
        success = service.save_transcript(content, segment_id)
        
        if not success:
            raise Exception("Failed to save transcript")
        
        return {'meeting_id': meeting_id, 'segment_id': segment_id, 'status': 'success'}
        
    except Exception as e:
        logger.error(f"Failed to process transcript segment: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_meeting_note(self, meeting_id, user_id, content):
    """
    Process and save a meeting note
    """
    try:
        service = MeetingArtifactService(meeting_id, user_id)
        success = service.save_meeting_notes(content)
        
        if not success:
            raise Exception("Failed to save meeting note")
        
        return {'meeting_id': meeting_id, 'status': 'success'}
        
    except Exception as e:
        logger.error(f"Failed to process meeting note: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def export_meeting_artifacts(self, meeting_id, user_id, format='pdf'):
    """
    Export all meeting artifacts
    """
    try:
        service = MeetingArtifactService(meeting_id, user_id)
        result = service.export_meeting_data(format)
        
        return {
            'meeting_id': meeting_id,
            'format': format,
            'result': result
        }
        
    except Exception as e:
        logger.error(f"Failed to export meeting artifacts: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def sync_drive_files(self, meeting_id, user_id):
    """
    Synchronize Drive files with database records
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Get files from Drive folder
        files = drive_adapter.list_files(folder_id=meeting.drive_folder_id)
        
        with transaction.atomic():
            # Update or create artifact records
            from src.apps.artifacts.models import Artifact
            
            for file in files:
                Artifact.objects.update_or_create(
                    meeting=meeting,
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
        
        return {'meeting_id': meeting_id, 'synced_files': len(files)}
        
    except Exception as e:
        logger.error(f"Failed to sync Drive files: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=60)
def cleanup_meeting_resources(self, meeting_id):
    """
    Clean up meeting resources after meeting ends
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        
        # Archive or delete meeting resources
        # This could include moving files to archive folder, removing temporary data, etc.
        
        # Update meeting status if needed
        if meeting.status == Meeting.Status.ACTIVE:
            meeting.status = Meeting.Status.ENDED
            meeting.ended_at = timezone.now()
            meeting.save()
        
        # Clear cache
        cache.delete_pattern(f'meeting_*_{meeting_id}')
        
        return {'meeting_id': meeting_id, 'status': 'cleaned_up'}
        
    except Exception as e:
        logger.error(f"Failed to cleanup meeting resources: {str(e)}")
        self.retry(exc=e)

@shared_task
def process_participant_attendance(meeting_id, user_id, action):
    """
    Process participant attendance events
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        service = MeetingArtifactService(meeting_id, user_id)
        
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
        
        return {'meeting_id': meeting_id, 'user_id': user_id, 'action': action}
        
    except Exception as e:
        logger.error(f"Failed to process attendance: {str(e)}")