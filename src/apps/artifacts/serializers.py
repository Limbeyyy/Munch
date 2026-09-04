from rest_framework import serializers
from .models import Artifact, ArtifactType

class ArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Artifact
        fields = [
            'id', 'meeting', 'session', 'session_title', 'is_released',
            'artifact_type', 'drive_file_id',
            'drive_folder_id', 'display_name', 'mime_type',
            'file_size', 'web_view_link', 'sync_status',
            'metadata', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'session_title', 'is_released', 'created_at', 'updated_at'
        ]

    session_title = serializers.SerializerMethodField()
    is_released = serializers.SerializerMethodField()

    def get_session_title(self, obj):
        return obj.session.title if obj.session_id else None

    def get_is_released(self, obj):
        """Whether everyone in the meeting can read this yet."""
        from src.apps.artifacts.visibility import is_released

        return is_released(obj)

class ArtifactCreateSerializer(serializers.Serializer):
    artifact_type = serializers.ChoiceField(choices=ArtifactType.choices)
    display_name = serializers.CharField(max_length=255)
    content = serializers.CharField(required=False, allow_blank=True)
    drive_file_id = serializers.CharField(required=False, allow_blank=True)
    drive_folder_id = serializers.CharField(required=False, allow_blank=True)