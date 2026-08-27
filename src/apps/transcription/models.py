from django.db import models
from src.apps.meetings.models import Meeting
import uuid


class TranscriptionSegment(models.Model):
    """
    Real-time transcription chunks during meeting
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='transcription_segments')

    speaker_id = models.CharField(max_length=255, help_text="Participant session ID")
    speaker_name = models.CharField(max_length=255, null=True, blank=True)

    text = models.TextField()
    language = models.CharField(max_length=10, default='en')

    start_time = models.FloatField(help_text="Start time in meeting (seconds)")
    end_time = models.FloatField(help_text="End time in meeting (seconds)")
    confidence = models.FloatField(default=0.0, help_text="Speech recognition confidence 0-1")

    is_final = models.BooleanField(default=False, help_text="Whether this is final or interim transcript")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'transcription_segments'
        indexes = [
            models.Index(fields=['meeting', 'created_at']),
            models.Index(fields=['meeting', 'start_time']),
            models.Index(fields=['is_final']),
        ]

    def __str__(self):
        return f"{self.speaker_name} ({self.meeting.meeting_code}): {self.text[:50]}"


class Transcript(models.Model):
    """
    Complete meeting transcript (merged from all segments)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name='transcript')

    full_text = models.TextField(blank=True)
    word_count = models.IntegerField(default=0)

    drive_file_id = models.CharField(max_length=255, null=True, blank=True, help_text="Google Docs file ID")
    drive_folder_id = models.CharField(max_length=255, null=True, blank=True)

    is_complete = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'transcripts'
        indexes = [
            models.Index(fields=['meeting', 'is_complete']),
        ]

    def __str__(self):
        return f"Transcript for {self.meeting.meeting_code}"


class TranscriptSummary(models.Model):
    """
    AI-generated meeting summary
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name='summary')
    transcript = models.OneToOneField(Transcript, on_delete=models.CASCADE, related_name='summary', null=True)

    summary_text = models.TextField()
    key_points = models.JSONField(default=list, help_text="List of key discussion points")
    action_items = models.JSONField(default=list, help_text="List of action items with owner")
    attendee_summary = models.JSONField(default=dict, help_text="Summary per attendee (contributions, key points)")

    llm_provider = models.CharField(max_length=50, default='pending', help_text="LLM used (claude, openai, etc)")
    llm_model = models.CharField(max_length=100, blank=True)
    tokens_used = models.IntegerField(default=0)

    drive_file_id = models.CharField(max_length=255, null=True, blank=True)
    drive_folder_id = models.CharField(max_length=255, null=True, blank=True)

    is_complete = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, help_text="Error if summarization failed")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'transcript_summaries'
        indexes = [
            models.Index(fields=['meeting', 'is_complete']),
        ]

    def __str__(self):
        return f"Summary for {self.meeting.meeting_code}"
