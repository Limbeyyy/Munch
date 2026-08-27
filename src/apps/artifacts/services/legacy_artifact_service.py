"""
Artifact service - abstracts storage operations for meeting artifacts
Separates business logic from Drive/S3 implementation details
"""
import logging
from typing import Optional, Dict, Any
from django.utils import timezone
from src.apps.artifacts.models import Artifact, ArtifactType
from src.apps.meetings.models import Meeting
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.apps.monitoring.models import ErrorLog
from src.utilities.exceptions import DriveException

logger = logging.getLogger(__name__)


class ArtifactService:
    """
    Manages meeting artifacts (transcripts, metadata, recordings, etc)
    Abstracts storage provider (Drive, S3, etc)
    """

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.drive = GoogleDriveAdapter(user_id)

    def create_meeting_folder_structure(self, meeting: Meeting) -> Dict[str, str]:
        """
        Create folder structure for meeting in Drive
        Returns: dict with folder IDs
        """
        try:
            folder_name = f"{meeting.meeting_code} - {meeting.title}"
            main_folder = self.drive.create_folder(folder_name)

            # Create subfolders
            subfolders = {
                'metadata': 'Metadata',
                'transcripts': 'Transcripts',
                'attendance': 'Attendance',
                'notes': 'Notes',
                'resources': 'Resources',
            }

            folder_ids = {'root': main_folder['id']}

            for key, name in subfolders.items():
                subfolder = self.drive.create_folder(
                    name,
                    parent_id=main_folder['id']
                )
                folder_ids[key] = subfolder['id']

                Artifact.objects.create(
                    meeting=meeting,
                    artifact_type=ArtifactType.FOLDER,
                    drive_folder_id=subfolder['id'],
                    display_name=name,
                    mime_type='application/vnd.google-apps.folder',
                    sync_status=Artifact.SyncStatus.SYNCED
                )

            # Update meeting with main folder ID
            meeting.drive_folder_id = main_folder['id']
            meeting.save()

            logger.info(f"Created Drive folder structure for {meeting.meeting_code}")
            return folder_ids

        except DriveException as e:
            logger.error(f"Failed to create folder structure: {str(e)}")
            self._log_error(meeting, 'drive', f"Failed to create folder structure: {str(e)}")
            raise

    def create_transcript_document(self, meeting: Meeting) -> str:
        """Create Google Doc for transcript"""
        try:
            doc_name = f"{meeting.meeting_code} - Transcript"

            # Get transcripts folder
            transcripts_folder = Artifact.objects.filter(
                meeting=meeting,
                artifact_type=ArtifactType.FOLDER,
                display_name='Transcripts'
            ).first()

            parent_id = transcripts_folder.drive_folder_id if transcripts_folder else None

            doc = self.drive.create_document(doc_name, parent_id=parent_id)

            # Create artifact record
            artifact = Artifact.objects.create(
                meeting=meeting,
                artifact_type=ArtifactType.TRANSCRIPT,
                drive_file_id=doc['id'],
                display_name=doc_name,
                mime_type='application/vnd.google-apps.document',
                web_view_link=doc.get('webViewLink'),
                sync_status=Artifact.SyncStatus.SYNCED
            )

            logger.info(f"Created transcript document for {meeting.meeting_code}")
            return doc['id']

        except DriveException as e:
            logger.error(f"Failed to create transcript document: {str(e)}")
            self._log_error(meeting, 'drive', f"Failed to create transcript: {str(e)}")
            raise

    def create_attendance_sheet(self, meeting: Meeting) -> str:
        """Create Google Sheet for attendance tracking"""
        try:
            sheet_name = f"{meeting.meeting_code} - Attendance"

            # Get attendance folder
            attendance_folder = Artifact.objects.filter(
                meeting=meeting,
                artifact_type=ArtifactType.FOLDER,
                display_name='Attendance'
            ).first()

            parent_id = attendance_folder.drive_folder_id if attendance_folder else None

            # Create sheet (Drive API doesn't have native sheet creation)
            # We'll use the document creation and mark it appropriately
            doc_name = sheet_name

            artifact = Artifact.objects.create(
                meeting=meeting,
                artifact_type=ArtifactType.ATTENDANCE,
                display_name=doc_name,
                sync_status=Artifact.SyncStatus.PENDING,
                metadata={'type': 'attendance_sheet'}
            )

            logger.info(f"Created attendance sheet for {meeting.meeting_code}")
            return str(artifact.id)

        except Exception as e:
            logger.error(f"Failed to create attendance sheet: {str(e)}")
            self._log_error(meeting, 'other', f"Failed to create attendance sheet: {str(e)}")
            raise

    def sync_artifact(self, artifact: Artifact) -> bool:
        """Sync artifact metadata from Drive"""
        try:
            if not artifact.drive_file_id:
                logger.warning(f"Artifact {artifact.id} has no drive_file_id")
                return False

            metadata = self.drive.get_file_metadata(artifact.drive_file_id)

            artifact.sync_status = Artifact.SyncStatus.SYNCED
            artifact.synced_at = timezone.now()
            artifact.file_size = metadata.get('size')
            artifact.web_view_link = metadata.get('webViewLink')
            artifact.last_error = ''
            artifact.save()

            logger.info(f"Synced artifact {artifact.id}")
            return True

        except DriveException as e:
            artifact.sync_status = Artifact.SyncStatus.FAILED
            artifact.last_error = str(e)
            artifact.retry_count += 1
            artifact.save()

            logger.error(f"Failed to sync artifact {artifact.id}: {str(e)}")
            return False

    def list_meeting_artifacts(self, meeting: Meeting) -> Dict[str, Any]:
        """List all artifacts for a meeting"""
        artifacts = Artifact.objects.filter(meeting=meeting)

        grouped = {}
        for artifact in artifacts:
            artifact_type = artifact.artifact_type
            if artifact_type not in grouped:
                grouped[artifact_type] = []

            grouped[artifact_type].append({
                'id': str(artifact.id),
                'name': artifact.display_name,
                'drive_file_id': artifact.drive_file_id,
                'web_link': artifact.web_view_link,
                'synced': artifact.is_synced(),
                'created_at': artifact.created_at.isoformat()
            })

        return grouped

    def _log_error(self, meeting: Meeting, error_type: str, message: str):
        """Log error to monitoring"""
        try:
            ErrorLog.objects.create(
                meeting=meeting,
                error_type=error_type,
                severity='error',
                error_message=message,
                context={'service': 'ArtifactService'}
            )
        except Exception as e:
            logger.error(f"Failed to log error: {str(e)}")
