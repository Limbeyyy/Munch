"""
Drive worker - handles Google Drive operations in background
"""
import logging
from celery import shared_task
from django.core.exceptions import ObjectDoesNotExist
from src.apps.meetings.models import Event
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.apps.artifacts.models import Artifact, ArtifactType
from src.utilities.exceptions import DriveException
from src.utilities.logger import get_logger

logger = get_logger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def create_meeting_folder(self, event_id, user_id):
    """
    Create event folder structure in Drive
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Create main folder
        folder_name = f"{event.code} - {event.title}"
        main_folder = drive_adapter.create_folder(folder_name)
        
        # Update event with folder ID
        event.drive_folder_id = main_folder['id']
        event.save()
        
        # Create subfolders
        subfolders = {
            'metadata': 'Event Metadata',
            'transcripts': 'Transcripts',
            'attendance': 'Attendance Records',
            'notes': 'Event Notes',
            'resources': 'Shared Resources',
            'recordings': 'Recordings'
        }
        
        for key, name in subfolders.items():
            folder = drive_adapter.create_folder(name, parent_id=main_folder['id'])
            Artifact.objects.create(
                event=event,
                artifact_type=ArtifactType.FOLDER,
                drive_folder_id=folder['id'],
                display_name=name,
                mime_type='application/vnd.google-apps.folder'
            )
        
        logger.info(f"Created Drive folder structure for event {event.code}")
        return {
            'event_id': str(event_id),
            'main_folder_id': main_folder['id'],
            'status': 'success'
        }
        
    except Event.DoesNotExist:
        logger.error(f"Event {event_id} not found")
        return {'error': 'Event not found'}
    except DriveException as e:
        logger.error(f"Drive error: {str(e)}")
        self.retry(exc=e)
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def sync_drive_files(self, event_id, user_id):
    """
    Sync Drive files with database artifacts
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Get files from Drive folder
        files = drive_adapter.list_files(folder_id=event.drive_folder_id)
        
        for file in files:
            # Try to find existing artifact, update or create
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
        
        logger.info(f"Synced {len(files)} files for event {event.code}")
        return {'event_id': str(event_id), 'synced': len(files)}
        
    except Exception as e:
        logger.error(f"Sync failed: {str(e)}")
        self.retry(exc=e)

@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def clean_orphaned_drive_files(self, event_id, user_id):
    """
    Clean up orphaned Drive files not referenced in DB
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Get all drive file IDs from DB
        db_file_ids = set(Artifact.objects.filter(event=event).values_list('drive_file_id', flat=True))
        db_folder_ids = set(Artifact.objects.filter(event=event).values_list('drive_folder_id', flat=True))
        
        # Get all files in Drive folder
        drive_files = drive_adapter.list_files(folder_id=event.drive_folder_id)
        drive_file_ids = {f['id'] for f in drive_files}
        
        # Find orphans (in Drive but not in DB)
        orphan_ids = drive_file_ids - db_file_ids - db_folder_ids
        
        for file_id in orphan_ids:
            drive_adapter.delete_file(file_id)
            
        logger.info(f"Cleaned {len(orphan_ids)} orphaned files for event {event.code}")
        return {'event_id': str(event_id), 'deleted': len(orphan_ids)}
        
    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")
        self.retry(exc=e)