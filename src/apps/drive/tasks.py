"""
Celery tasks for Google Drive operations.
"""
import logging
from celery import shared_task
from django.core.exceptions import ObjectDoesNotExist
from django.conf import settings
from src.apps.meetings.models import Event
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.apps.artifacts.models import Artifact, ArtifactType
from src.utilities.exceptions import DriveException
from src.utilities.logger import get_logger

logger = get_logger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def create_meeting_folder(self, event_id, user_id):
    """
    Create event folder structure in Google Drive.
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Create main event folder
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
        
        folder_ids = {}
        for key, name in subfolders.items():
            folder = drive_adapter.create_folder(name, parent_id=main_folder['id'])
            folder_ids[key] = folder['id']
            Artifact.objects.create(
                event=event,
                artifact_type=ArtifactType.FOLDER,
                drive_folder_id=folder['id'],
                display_name=name,
                mime_type='application/vnd.google-apps.folder'
            )
        
        # Create initial metadata file and attendance sheet
        _create_metadata_file(drive_adapter, event, folder_ids['metadata'])
        _create_attendance_sheet(drive_adapter, event, folder_ids['attendance'])
        
        logger.info(f"Created Drive folder structure for event {event.code}")
        return {
            'event_id': str(event_id),
            'main_folder_id': main_folder['id'],
            'subfolders': folder_ids,
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

def _create_metadata_file(drive_adapter, event, folder_id):
    """Create metadata document for the event."""
    try:
        metadata_content = f"""Event Metadata
Event Code: {event.code}
Title: {event.title}
Host: {event.host.display_name}
Created: {event.created_at}
Scheduled: {event.scheduled_start} - {event.scheduled_end}
Status: {event.status}

Description:
{event.description}

Participants:
"""
        participants = event.participants.filter(is_active=True)
        for participant in participants:
            metadata_content += f"\n- {participant.user.display_name} ({participant.role})"
        
        file = drive_adapter.create_document(
            name=f"Metadata - {event.code}",
            content=metadata_content,
            parent_id=folder_id
        )
        event.drive_metadata_file_id = file['id']
        event.save(update_fields=['drive_metadata_file_id'])
        
        Artifact.objects.create(
            event=event,
            artifact_type=ArtifactType.METADATA,
            drive_file_id=file['id'],
            display_name="Event Metadata",
            mime_type="application/vnd.google-apps.document"
        )
    except Exception as e:
        logger.error(f"Failed to create metadata file: {str(e)}")

def _create_attendance_sheet(drive_adapter, event, folder_id):
    """Create attendance spreadsheet for the event."""
    try:
        headers = [
            ['Name', 'Email', 'Role', 'Join Time', 'Leave Time', 'Duration (min)']
        ]
        file = drive_adapter.create_sheet(
            name=f"Attendance - {event.code}",
            data=headers,
            parent_id=folder_id
        )
        Artifact.objects.create(
            event=event,
            artifact_type=ArtifactType.ATTENDANCE,
            drive_file_id=file['id'],
            display_name="Attendance Record",
            mime_type="application/vnd.google-apps.spreadsheet"
        )
    except Exception as e:
        logger.error(f"Failed to create attendance sheet: {str(e)}")


@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def sync_drive_files(self, event_id, user_id):
    """
    Sync Drive files with database artifacts.
    """
    try:
        event = Event.objects.get(id=event_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        files = drive_adapter.list_files(folder_id=event.drive_folder_id)
        created_count = 0
        updated_count = 0
        
        for file in files:
            artifact, created = Artifact.objects.update_or_create(
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
            if created:
                created_count += 1
            else:
                updated_count += 1
        
        logger.info(f"Synced {created_count} new, {updated_count} updated files for event {event.code}")
        return {'event_id': str(event_id), 'created': created_count, 'updated': updated_count}
        
    except Exception as e:
        logger.error(f"Sync failed: {str(e)}")
        self.retry(exc=e)


@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def clean_orphaned_drive_files(self, event_id, user_id):
    """
    Clean up orphaned Drive files not referenced in the database.
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
        
        deleted_count = 0
        for file_id in orphan_ids:
            if drive_adapter.delete_file(file_id):
                deleted_count += 1
        
        logger.info(f"Cleaned {deleted_count} orphaned files for event {event.code}")
        return {'event_id': str(event_id), 'deleted': deleted_count}
        
    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")
        self.retry(exc=e)


@shared_task
def cleanup_old_meeting_folders(days=30):
    """
    Clean up old event folders and artifacts.
    """
    from django.utils import timezone
    cutoff = timezone.now() - timezone.timedelta(days=days)
    
    expired_meetings = Event.objects.filter(
        status=Event.Status.ENDED,
        ended_at__lt=cutoff
    )
    
    count = 0
    for event in expired_meetings:
        # This is just a placeholder; actual cleanup would require user_id
        # and might be better handled per user.
        logger.info(f"Cleanup expired event: {event.code}")
        count += 1
    
    return {'expired_meetings_processed': count}