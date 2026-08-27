from django.contrib import admin
from .models import Recording, Attendance, MeetingAnalytics

@admin.register(Recording)
class RecordingAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'status', 'duration_seconds', 'storage_size_mb', 'created_at')
    list_filter = ('status', 'storage_type', 'created_at')
    search_fields = ('meeting__meeting_code',)
    readonly_fields = ('id', 'created_at', 'updated_at')

@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'participant_name', 'joined_at', 'duration_seconds')
    list_filter = ('meeting', 'joined_at')
    search_fields = ('participant_name', 'participant_email', 'meeting__meeting_code')
    readonly_fields = ('id',)

@admin.register(MeetingAnalytics)
class MeetingAnalyticsAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'total_participants', 'total_duration_seconds', 'participant_engagement_score')
    list_filter = ('created_at',)
    search_fields = ('meeting__meeting_code',)
    readonly_fields = ('id', 'created_at', 'updated_at')
