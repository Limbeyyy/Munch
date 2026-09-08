from django.db import models
from src.apps.meetings.models import Meeting
from django.utils import timezone
import uuid

class ArtifactType(models.TextChoices):
    FOLDER = 'folder', 'Folder'
    METADATA = 'metadata', 'Metadata'
    TRANSCRIPT = 'transcript', 'Transcript'
    ATTENDANCE = 'attendance', 'Attendance'
    NOTES = 'notes', 'Notes'
    RESOURCE = 'resource', 'Shared Resource'
    RECORDING = 'recording', 'Recording'
    SUMMARY = 'summary', 'Meeting Summary'

class Artifact(models.Model):
    """
    Tracks meeting artifacts stored in Google Drive (or other storage)
    """
    class SyncStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SYNCING = 'syncing', 'Syncing'
        SYNCED = 'synced', 'Synced'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='artifacts')
    # The part of the running order this file belongs to, when known.
    session = models.ForeignKey(
        'meetings.Session',
        on_delete=models.SET_NULL,
        related_name='artifacts',
        null=True,
        blank=True,
    )
    artifact_type = models.CharField(max_length=50, choices=ArtifactType.choices)

    class Visibility(models.TextChoices):
        # Readable by the room as soon as it is uploaded.
        NOW = 'now', 'Visible now'
        # Held until the session it belongs to has finished, so the room
        # cannot read ahead of the speaker.
        AFTER_SESSION = 'after_session', 'After the session'
        # Open to anyone with the meeting, guests included, whatever the
        # running order is doing.
        PUBLIC = 'public', 'Public to all'
        # Never leaves the people running the meeting.
        ORGANIZERS = 'organizers', 'Organizers only'

    #: Who may read this, and when. Chosen by whoever uploaded it and
    #: changeable by the organizers afterwards.
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.AFTER_SESSION,
        help_text="Who may read this file, and from when",
    )

    #: Where it sits in the order attendees see. Lower comes first.
    position = models.PositiveIntegerField(default=0)

    drive_file_id = models.CharField(max_length=255, null=True, blank=True)
    drive_folder_id = models.CharField(max_length=255, null=True, blank=True)
    display_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100, blank=True)

    # File metadata
    file_size = models.BigIntegerField(null=True, blank=True, help_text="File size in bytes")
    web_view_link = models.URLField(max_length=1000, null=True, blank=True)

    # Sync tracking
    sync_status = models.CharField(max_length=20, choices=SyncStatus.choices, default=SyncStatus.PENDING)
    synced_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    retry_count = models.IntegerField(default=0)

    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'artifacts'
        indexes = [
            models.Index(fields=['meeting', 'artifact_type']),
            models.Index(fields=['drive_file_id']),
            models.Index(fields=['sync_status']),
            models.Index(fields=['meeting', 'sync_status']),
        ]

    def __str__(self):
        return f"{self.display_name} ({self.artifact_type})"

    def is_synced(self):
        return self.sync_status == self.SyncStatus.SYNCED

    def needs_retry(self):
        return self.sync_status == self.SyncStatus.FAILED and self.retry_count < 3