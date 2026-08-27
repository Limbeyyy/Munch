from django.contrib import admin
from .models import Meeting, MeetingParticipant

@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ('meeting_code', 'title', 'host', 'status', 'scheduled_start', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('meeting_code', 'title', 'host__email')
    readonly_fields = ('created_at', 'updated_at')
    fieldsets = (
        (None, {'fields': ('meeting_code', 'title', 'description', 'host')}),
        ('Schedule', {'fields': ('scheduled_start', 'scheduled_end', 'started_at', 'ended_at')}),
        ('Status', {'fields': ('status',)}),
        ('Drive', {'fields': ('drive_folder_id', 'drive_metadata_file_id')}),
        ('Settings', {'fields': ('max_participants', 'allow_recording', 'require_authentication')}),
        ('Metadata', {'fields': ('meeting_metadata',)}),
        ('Timestamps', {'fields': ('created_at', 'updated_at')}),
    )

@admin.register(MeetingParticipant)
class MeetingParticipantAdmin(admin.ModelAdmin):
    list_display = ('meeting', 'user', 'role', 'is_active', 'joined_at', 'left_at')
    list_filter = ('role', 'is_active', 'joined_at')
    search_fields = ('meeting__meeting_code', 'user__email')
    readonly_fields = ('joined_at',)