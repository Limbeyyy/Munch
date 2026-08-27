from django.contrib import admin
from .models import ErrorLog, MeetingEvent, SystemMetric


@admin.register(ErrorLog)
class ErrorLogAdmin(admin.ModelAdmin):
    list_display = ('error_type', 'severity', 'is_resolved', 'error_message', 'created_at')
    list_filter = ('error_type', 'severity', 'is_resolved', 'created_at')
    search_fields = ('error_message', 'error_code', 'meeting__meeting_code')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(MeetingEvent)
class MeetingEventAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'event_type', 'user', 'created_at')
    list_filter = ('event_type', 'created_at')
    search_fields = ('meeting__meeting_code', 'description')
    readonly_fields = ('id', 'created_at')


@admin.register(SystemMetric)
class SystemMetricAdmin(admin.ModelAdmin):
    list_display = ('metric_type', 'metric_value', 'recorded_at')
    list_filter = ('metric_type', 'recorded_at')
    readonly_fields = ('id', 'recorded_at')
