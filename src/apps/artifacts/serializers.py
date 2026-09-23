from rest_framework import serializers
from .models import Artifact, ArtifactType

class ArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Artifact
        fields = [
            'id', 'event', 'session', 'session_title', 'is_released',
            'visibility', 'position', 'artifact_type', 'drive_file_id',
            'drive_folder_id', 'display_name', 'mime_type',
            'file_size', 'web_view_link', 'sync_status',
            'metadata', 'created_at', 'updated_at', 'uploaded_by_name'
        ]
        read_only_fields = [
            'id', 'session_title', 'is_released', 'created_at', 'updated_at',
            'uploaded_by_name'
        ]

    session_title = serializers.SerializerMethodField()
    is_released = serializers.SerializerMethodField()
    #: Who shared it, by the name the room would recognise.
    #:
    #: Kept in metadata rather than a column, which is where the upload
    #: put it. Files shared before the name was recorded there carry only
    #: an id and an email, so the id is resolved and the email is the
    #: fallback - a list that says an email is still a list that says who.
    uploaded_by_name = serializers.SerializerMethodField()

    def get_uploaded_by_name(self, obj):
        from src.apps.accounts.models import User

        about = obj.metadata or {}
        named = about.get('uploaded_by_name')
        if named:
            return named

        who_id = about.get('uploaded_by_id')
        if who_id:
            # One lookup per distinct person across the whole list, not
            # one per file: an agenda's handouts usually share an uploader.
            seen = self.context.setdefault('_uploader_names', {})
            if who_id not in seen:
                who = User.objects.filter(id=who_id).first()
                seen[who_id] = (who.display_name or who.email) if who else None
            if seen[who_id]:
                return seen[who_id]

        return about.get('uploaded_by_email') or None

    def get_session_title(self, obj):
        return obj.session.title if obj.session_id else None

    def get_is_released(self, obj):
        """Whether everyone in the event can read this yet."""
        from src.apps.artifacts.visibility import is_released

        return is_released(obj)

class ArtifactCreateSerializer(serializers.Serializer):
    artifact_type = serializers.ChoiceField(choices=ArtifactType.choices)
    display_name = serializers.CharField(max_length=255)
    content = serializers.CharField(required=False, allow_blank=True)
    drive_file_id = serializers.CharField(required=False, allow_blank=True)
    drive_folder_id = serializers.CharField(required=False, allow_blank=True)