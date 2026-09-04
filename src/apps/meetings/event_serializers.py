"""Serializers for the event / meeting / session hierarchy.

An event is created whole: the organizer describes the day, the meetings
inside it and the sessions inside those, and the server writes the lot in
one transaction so a half-built programme never reaches the database.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from src.apps.meetings.models import Event, Meeting, Session, SessionAttendance


class SessionSerializer(serializers.ModelSerializer):
    ends_at = serializers.DateTimeField(read_only=True)
    attendance_count = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = [
            'id', 'meeting', 'title', 'description', 'speaker_name', 'hall',
            'starts_at', 'duration_minutes', 'ends_at', 'position',
            'status', 'started_at', 'ended_at', 'attendance_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'ends_at', 'started_at', 'ended_at',
            'attendance_count', 'created_at', 'updated_at',
        ]

    def get_attendance_count(self, obj):
        return obj.attendance.count()


class SessionWriteSerializer(serializers.ModelSerializer):
    """A session as written inside a meeting, where the parent is implied."""

    class Meta:
        model = Session
        fields = [
            'title', 'description', 'speaker_name', 'hall',
            'starts_at', 'duration_minutes', 'position',
        ]


class MeetingSummarySerializer(serializers.ModelSerializer):
    """A meeting as it appears within its event, with its running order."""
    sessions = SessionSerializer(many=True, read_only=True)
    session_count = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = [
            'id', 'meeting_code', 'title', 'description', 'status',
            'scheduled_start', 'scheduled_end', 'started_at', 'ended_at',
            'participant_count', 'sessions', 'session_count',
        ]

    def get_session_count(self, obj):
        return obj.sessions.count()

    def get_participant_count(self, obj):
        return obj.participants.filter(is_active=True).count()


class MeetingWriteSerializer(serializers.Serializer):
    """A meeting being added to an event, together with its sessions."""
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    scheduled_start = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(min_value=5, default=60)
    sessions = SessionWriteSerializer(many=True, required=False, default=list)

    def validate_sessions(self, sessions):
        if len(sessions) > 50:
            raise serializers.ValidationError('A meeting can hold at most 50 sessions.')
        return sessions


class EventSerializer(serializers.ModelSerializer):
    meetings = MeetingSummarySerializer(many=True, read_only=True)
    organizer_email = serializers.EmailField(source='organizer.email', read_only=True)
    meeting_count = serializers.SerializerMethodField()
    session_count = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id', 'title', 'description', 'venue', 'event_date', 'status',
            'organizer_email', 'meetings', 'meeting_count', 'session_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'organizer_email', 'created_at', 'updated_at']

    def get_meeting_count(self, obj):
        return obj.meetings.count()

    def get_session_count(self, obj):
        return Session.objects.filter(meeting__event=obj).count()


class EventCreateSerializer(serializers.ModelSerializer):
    """Create a whole programme in one request."""
    meetings = MeetingWriteSerializer(many=True, required=False, default=list)

    class Meta:
        model = Event
        fields = ['title', 'description', 'venue', 'event_date', 'status', 'meetings']

    def validate_meetings(self, meetings):
        if len(meetings) > 30:
            raise serializers.ValidationError('An event can hold at most 30 meetings.')
        return meetings

    @transaction.atomic
    def create(self, validated_data):
        meetings_data = validated_data.pop('meetings', [])
        event = Event.objects.create(
            organizer=self.context['request'].user, **validated_data
        )

        for meeting_data in meetings_data:
            build_meeting(event, meeting_data)

        return event


def build_meeting(event, data):
    """Create one meeting under an event, along with its sessions.

    The meeting's window is stretched to cover its sessions when they run
    past the length the organizer typed, so a session can never fall
    outside the meeting that contains it.
    """
    from src.apps.meetings.models import Meeting as MeetingModel
    from src.apps.meetings.services.meeting_service import MeetingService

    sessions_data = data.get('sessions') or []
    start = data['scheduled_start']
    end = start + timezone.timedelta(minutes=data.get('duration_minutes', 60))

    for index, session in enumerate(sessions_data):
        session_end = session['starts_at'] + timezone.timedelta(
            minutes=session.get('duration_minutes', 30)
        )
        end = max(end, session_end)

    meeting = MeetingModel.objects.create(
        event=event,
        host=event.organizer,
        title=data['title'],
        description=data.get('description', ''),
        scheduled_start=start,
        scheduled_end=end,
        meeting_code=MeetingService.generate_meeting_code(),
    )

    Session.objects.bulk_create([
        Session(
            meeting=meeting,
            title=s['title'],
            description=s.get('description', ''),
            speaker_name=s.get('speaker_name', ''),
            hall=s.get('hall', ''),
            starts_at=s['starts_at'],
            duration_minutes=s.get('duration_minutes', 30),
            position=s.get('position', index),
        )
        for index, s in enumerate(sessions_data)
    ])

    return meeting




class SessionAttendanceSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    is_guest = serializers.SerializerMethodField()

    class Meta:
        model = SessionAttendance
        fields = ['id', 'session', 'name', 'is_guest', 'marked_manually', 'recorded_at']

    def get_name(self, obj):
        if obj.user:
            return obj.user.display_name or obj.user.email
        return obj.guest.full_name if obj.guest else '—'

    def get_is_guest(self, obj):
        return obj.guest_id is not None
