"""Recording and analytics models"""
from django.db import models
from src.apps.meetings.models import Meeting
import uuid


class Recording(models.Model):
    """
    Meeting recordings with metadata and processing status
    """
    class Status(models.TextChoices):
        RECORDING = 'recording', 'Recording'
        PROCESSING = 'processing', 'Processing'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name='recording')

    # Recording metadata
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.IntegerField(default=0)

    # Storage
    storage_type = models.CharField(max_length=50, default='drive', choices=[
        ('drive', 'Google Drive'),
        ('s3', 'AWS S3'),
        ('gcs', 'Google Cloud Storage')
    ])
    storage_path = models.CharField(max_length=500, null=True, blank=True)
    storage_size_mb = models.FloatField(default=0)

    # Processing
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RECORDING)
    video_format = models.CharField(max_length=20, default='mp4')
    bitrate_kbps = models.IntegerField(default=2500)
    resolution = models.CharField(max_length=20, default='1080p')

    # URLs
    download_url = models.URLField(max_length=1000, null=True, blank=True)
    stream_url = models.URLField(max_length=1000, null=True, blank=True)

    # Metadata
    error_message = models.TextField(blank=True)
    metadata = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'recordings'
        indexes = [
            models.Index(fields=['meeting', 'status']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"Recording: {self.meeting.meeting_code}"


class Attendance(models.Model):
    """
    Participant attendance tracking
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='attendance_records')

    participant_id = models.CharField(max_length=255)
    participant_name = models.CharField(max_length=255)
    participant_email = models.EmailField(null=True, blank=True)

    joined_at = models.DateTimeField()
    left_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.IntegerField(default=0)

    metadata = models.JSONField(default=dict)  # Role, status changes, etc

    class Meta:
        db_table = 'attendance'
        indexes = [
            models.Index(fields=['meeting', 'joined_at']),
        ]

    def __str__(self):
        return f"{self.participant_name} - {self.meeting.meeting_code}"


class MeetingAnalytics(models.Model):
    """
    Aggregated analytics for meetings
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name='analytics')

    # Participants
    total_participants = models.IntegerField(default=0)
    peak_participants = models.IntegerField(default=0)

    # Duration
    total_duration_seconds = models.IntegerField(default=0)
    active_duration_seconds = models.IntegerField(default=0)

    # Engagement
    messages_count = models.IntegerField(default=0)
    screen_shares_count = models.IntegerField(default=0)
    recordings_count = models.IntegerField(default=0)

    # Quality
    avg_latency_ms = models.FloatField(default=0)
    packet_loss_percent = models.FloatField(default=0)
    bandwidth_used_mb = models.FloatField(default=0)

    # Metrics
    participant_engagement_score = models.FloatField(default=0, help_text="0-100")

    metadata = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'meeting_analytics'
        indexes = [
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"Analytics: {self.meeting.meeting_code}"
