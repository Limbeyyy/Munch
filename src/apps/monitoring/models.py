from django.db import models
from src.apps.meetings.models import Meeting
import uuid


class ErrorLog(models.Model):
    """
    Centralized error tracking for Drive, Transcription, and other async operations
    """
    class ErrorType(models.TextChoices):
        DRIVE_API = 'drive', 'Google Drive API'
        SPEECH_API = 'speech', 'Google Speech-to-Text API'
        LLM_API = 'llm', 'LLM Summarization API'
        WEBSOCKET = 'websocket', 'WebSocket'
        CELERY = 'celery', 'Celery Task'
        DATABASE = 'database', 'Database'
        AUTHENTICATION = 'auth', 'Authentication'
        OTHER = 'other', 'Other'

    class ErrorSeverity(models.TextChoices):
        INFO = 'info', 'Info'
        WARNING = 'warning', 'Warning'
        ERROR = 'error', 'Error'
        CRITICAL = 'critical', 'Critical'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, null=True, blank=True, related_name='error_logs')

    error_type = models.CharField(max_length=50, choices=ErrorType.choices)
    severity = models.CharField(max_length=20, choices=ErrorSeverity.choices, default=ErrorSeverity.ERROR)

    error_message = models.TextField()
    error_code = models.CharField(max_length=50, blank=True)
    stacktrace = models.TextField(blank=True)

    context = models.JSONField(default=dict, help_text="Additional context (user, meeting, etc)")

    is_resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True)

    retry_count = models.IntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'error_logs'
        indexes = [
            models.Index(fields=['meeting', 'created_at']),
            models.Index(fields=['error_type', 'is_resolved']),
            models.Index(fields=['severity', 'is_resolved']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"[{self.severity.upper()}] {self.error_type}: {self.error_message[:50]}"


class MeetingEvent(models.Model):
    """
    Audit trail for all meeting state changes and important events
    """
    class EventType(models.TextChoices):
        MEETING_CREATED = 'meeting_created', 'Meeting Created'
        MEETING_STARTED = 'meeting_started', 'Meeting Started'
        MEETING_ENDED = 'meeting_ended', 'Meeting Ended'
        PARTICIPANT_JOINED = 'participant_joined', 'Participant Joined'
        PARTICIPANT_LEFT = 'participant_left', 'Participant Left'
        RECORDING_STARTED = 'recording_started', 'Recording Started'
        RECORDING_STOPPED = 'recording_stopped', 'Recording Stopped'
        TRANSCRIPTION_STARTED = 'transcription_started', 'Transcription Started'
        TRANSCRIPT_SEGMENT = 'transcript_segment', 'Transcript Segment'
        MEETING_SETTINGS_CHANGED = 'settings_changed', 'Settings Changed'
        PARTICIPANT_MUTED = 'participant_muted', 'Participant Muted'
        PARTICIPANT_UNMUTED = 'participant_unmuted', 'Participant Unmuted'
        SCREEN_SHARE_STARTED = 'screen_share_started', 'Screen Share Started'
        SCREEN_SHARE_STOPPED = 'screen_share_stopped', 'Screen Share Stopped'
        ARTIFACT_UPLOADED = 'artifact_uploaded', 'Artifact Uploaded'
        SUMMARY_GENERATED = 'summary_generated', 'Summary Generated'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='events')

    event_type = models.CharField(max_length=50, choices=EventType.choices)
    description = models.TextField(blank=True)

    user = models.CharField(max_length=255, null=True, blank=True, help_text="User or service that triggered event")
    data = models.JSONField(default=dict, help_text="Event-specific data")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'meeting_events'
        indexes = [
            models.Index(fields=['meeting', 'created_at']),
            models.Index(fields=['event_type', 'created_at']),
        ]

    def __str__(self):
        return f"{self.meeting.meeting_code}: {self.event_type} - {self.created_at}"


class SystemMetric(models.Model):
    """
    Track system performance and usage metrics
    """
    class MetricType(models.TextChoices):
        CONCURRENT_MEETINGS = 'concurrent_meetings', 'Concurrent Meetings'
        CONCURRENT_PARTICIPANTS = 'concurrent_participants', 'Concurrent Participants'
        API_RESPONSE_TIME = 'api_response_time', 'API Response Time'
        WEBSOCKET_MESSAGES = 'websocket_messages', 'WebSocket Messages'
        CELERY_TASK_TIME = 'celery_task_time', 'Celery Task Time'
        DRIVE_API_CALLS = 'drive_api_calls', 'Drive API Calls'
        SPEECH_API_CALLS = 'speech_api_calls', 'Speech API Calls'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    metric_type = models.CharField(max_length=50, choices=MetricType.choices)
    metric_value = models.FloatField()

    labels = models.JSONField(default=dict, help_text="Additional dimensions (endpoint, worker, etc)")

    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'system_metrics'
        indexes = [
            models.Index(fields=['metric_type', 'recorded_at']),
        ]

    def __str__(self):
        return f"{self.metric_type}: {self.metric_value}"
