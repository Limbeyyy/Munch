from django.contrib import admin
from .models import Artifact

@admin.register(Artifact)
class ArtifactAdmin(admin.ModelAdmin):
    list_display = ('display_name', 'meeting', 'artifact_type', 'drive_file_id', 'created_at')
    list_filter = ('artifact_type', 'created_at')
    search_fields = ('display_name', 'meeting__meeting_code', 'drive_file_id')