from rest_framework import serializers
from django.utils import timezone
from src.apps.meetings.models import (
    Meeting, MeetingParticipant, ChatMessage, GuestAttendee, MeetingInvite
)
from src.apps.accounts.serializers import UserSerializer
from src.utilities.validators import validate_meeting_code

class MeetingSerializer(serializers.ModelSerializer):
    host = UserSerializer(read_only=True)
    participant_count = serializers.SerializerMethodField()
    is_active = serializers.BooleanField(read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True)
    entry = serializers.SerializerMethodField()
    current_session = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = [
            'id', 'meeting_code', 'title', 'description', 'host', 'status',
            'drive_folder_id', 'drive_metadata_file_id',
            'scheduled_start', 'scheduled_end', 'started_at', 'ended_at',
            'max_participants', 'allow_recording', 'require_authentication',
            'chat_enabled', 'direct_messages_enabled',
            'meeting_metadata', 'created_at', 'updated_at',
            'participant_count', 'is_active', 'duration_seconds', 'entry',
            'current_session',
        ]
        read_only_fields = [
            'id', 'meeting_code', 'host', 'created_at', 'updated_at',
            'started_at', 'ended_at', 'drive_folder_id', 'drive_metadata_file_id'
        ]
    
    def get_entry(self, obj):
        """When the room opens and when it may be started.

        Worked out on the server so the buttons a client draws cannot
        disagree with the rules the door enforces.
        """
        from src.apps.meetings.entry import entry_state

        return entry_state(obj)

    def get_current_session(self, obj):
        """The session the room is holding, which is what its clock counts."""
        from src.apps.meetings.lifecycle import session_room_state

        return session_room_state(obj)

    def get_participant_count(self, obj):
        return obj.get_participant_count()

class MeetingCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    scheduled_start = serializers.DateTimeField()
    scheduled_end = serializers.DateTimeField()
    max_participants = serializers.IntegerField(min_value=1, max_value=1000, default=100)
    allow_recording = serializers.BooleanField(default=False)
    require_authentication = serializers.BooleanField(default=True)
    
    def validate(self, data):
        if data['scheduled_start'] >= data['scheduled_end']:
            raise serializers.ValidationError("End time must be after start time")
        if data['scheduled_start'] < timezone.now():
            raise serializers.ValidationError("Start time must be in the future")
        return data

class MeetingJoinSerializer(serializers.Serializer):
    role = serializers.ChoiceField(
        choices=MeetingParticipant.Role.choices, 
        default=MeetingParticipant.Role.ATTENDEE
    )

class ParticipantSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = MeetingParticipant
        fields = [
            'id', 'user', 'role', 'session_id', 'joined_at', 'left_at',
            'is_active', 'is_muted', 'is_video_on', 'is_screen_sharing',
            'participant_metadata'
        ]
        read_only_fields = ['id', 'joined_at', 'left_at']

class MeetingParticipantUpdateSerializer(serializers.Serializer):
    is_muted = serializers.BooleanField(required=False)
    is_video_on = serializers.BooleanField(required=False)
    is_screen_sharing = serializers.BooleanField(required=False)
    role = serializers.ChoiceField(choices=MeetingParticipant.Role.choices, required=False)

class ChatMessageSerializer(serializers.ModelSerializer):
    """A message from either an account holder or a guest.

    ``sender_id`` / ``recipient_id`` are the ids clients address, whichever
    kind of participant they refer to; ``sender_is_guest`` disambiguates.
    """
    sender_id = serializers.SerializerMethodField()
    sender_name = serializers.SerializerMethodField()
    sender_email = serializers.SerializerMethodField()
    sender_is_guest = serializers.SerializerMethodField()
    recipient_id = serializers.SerializerMethodField()
    recipient_name = serializers.SerializerMethodField()
    recipient_is_guest = serializers.SerializerMethodField()
    is_direct = serializers.BooleanField(read_only=True)

    class Meta:
        model = ChatMessage
        fields = [
            'id', 'body', 'created_at', 'is_direct',
            'sender_id', 'sender_name', 'sender_email', 'sender_is_guest',
            'recipient_id', 'recipient_name', 'recipient_is_guest',
            'moderation_status', 'topic', 'answer',
        ]
        read_only_fields = fields

    def get_sender_id(self, obj):
        return str(obj.guest_sender_id or obj.sender_id)

    def get_sender_name(self, obj):
        return obj.sender_label

    def get_sender_email(self, obj):
        return obj.sender.email if obj.sender_id else None

    def get_sender_is_guest(self, obj):
        return obj.guest_sender_id is not None

    def get_recipient_id(self, obj):
        target = obj.guest_recipient_id or obj.recipient_id
        return str(target) if target else None

    def get_recipient_name(self, obj):
        return obj.recipient_label

    def get_recipient_is_guest(self, obj):
        return obj.guest_recipient_id is not None


class ChatSettingsSerializer(serializers.Serializer):
    chat_enabled = serializers.BooleanField(required=False)
    direct_messages_enabled = serializers.BooleanField(required=False)

    def validate(self, data):
        if not data:
            raise serializers.ValidationError(
                "Provide chat_enabled and/or direct_messages_enabled"
            )
        return data


class GuestJoinSerializer(serializers.Serializer):
    """A guest knocking on a meeting: both fields are required."""
    meeting_code = serializers.CharField(max_length=20)
    full_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32)

    def validate_full_name(self, value):
        name = ' '.join(value.split())
        if len(name) < 2:
            raise serializers.ValidationError("Please enter your full name")
        return name

    def validate_phone(self, value):
        phone = value.strip()
        digits = [c for c in phone if c.isdigit()]
        if len(digits) < 7:
            raise serializers.ValidationError("Please enter a valid phone number")
        return phone

    def validate_meeting_code(self, value):
        return value.strip().upper()


class GuestAttendeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = GuestAttendee
        fields = ['id', 'full_name', 'phone', 'status', 'created_at', 'decided_at']
        read_only_fields = fields


class MeetingInviteSerializer(serializers.ModelSerializer):
    has_joined = serializers.BooleanField(read_only=True)
    invited_by_email = serializers.CharField(source='invited_by.email', read_only=True)

    class Meta:
        model = MeetingInvite
        fields = [
            'id', 'email', 'created_at', 'joined_at', 'has_joined',
            'invited_by_email',
        ]
        read_only_fields = fields


class InviteCreateSerializer(serializers.Serializer):
    """Accepts the addresses a host shared the meeting link with."""
    emails = serializers.ListField(
        child=serializers.EmailField(),
        allow_empty=False,
        max_length=200,
    )

    def validate_emails(self, value):
        seen, unique = set(), []
        for email in value:
            key = email.strip().lower()
            if key and key not in seen:
                seen.add(key)
                unique.append(key)
        if not unique:
            raise serializers.ValidationError("Provide at least one email address")
        return unique
