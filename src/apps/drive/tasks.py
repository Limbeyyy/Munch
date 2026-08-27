"""
Celery tasks for Google Drive operations.
"""
import logging
from celery import shared_task
from django.core.exceptions import ObjectDoesNotExist
from django.conf import settings
from src.apps.meetings.models import Meeting
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.apps.artifacts.models import Artifact, ArtifactType
from src.utilities.exceptions import DriveException
from src.utilities.logger import get_logger

logger = get_logger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def create_meeting_folder(self, meeting_id, user_id):
    """
    Create meeting folder structure in Google Drive.
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Create main meeting folder
        folder_name = f"{meeting.meeting_code} - {meeting.title}"
        main_folder = drive_adapter.create_folder(folder_name)
        
        # Update meeting with folder ID
        meeting.drive_folder_id = main_folder['id']
        meeting.save()
        
        # Create subfolders
        subfolders = {
            'metadata': 'Meeting Metadata',
            'transcripts': 'Transcripts',
            'attendance': 'Attendance Records',
            'notes': 'Meeting Notes',
            'resources': 'Shared Resources',
            'recordings': 'Recordings'
        }
        
        folder_ids = {}
        for key, name in subfolders.items():
            folder = drive_adapter.create_folder(name, parent_id=main_folder['id'])
            folder_ids[key] = folder['id']
            Artifact.objects.create(
                meeting=meeting,
                artifact_type=ArtifactType.FOLDER,
                drive_folder_id=folder['id'],
                display_name=name,
                mime_type='application/vnd.google-apps.folder'
            )
        
        # Create initial metadata file and attendance sheet
        _create_metadata_file(drive_adapter, meeting, folder_ids['metadata'])
        _create_attendance_sheet(drive_adapter, meeting, folder_ids['attendance'])
        
        logger.info(f"Created Drive folder structure for meeting {meeting.meeting_code}")
        return {
            'meeting_id': str(meeting_id),
            'main_folder_id': main_folder['id'],
            'subfolders': folder_ids,
            'status': 'success'
        }
        
    except Meeting.DoesNotExist:
        logger.error(f"Meeting {meeting_id} not found")
        return {'error': 'Meeting not found'}
    except DriveException as e:
        logger.error(f"Drive error: {str(e)}")
        self.retry(exc=e)
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        self.retry(exc=e)

def _create_metadata_file(drive_adapter, meeting, folder_id):
    """Create metadata document for the meeting."""
    try:
        metadata_content = f"""Meeting Metadata
Meeting Code: {meeting.meeting_code}
Title: {meeting.title}
Host: {meeting.host.display_name}
Created: {meeting.created_at}
Scheduled: {meeting.scheduled_start} - {meeting.scheduled_end}
Status: {meeting.status}

Description:
{meeting.description}

Participants:
"""
        participants = meeting.participants.filter(is_active=True)
        for participant in participants:
            metadata_content += f"\n- {participant.user.display_name} ({participant.role})"
        
        file = drive_adapter.create_document(
            name=f"Metadata - {meeting.meeting_code}",
            content=metadata_content,
            parent_id=folder_id
        )
        meeting.drive_metadata_file_id = file['id']
        meeting.save(update_fields=['drive_metadata_file_id'])
        
        Artifact.objects.create(
            meeting=meeting,
            artifact_type=ArtifactType.METADATA,
            drive_file_id=file['id'],
            display_name="Meeting Metadata",
            mime_type="application/vnd.google-apps.document"
        )
    except Exception as e:
        logger.error(f"Failed to create metadata file: {str(e)}")

def _create_attendance_sheet(drive_adapter, meeting, folder_id):
    """Create attendance spreadsheet for the meeting."""
    try:
        headers = [
            ['Name', 'Email', 'Role', 'Join Time', 'Leave Time', 'Duration (min)']
        ]
        file = drive_adapter.create_sheet(
            name=f"Attendance - {meeting.meeting_code}",
            data=headers,
            parent_id=folder_id
        )
        Artifact.objects.create(
            meeting=meeting,
            artifact_type=ArtifactType.ATTENDANCE,
            drive_file_id=file['id'],
            display_name="Attendance Record",
            mime_type="application/vnd.google-apps.spreadsheet"
        )
    except Exception as e:
        logger.error(f"Failed to create attendance sheet: {str(e)}")


@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def sync_drive_files(self, meeting_id, user_id):
    """
    Sync Drive files with database artifacts.
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        files = drive_adapter.list_files(folder_id=meeting.drive_folder_id)
        created_count = 0
        updated_count = 0
        
        for file in files:
            artifact, created = Artifact.objects.update_or_create(
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
            if created:
                created_count += 1
            else:
                updated_count += 1
        
        logger.info(f"Synced {created_count} new, {updated_count} updated files for meeting {meeting.meeting_code}")
        return {'meeting_id': str(meeting_id), 'created': created_count, 'updated': updated_count}
        
    except Exception as e:
        logger.error(f"Sync failed: {str(e)}")
        self.retry(exc=e)


@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def clean_orphaned_drive_files(self, meeting_id, user_id):
    """
    Clean up orphaned Drive files not referenced in the database.
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        drive_adapter = GoogleDriveAdapter(user_id)
        
        # Get all drive file IDs from DB
        db_file_ids = set(Artifact.objects.filter(meeting=meeting).values_list('drive_file_id', flat=True))
        db_folder_ids = set(Artifact.objects.filter(meeting=meeting).values_list('drive_folder_id', flat=True))
        
        # Get all files in Drive folder
        drive_files = drive_adapter.list_files(folder_id=meeting.drive_folder_id)
        drive_file_ids = {f['id'] for f in drive_files}
        
        # Find orphans (in Drive but not in DB)
        orphan_ids = drive_file_ids - db_file_ids - db_folder_ids
        
        deleted_count = 0
        for file_id in orphan_ids:
            if drive_adapter.delete_file(file_id):
                deleted_count += 1
        
        logger.info(f"Cleaned {deleted_count} orphaned files for meeting {meeting.meeting_code}")
        return {'meeting_id': str(meeting_id), 'deleted': deleted_count}
        
    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")
        self.retry(exc=e)


@shared_task
def cleanup_old_meeting_folders(days=30):
    """
    Clean up old meeting folders and artifacts.
    """
    from django.utils import timezone
    cutoff = timezone.now() - timezone.timedelta(days=days)
    
    expired_meetings = Meeting.objects.filter(
        status=Meeting.Status.ENDED,
        ended_at__lt=cutoff
    )
    
    count = 0
    for meeting in expired_meetings:
        # This is just a placeholder; actual cleanup would require user_id
        # and might be better handled per user.
        logger.info(f"Cleanup expired meeting: {meeting.meeting_code}")
        count += 1
    
    return {'expired_meetings_processed': count}