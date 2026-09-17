"""
Recording worker - handles event recording operations
"""
import logging
from celery import shared_task
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from src.apps.meetings.models import Event
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.utilities.logger import get_logger
import os

logger = get_logger(__name__)

@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def upload_recording(self, event_id, user_id, recording_path, filename):
    """
    Upload a recording file to Drive
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Read file
        with open(recording_path, 'rb') as f:
            file_content = f.read()
        
        # Upload to Drive
        drive_file = drive_adapter.upload_file(
            file_content=file_content,
            filename=filename,
            mime_type='video/mp4',
            parent_id=event.drive_folder_id
        )
        
        # Create artifact record
        artifact = Artifact.objects.create(
            event=event,
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
        
        logger.info(f"Uploaded recording {filename} for event {event.code}")
        return {
            'event_id': str(event_id),
            'artifact_id': str(artifact.id),
            'drive_file_id': drive_file['id'],
            'status': 'success'
        }
        
    except Exception as e:
        logger.error(f"Recording upload failed: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def start_recording(self, event_id, user_id):
    """
    Signal to start recording (e.g., notify clients, set flags)
    """
    try:
        event = Event.objects.get(id=event_id)
        # Update event metadata
        event.event_metadata['recording_started'] = timezone.now().isoformat()
        event.save()
        
        logger.info(f"Started recording for event {event.code}")
        return {'event_id': str(event_id), 'status': 'recording_started'}
        
    except Exception as e:
        logger.error(f"Start recording failed: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def stop_recording(self, event_id, user_id):
    """
    Signal to stop recording and finalize file
    """
    try:
        event = Event.objects.get(id=event_id)
        event.event_metadata['recording_ended'] = timezone.now().isoformat()
        event.save()
        
        # Trigger finalization via another task or integrate with media server
        logger.info(f"Stopped recording for event {event.code}")
        return {'event_id': str(event_id), 'status': 'recording_stopped'}
        
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
        # (Requires user_id from event host)
        try:
            event = recording.event
            drive_adapter = GoogleDriveAdapter(event.host_id)
            drive_adapter.delete_file(recording.drive_file_id)
            recording.delete()
            deleted_count += 1
        except Exception as e:
            logger.error(f"Failed to delete recording {recording.id}: {str(e)}")
    
    return {'deleted': deleted_count}