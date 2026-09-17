from django.contrib import admin
from .models import Recording, Attendance, EventAnalytics

@admin.register(Recording)
class RecordingAdmin(admin.ModelAdmin):
    list_display = ('event', 'status', 'duration_seconds', 'storage_size_mb', 'created_at')
    list_filter = ('status', 'storage_type', 'created_at')
    search_fields = ('event__code',)
    readonly_fields = ('id', 'created_at', 'updated_at')

@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ('event', 'participant_name', 'joined_at', 'duration_seconds')
    list_filter = ('event', 'joined_at')
    search_fields = ('participant_name', 'participant_email', 'event__code')
    readonly_fields = ('id',)

@admin.register(EventAnalytics)
class MeetingAnalyticsAdmin(admin.ModelAdmin):
    list_display = ('event', 'total_participants', 'total_duration_seconds', 'participant_engagement_score')
    list_filter = ('created_at',)
    search_fields = ('event__code',)
    readonly_fields = ('id', 'created_at', 'updated_at')
