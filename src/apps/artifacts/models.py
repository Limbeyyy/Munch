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

class PhotoFolder(models.Model):
    """A named place for the photographs taken at a meeting.

    Every meeting has one folder whether anybody asked for it or not: the
    default. Photographs land there unless the host has made somewhere
    better to put them - a prize distribution, the hall, a seminar - and
    "somewhere better" is the host's judgement, not ours, so the custom
    folders are theirs to create and name.

    Kept apart from Artifact on purpose. Files and summaries are working
    documents with a release rule tied to the session that owns them;
    photographs are a record of the day, and mixing the two would put one
    set of rules over both.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(
        Meeting, on_delete=models.CASCADE, related_name='photo_folders'
    )
    name = models.CharField(max_length=120)
    #: The one every meeting has, which cannot be renamed or removed.
    is_default = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='photo_folders_created',
    )
    #: Where it lives in the host's Drive, made on the first upload.
    drive_folder_id = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'photo_folders'
        # The default sorts first; the rest read in the order they were made.
        ordering = ['-is_default', 'created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['meeting', 'name'], name='one_photo_folder_per_name'
            ),
            models.UniqueConstraint(
                fields=['meeting'],
                condition=models.Q(is_default=True),
                name='one_default_photo_folder_per_meeting',
            ),
        ]

    def __str__(self):
        return f'{self.name} ({self.meeting.meeting_code})'


class MeetingPhoto(models.Model):
    """One photograph from the day, in the host's own Drive."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(
        PhotoFolder, on_delete=models.CASCADE, related_name='photos'
    )
    # Held here as well as on the folder: almost every question asked of
    # this table is asked about a meeting.
    meeting = models.ForeignKey(
        Meeting, on_delete=models.CASCADE, related_name='photos'
    )
    caption = models.CharField(max_length=255, blank=True)
    drive_file_id = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveBigIntegerField(null=True, blank=True)
    web_view_link = models.URLField(max_length=800, blank=True)
    uploaded_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='photos_uploaded',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'meeting_photos'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['meeting']),
            models.Index(fields=['folder']),
        ]

    def __str__(self):
        return self.caption or f'Photo {self.id}'
