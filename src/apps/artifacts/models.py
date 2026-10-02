from django.db import models
from src.apps.meetings.models import Event
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
    SUMMARY = 'summary', 'Event summary'

class Artifact(models.Model):
    """
    Tracks event artifacts stored in Google Drive (or other storage)
    """
    class SyncStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SYNCING = 'syncing', 'Syncing'
        SYNCED = 'synced', 'Synced'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='artifacts')
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
        # Open to anyone with the event, guests included, whatever the
        # running order is doing.
        PUBLIC = 'public', 'Public to all'
        # Never leaves the people running the event.
        ORGANIZERS = 'organizers', 'Organizers only'

    #: Who may read this, and when. Chosen by whoever uploaded it and
    #: changeable by the organizers afterwards.
    #: Readable as soon as it is shared, unless somebody says otherwise.
    #:
    #: It used to default to AFTER_SESSION, and nothing in the product
    #: ever set it to anything else - so every file a host uploaded was
    #: held until the talk it was filed against had finished, and files
    #: on an event that had not started were invisible to everyone the
    #: event was for. A host who shares something has shared it.
    #:
    #: The holding rule still works where it is asked for; it is just no
    #: longer what happens to somebody who never asked for it.
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.NOW,
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
            models.Index(fields=['event', 'artifact_type']),
            models.Index(fields=['drive_file_id']),
            models.Index(fields=['sync_status']),
            models.Index(fields=['event', 'sync_status']),
        ]

    def __str__(self):
        return f"{self.display_name} ({self.artifact_type})"

    def is_synced(self):
        return self.sync_status == self.SyncStatus.SYNCED

    def needs_retry(self):
        return self.sync_status == self.SyncStatus.FAILED and self.retry_count < 3

class PhotoFolder(models.Model):
    """A named place for the photographs taken at an event.

    Made by the host, and only by the host: a prize distribution, the
    hall, a seminar. Where they have made none the event has none, and
    the screen says so. There used to be one called Default standing in
    every event whether anybody wanted it or not, which read as a single
    shelf shared between them.

    Kept apart from Artifact on purpose. Files and summaries are working
    documents with a release rule tied to the session that owns them;
    photographs are a record of the day, and mixing the two would put one
    set of rules over both.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='photo_folders'
    )
    name = models.CharField(max_length=120)
    #: Vestigial. Nothing sets this now; it is kept so the folders that
    #: carried the old Default name, and the photographs filed in them,
    #: survive the change rather than being swept out with it.
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
        # In the order they were made, which is the order they were meant.
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['event', 'name'], name='one_photo_folder_per_name'
            ),
            # There was a 'one default folder per event' constraint here.
            # Migration 0003 dropped it when the default folder went;
            # leaving it in the model only made every makemigrations
            # offer to put it back.
        ]

    def __str__(self):
        return f'{self.name} ({self.event.code})'


class EventPhoto(models.Model):
    """One photograph from the day, in the host's own Drive."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(
        PhotoFolder, on_delete=models.CASCADE, related_name='photos'
    )
    # Held here as well as on the folder: almost every question asked of
    # this table is asked about an event.
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='photos'
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
        db_table = 'event_photos'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['folder']),
        ]

    def __str__(self):
        return self.caption or f'Photo {self.id}'
