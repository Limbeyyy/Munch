from django.contrib import admin
from .models import TranscriptionSegment, Transcript, TranscriptSummary


@admin.register(TranscriptionSegment)
class TranscriptionSegmentAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'speaker_name', 'is_final', 'confidence', 'created_at')
    list_filter = ('meeting', 'is_final', 'language', 'created_at')
    search_fields = ('speaker_name', 'text', 'meeting__meeting_code')
    readonly_fields = ('id', 'created_at')


@admin.register(Transcript)
class TranscriptAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'word_count', 'is_complete', 'completed_at')
    list_filter = ('is_complete', 'completed_at')
    search_fields = ('meeting__meeting_code', 'full_text')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(TranscriptSummary)
class TranscriptSummaryAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'llm_provider', 'is_complete', 'tokens_used', 'completed_at')
    list_filter = ('is_complete', 'llm_provider', 'completed_at')
    search_fields = ('meeting__meeting_code', 'summary_text')
    readonly_fields = ('id', 'created_at', 'updated_at')
