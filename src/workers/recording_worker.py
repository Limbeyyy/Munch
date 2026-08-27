"""
Recording worker - handles meeting recording operations
"""
import logging
from celery import shared_task
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from src.apps.meetings.models import Meeting
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.utilities.logger import get_logger
import os

logger = get_logger(__name__)

@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def upload_recording(self, meeting_id, user_id, recording_path, filename):
    """
    Upload a recording file to Drive
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Read file
        with open(recording_path, 'rb') as f:
            file_content = f.read()
        
        # Upload to Drive
        drive_file = drive_adapter.upload_file(
            file_content=file_content,
            filename=filename,
            mime_type='video/mp4',
            parent_id=meeting.drive_folder_id
        )
        
        # Create artifact record
        artifact = Artifact.objects.create(
            meeting=meeting,
            artifact_type=ArtifactType.RECORDING,
            drive_file_id=drive_file['id'],
            display_name=filename,
            mime_type='video/mp4',
            metadata={'size': drive_file.get('size')}
        )
        
        # Optionally delete local file after upload
        try:
            os.remove(recording_path)
        except OSError:
            pass
        
        logger.info(f"Uploaded recording {filename} for meeting {meeting.meeting_code}")
        return {
            'meeting_id': str(meeting_id),
            'artifact_id': str(artifact.id),
            'drive_file_id': drive_file['id'],
            'status': 'success'
        }
        
    except Exception as e:
        logger.error(f"Recording upload failed: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def start_recording(self, meeting_id, user_id):
    """
    Signal to start recording (e.g., notify clients, set flags)
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        # Update meeting metadata
        meeting.meeting_metadata['recording_started'] = timezone.now().isoformat()
        meeting.save()
        
        logger.info(f"Started recording for meeting {meeting.meeting_code}")
        return {'meeting_id': str(meeting_id), 'status': 'recording_started'}
        
    except Exception as e:
        logger.error(f"Start recording failed: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def stop_recording(self, meeting_id, user_id):
    """
    Signal to stop recording and finalize file
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        meeting.meeting_metadata['recording_ended'] = timezone.now().isoformat()
        meeting.save()
        
        # Trigger finalization via another task or integrate with media server
        logger.info(f"Stopped recording for meeting {meeting.meeting_code}")
        return {'meeting_id': str(meeting_id), 'status': 'recording_stopped'}
        
    except Exception as e:
        logger.error(f"Stop recording failed: {str(e)}")
        self.retry(exc=e)

@shared_task
def cleanup_old_recordings(days=30):
    """
    Clean up old recordings (e.g., move to archive or delete)
    """
    from django.utils import timezone
    cutoff = timezone.now() - timedelta(days=days)
    
    old_recordings = Artifact.objects.filter(
        artifact_type=ArtifactType.RECORDING,
        created_at__lt=cutoff
    )
    
    deleted_count = 0
    for recording in old_recordings:
        # Optionally delete from Drive
        # (Requires user_id from meeting host)
        try:
            meeting = recording.meeting
            drive_adapter = GoogleDriveAdapter(meeting.host_id)
            drive_adapter.delete_file(recording.drive_file_id)
            recording.delete()
            deleted_count += 1
        except Exception as e:
            logger.error(f"Failed to delete recording {recording.id}: {str(e)}")
    
    return {'deleted': deleted_count}