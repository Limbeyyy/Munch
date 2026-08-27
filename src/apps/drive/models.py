# This file is intentionally minimal as Drive resources are managed through Artifact model
# If you need separate tracking, you can uncomment below

from django.db import models
from src.apps.meetings.models import Meeting

class DriveResource(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='drive_resources')
    resource_type = models.CharField(max_length=50, choices=[('folder', 'Folder'), ('file', 'File')])
    drive_file_id = models.CharField(max_length=255, unique=True)
    drive_folder_id = models.CharField(max_length=255, null=True, blank=True)
    mime_type = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)