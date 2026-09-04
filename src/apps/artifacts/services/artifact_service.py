import logging
from typing import Dict, Any, Optional, List
from django.utils import timezone
from src.apps.meetings.models import Meeting
from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter
from src.apps.artifacts.models import Artifact, ArtifactType
from src.utilities.exceptions import ArtifactException
from django.conf import settings

logger = logging.getLogger(__name__)

class MeetingArtifactService:
    """
    Service for managing meeting artifacts in Google Drive
    """
    
    def __init__(self, meeting_id: str, user_id: str):
        self.meeting = Meeting.objects.get(id=meeting_id)
        self.user_id = user_id
        self.drive_adapter = GoogleDriveAdapter(user_id)
        
    def initialize_meeting_folder(self) -> Dict[str, Any]:
        """
        Create the meeting folder structure in Drive
        """
        try:
            # Create main meeting folder
            folder_name = f"{self.meeting.meeting_code} - {self.meeting.title}"
            main_folder = self.drive_adapter.create_folder(
                folder_name=folder_name
            )
            
            # Update meeting with folder ID
            self.meeting.drive_folder_id = main_folder['id']
            self.meeting.save()
            
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
                folder = self.drive_adapter.create_folder(
                    folder_name=name,
                    parent_id=main_folder['id']
                )
                folder_ids[key] = folder['id']
            
            # Create initial artifacts
            self._create_metadata_file(folder_ids['metadata'])
            self._create_attendance_sheet(folder_ids['attendance'])
            
            # Store folder IDs in artifacts table
            self._store_folder_ids(folder_ids)
            
            return {
                'main_folder_id': main_folder['id'],
                'subfolders': folder_ids,
                'web_view_link': main_folder.get('webViewLink')
            }
            
        except Exception as e:
            logger.error(f"Failed to initialize meeting folder: {str(e)}")
            raise ArtifactException(f"Folder initialization failed: {str(e)}")
    
    def _create_metadata_file(self, folder_id: str) -> None:
        """Create the metadata file for the meeting"""
        try:
            metadata_content = f"""Meeting Metadata
Meeting Code: {self.meeting.meeting_code}
Title: {self.meeting.title}
Host: {self.meeting.host.display_name}
Created: {self.meeting.created_at}
Scheduled: {self.meeting.scheduled_start} - {self.meeting.scheduled_end}
Status: {self.meeting.status}

Description:
{self.meeting.description}

Participants:
"""
            
            # Add participants to metadata
            participants = self.meeting.participants.filter(is_active=True)
            for participant in participants:
                metadata_content += f"\n- {participant.user.display_name} ({participant.role})"
            
            file = self.drive_adapter.create_document(
                name=f"Metadata - {self.meeting.meeting_code}",
                content=metadata_content,
                parent_id=folder_id
            )
            
            Artifact.objects.create(
                meeting=self.meeting,
                artifact_type=ArtifactType.METADATA,
                drive_file_id=file['id'],
                display_name="Meeting Metadata",
                mime_type="application/vnd.google-apps.document"
            )
            
        except Exception as e:
            logger.error(f"Failed to create metadata file: {str(e)}")
    
    def _create_attendance_sheet(self, folder_id: str) -> None:
        """Create the attendance tracking sheet"""
        try:
            headers = [
                ['Name', 'Email', 'Role', 'Join Time', 'Leave Time', 'Duration (min)']
            ]
            
            file = self.drive_adapter.create_sheet(
                name=f"Attendance - {self.meeting.meeting_code}",
                data=headers,
                parent_id=folder_id
            )
            
            Artifact.objects.create(
                meeting=self.meeting,
                artifact_type=ArtifactType.ATTENDANCE,
                drive_file_id=file['id'],
                display_name="Attendance Record",
                mime_type="application/vnd.google-apps.spreadsheet"
            )
            
        except Exception as e:
            logger.error(f"Failed to create attendance sheet: {str(e)}")
    
    def _store_folder_ids(self, folder_ids: Dict[str, str]) -> None:
        """Store subfolder IDs in artifacts table"""
        for folder_type, folder_id in folder_ids.items():
            Artifact.objects.get_or_create(
                meeting=self.meeting,
                artifact_type=ArtifactType.FOLDER,
                drive_folder_id=folder_id,
                defaults={
                    'display_name': f"{folder_type.replace('_', ' ').title()}",
                    'mime_type': "application/vnd.google-apps.folder"
                }
            )
    
    def save_transcript(self, content: str, segment_id: Optional[str] = None) -> bool:
        """
        Save or append to meeting transcript
        """
        try:
            # Get or create transcript artifact
            transcript_artifact, created = Artifact.objects.get_or_create(
                meeting=self.meeting,
                artifact_type=ArtifactType.TRANSCRIPT,
                defaults={
                    'display_name': f"Transcript - {self.meeting.meeting_code}",
                    'mime_type': "application/vnd.google-apps.document",
                    'metadata': {'segments': []}
                }
            )
            
            # If no drive_file_id exists, create the document
            if not transcript_artifact.drive_file_id:
                file = self.drive_adapter.create_document(
                    name=transcript_artifact.display_name,
                    parent_id=self.meeting.drive_folder_id
                )
                transcript_artifact.drive_file_id = file['id']
                transcript_artifact.save()
            
            # Get the subfolder for transcripts
            transcript_folder = Artifact.objects.filter(
                meeting=self.meeting,
                artifact_type=ArtifactType.FOLDER,
                display_name__icontains="transcript"
            ).first()
            
            # Move to transcript folder if needed
            if transcript_folder and transcript_folder.drive_folder_id:
                self.drive_adapter.move_file(
                    transcript_artifact.drive_file_id,
                    transcript_folder.drive_folder_id
                )
            
            # Append content
            timestamp = timezone.now().strftime("%H:%M:%S")
            formatted_content = f"\n\n[{timestamp}] {content}"
            
            if segment_id:
                formatted_content = f"\n\nSegment {segment_id} [{timestamp}]:\n{content}"
            
            success = self.drive_adapter.append_to_document(
                transcript_artifact.drive_file_id,
                formatted_content
            )
            
            if success and segment_id:
                # Store segment reference
                metadata = transcript_artifact.metadata or {}
                if 'segments' not in metadata:
                    metadata['segments'] = []
                metadata['segments'].append({
                    'segment_id': segment_id,
                    'timestamp': timestamp,
                    'length': len(content)
                })
                transcript_artifact.metadata = metadata
                transcript_artifact.save()
            
            return success
            
        except Exception as e:
            logger.error(f"Failed to save transcript: {str(e)}")
            return False
    
    def save_meeting_notes(self, content: str) -> bool:
        """
        Save meeting notes
        """
        try:
            notes_artifact, created = Artifact.objects.get_or_create(
                meeting=self.meeting,
                artifact_type=ArtifactType.NOTES,
                defaults={
                    'display_name': f"Notes - {self.meeting.meeting_code}",
                    'mime_type': "application/vnd.google-apps.document"
                }
            )
            
            if not notes_artifact.drive_file_id:
                # Get notes folder
                notes_folder = Artifact.objects.filter(
                    meeting=self.meeting,
                    artifact_type=ArtifactType.FOLDER,
                    display_name__icontains="notes"
                ).first()
                
                parent_id = notes_folder.drive_folder_id if notes_folder else self.meeting.drive_folder_id
                
                file = self.drive_adapter.create_document(
                    name=notes_artifact.display_name,
                    content=content,
                    parent_id=parent_id
                )
                
                notes_artifact.drive_file_id = file['id']
                notes_artifact.save()
                return True
            else:
                # Append to existing notes
                return self.drive_adapter.append_to_document(
                    notes_artifact.drive_file_id,
                    f"\n\n{timezone.now().strftime('%Y-%m-%d %H:%M')}\n{content}"
                )
            
        except Exception as e:
            logger.error(f"Failed to save meeting notes: {str(e)}")
            return False
    
    def record_attendance(self, participant_data: Dict[str, Any]) -> bool:
        """
        Record participant attendance
        """
        try:
            attendance_artifact = Artifact.objects.get(
                meeting=self.meeting,
                artifact_type=ArtifactType.ATTENDANCE
            )
            
            # Get current attendance data
            # In production, you'd use the Sheets API to append rows
            # This is a simplified version
            row = [
                participant_data.get('name', ''),
                participant_data.get('email', ''),
                participant_data.get('role', ''),
                participant_data.get('join_time', ''),
                participant_data.get('leave_time', ''),
                participant_data.get('duration', '')
            ]
            
            # Use Sheet API to append row
            # For this example, we'll just log it
            logger.info(f"Attendance record: {row}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to record attendance: {str(e)}")
            return False
    
    def _get_or_create_resources_folder(self) -> str:
        """Return the Drive id of the meeting's Shared Resources folder.

        Created on demand, since folder initialisation at meeting creation is
        best-effort and may not have run.
        """
        resources_folder = Artifact.objects.filter(
            meeting=self.meeting,
            artifact_type=ArtifactType.FOLDER,
            display_name__icontains="resources"
        ).first()

        if resources_folder and resources_folder.drive_folder_id:
            return resources_folder.drive_folder_id

        if not self.meeting.drive_folder_id:
            self.initialize_meeting_folder()
            self.meeting.refresh_from_db()
            resources_folder = Artifact.objects.filter(
                meeting=self.meeting,
                artifact_type=ArtifactType.FOLDER,
                display_name__icontains="resources"
            ).first()
            if resources_folder and resources_folder.drive_folder_id:
                return resources_folder.drive_folder_id

        folder = self.drive_adapter.create_folder(
            folder_name='Shared Resources',
            parent_id=self.meeting.drive_folder_id
        )
        Artifact.objects.create(
            meeting=self.meeting,
            artifact_type=ArtifactType.FOLDER,
            drive_folder_id=folder['id'],
            display_name='Resources',
            mime_type='application/vnd.google-apps.folder'
        )
        return folder['id']

    def upload_resource(self, uploaded_file, uploader) -> Artifact:
        """Upload a file to the meeting's Shared Resources folder in the
        host's Drive, and grant every participant read access."""
        parent_id = self._get_or_create_resources_folder()

        drive_file = self.drive_adapter.upload_file(
            file_obj=uploaded_file,
            filename=uploaded_file.name,
            mime_type=getattr(uploaded_file, 'content_type', '') or 'application/octet-stream',
            parent_id=parent_id,
        )

        # Whatever is on stage owns this file, which is what decides when
        # the rest of the room gets to read it.
        live_session = self.meeting.sessions.filter(status='live').first()

        artifact = Artifact.objects.create(
            meeting=self.meeting,
            session=live_session,
            artifact_type=ArtifactType.RESOURCE,
            drive_file_id=drive_file['id'],
            display_name=uploaded_file.name,
            mime_type=drive_file.get('mimeType', ''),
            file_size=int(drive_file['size']) if drive_file.get('size') else None,
            web_view_link=drive_file.get('webViewLink'),
            sync_status=Artifact.SyncStatus.SYNCED,
            synced_at=timezone.now(),
            metadata={
                'uploaded_by_id': str(uploader.id),
                'uploaded_by_email': uploader.email,
            },
        )

        self._share_with_participants(drive_file['id'])
        return artifact

    def _share_with_participants(self, file_id: str) -> None:
        """Give every participant except the host read access to a file."""
        emails = self.meeting.participants.exclude(
            user_id=self.meeting.host_id
        ).values_list('user__email', flat=True)

        for email in {e for e in emails if e}:
            self.drive_adapter.share_file(file_id, email, role='reader')

    def list_resources(self, include_unreleased: bool = True):
        """Resource artifacts for this meeting, newest first.

        A file shared during a session waits until that session is over
        before the room can read it; organizers see everything.
        """
        from src.apps.artifacts.visibility import resources_for

        return resources_for(self.meeting, include_unreleased=include_unreleased)

    def create_shared_resource(self, name: str, content: str,
                              resource_type: str = 'document') -> Optional[str]:
        """
        Create a shared resource in the meeting
        """
        try:
            # Get resources folder
            resources_folder = Artifact.objects.filter(
                meeting=self.meeting,
                artifact_type=ArtifactType.FOLDER,
                display_name__icontains="resources"
            ).first()
            
            parent_id = resources_folder.drive_folder_id if resources_folder else self.meeting.drive_folder_id
            
            if resource_type == 'document':
                file = self.drive_adapter.create_document(
                    name=name,
                    content=content,
                    parent_id=parent_id
                )
            elif resource_type == 'sheet':
                data = [row.split('|') for row in content.split('\n') if row.strip()]
                file = self.drive_adapter.create_sheet(
                    name=name,
                    data=data,
                    parent_id=parent_id
                )
            else:
                raise ValueError(f"Unsupported resource type: {resource_type}")
            
            Artifact.objects.create(
                meeting=self.meeting,
                artifact_type=ArtifactType.RESOURCE,
                drive_file_id=file['id'],
                display_name=name,
                mime_type=file.get('mimeType', ''),
                metadata={'resource_type': resource_type}
            )
            
            return file['id']
            
        except Exception as e:
            logger.error(f"Failed to create shared resource: {str(e)}")
            return None