from django.contrib import admin
from .models import Event, EventParticipant

@admin.register(Event)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ('code', 'title', 'host', 'status', 'scheduled_start', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('code', 'title', 'host__email')
    readonly_fields = ('created_at', 'updated_at')
    fieldsets = (
        (None, {'fields': ('code', 'title', 'description', 'host')}),
        ('Schedule', {'fields': ('scheduled_start', 'scheduled_end', 'started_at', 'ended_at')}),
        ('Status', {'fields': ('status',)}),
        ('Drive', {'fields': ('drive_folder_id', 'drive_metadata_file_id')}),
        ('Settings', {'fields': ('max_participants', 'allow_recording', 'require_authentication')}),
        ('Metadata', {'fields': ('event_metadata',)}),
        ('Timestamps', {'fields': ('created_at', 'updated_at')}),
    )

@admin.register(EventParticipant)
class MeetingParticipantAdmin(admin.ModelAdmin):
    list_display = ('event', 'user', 'role', 'is_active', 'joined_at', 'left_at')
    list_filter = ('role', 'is_active', 'joined_at')
    search_fields = ('event__code', 'user__email')
    readonly_fields = ('joined_at',)