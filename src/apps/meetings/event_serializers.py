"""Serializers for the event / meeting / session hierarchy.

An event is created whole: the organizer describes the day, the meetings
inside it and the sessions inside those, and the server writes the lot in
one transaction so a half-built programme never reaches the database.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from src.apps.meetings.models import (
    RoleGrant,
    SessionSummary,
    ContactRequest, Event, Meeting, Session, SessionAttendance,
)


def _require_speaker_details(attrs):
    """A session must say who is speaking and how to reach them.

    The details are collected once, when the running order is written,
    because chasing them down after the event is how they never get
    recorded at all.
    """
    missing = [
        field for field in ('speaker_name', 'speaker_email', 'speaker_phone')
        if not (attrs.get(field) or '').strip()
    ]
    if missing:
        raise serializers.ValidationError({
            field: 'This is needed so the speaker can be reached afterwards.'
            for field in missing
        })
    return attrs


class SessionSerializer(serializers.ModelSerializer):
    ends_at = serializers.DateTimeField(read_only=True)
    attendance_count = serializers.SerializerMethodField()
    speaker_contact = serializers.SerializerMethodField()

    def validate(self, attrs):
        # Only on the way in. A patch that leaves the speaker alone should
        # not have to resend details that are already stored.
        if self.instance is None:
            return _require_speaker_details(attrs)
        return attrs

    class Meta:
        model = Session
        fields = [
            'id', 'meeting', 'title', 'description', 'speaker_name', 'hall',
            'speaker_email', 'speaker_phone', 'speaker_visibility',
            'speaker_contact',
            'starts_at', 'duration_minutes', 'ends_at', 'position',
            'status', 'started_at', 'ended_at', 'attendance_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'ends_at', 'started_at', 'ended_at', 'speaker_contact',
            'attendance_count', 'created_at', 'updated_at',
        ]
        # Writable, but never read back with the session: who may see a
        # speaker's details is decided by its own endpoint.
        extra_kwargs = {
            'speaker_email': {'write_only': True},
            'speaker_phone': {'write_only': True},
        }

    def get_attendance_count(self, obj):
        return obj.attendance.count()

    def get_speaker_contact(self, obj):
        """The speaker's details, for the host of this meeting and nobody else.

        The organizer needs to see what they typed - it is their own
        programme - and needs it on the card that offers to make it public.
        Everyone else reads the details through the session's own contact
        endpoint, which weighs up visibility and approvals; this field is
        blank for them however they ask.
        """
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return None
        if str(obj.meeting.host_id) != str(user.id):
            return None
        return {'email': obj.speaker_email, 'phone': obj.speaker_phone}


class SessionWriteSerializer(serializers.ModelSerializer):
    """A session as written inside a meeting, where the parent is implied."""

    class Meta:
        model = Session
        fields = [
            'title', 'description', 'speaker_name', 'hall',
            'speaker_email', 'speaker_phone', 'speaker_visibility',
            'starts_at', 'duration_minutes', 'position',
        ]

    def validate(self, attrs):
        return _require_speaker_details(attrs)


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
    sessions = SessionWriteSerializer(many=True)
    # Only set when the meeting belongs to a programme; a standalone
    # meeting is created the same way, just without one.
    event = serializers.UUIDField(required=False, allow_null=True)

    def validate_sessions(self, sessions):
        if not sessions:
            raise serializers.ValidationError(
                'A meeting needs at least one session - it is what the meeting is for.'
            )
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
    """Create a whole programme in one request.

    The meetings are optional here - a programme can be set up first and
    filled in later - but any meeting given must bring its sessions.
    """
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
            build_meeting(meeting_data, event=event)

        return event


def build_meeting(data, *, event=None, host=None):
    """Create one meeting, along with the sessions that make it up.

    A meeting may sit inside a programme or stand on its own; the only
    difference is whether an event is passed. Its window is stretched to
    cover its sessions when they run past the length the organizer typed,
    so a session can never fall outside the meeting that contains it.
    """
    from src.apps.meetings.models import Meeting as MeetingModel
    from src.apps.meetings.services.meeting_service import MeetingService

    owner = host or (event.organizer if event else None)
    if owner is None:
        raise ValueError('A meeting needs a host, or an event to take one from.')

    from src.apps.meetings.scheduling import normalise_running_order

    # The order the organizer typed is kept; the times are spaced out so the
    # mandatory gap holds from the moment the meeting exists rather than
    # having to be corrected afterwards.
    sessions_data = normalise_running_order(
        data.get('sessions') or [], first_start=data['scheduled_start']
    )
    start = data['scheduled_start']
    end = start + timezone.timedelta(minutes=data.get('duration_minutes', 60))

    for index, session in enumerate(sessions_data):
        session_end = session['starts_at'] + timezone.timedelta(
            minutes=session.get('duration_minutes', 30)
        )
        end = max(end, session_end)

    meeting = MeetingModel.objects.create(
        event=event,
        host=owner,
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
            speaker_email=s.get('speaker_email', ''),
            speaker_phone=s.get('speaker_phone', ''),
            speaker_visibility=s.get('speaker_visibility', Session.SpeakerVisibility.PRIVATE),
            hall=s.get('hall', ''),
            starts_at=s['starts_at'],
            duration_minutes=s.get('duration_minutes', 30),
            position=s.get('position', index),
        )
        for index, s in enumerate(sessions_data)
    ])

    # A new meeting has to fit the day it joins, not just itself: if it
    # lands on an existing one, the later meetings give way. Same rule the
    # agenda applies when a session is dragged about.
    from src.apps.meetings.scheduling import reschedule

    reschedule(meeting, {})
    meeting.refresh_from_db()
    return meeting




class SessionAttendanceSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    is_guest = serializers.SerializerMethodField()
    person_id = serializers.SerializerMethodField()

    class Meta:
        model = SessionAttendance
        fields = [
            'id', 'session', 'person_id', 'name', 'is_guest',
            'marked_manually', 'recorded_at',
        ]

    def get_person_id(self, obj):
        """Who this is, across sessions.

        Counting by name would merge two people who share one, so the row
        carries the identity the record actually hangs on.
        """
        return str(obj.user_id or obj.guest_id)

    def get_name(self, obj):
        if obj.user:
            return obj.user.display_name or obj.user.email
        return obj.guest.full_name if obj.guest else '—'

    def get_is_guest(self, obj):
        return obj.guest_id is not None


class ContactRequestSerializer(serializers.ModelSerializer):
    """A request as the host sees it."""
    asker_name = serializers.SerializerMethodField()
    asker_is_guest = serializers.SerializerMethodField()
    session_title = serializers.CharField(source='session.title', read_only=True)
    speaker_name = serializers.CharField(source='session.speaker_name', read_only=True)
    meeting_title = serializers.CharField(source='session.meeting.title', read_only=True)
    meeting_id = serializers.UUIDField(source='session.meeting_id', read_only=True)

    class Meta:
        model = ContactRequest
        fields = [
            'id', 'session', 'session_title', 'speaker_name',
            'meeting_id', 'meeting_title',
            'asker_name', 'asker_is_guest', 'reason',
            'status', 'created_at', 'decided_at',
        ]

    def get_asker_name(self, obj):
        if obj.user:
            full = f"{obj.user.first_name} {obj.user.last_name}".strip()
            return full or obj.user.email
        return obj.guest.full_name if obj.guest else '—'

    def get_asker_is_guest(self, obj):
        return obj.guest_id is not None


class RoleGrantSerializer(serializers.ModelSerializer):
    """A role as the host sees it in the list."""
    scope = serializers.CharField(read_only=True)
    scope_title = serializers.SerializerMethodField()
    scope_id = serializers.SerializerMethodField()
    accepted = serializers.SerializerMethodField()

    class Meta:
        model = RoleGrant
        fields = [
            'id', 'email', 'role', 'scope', 'scope_id', 'scope_title',
            'accepted', 'created_at',
        ]

    def get_scope_title(self, obj):
        if obj.event_id:
            return obj.event.title
        if obj.meeting_id:
            return obj.meeting.title
        return f'{obj.session.title} ({obj.session.meeting.title})'

    def get_scope_id(self, obj):
        return str(obj.event_id or obj.meeting_id or obj.session_id)

    def get_accepted(self, obj):
        """Whether the address has turned into a real account yet."""
        return obj.user_id is not None


class SessionSummarySerializer(serializers.ModelSerializer):
    """A summary as the host reviews it, and as attendees read it."""
    session_title = serializers.CharField(source='session.title', read_only=True)
    is_published = serializers.BooleanField(read_only=True)
    saved = serializers.SerializerMethodField()

    class Meta:
        model = SessionSummary
        fields = [
            'session', 'session_title', 'body', 'status', 'is_published',
            'saved', 'published_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_saved(self, obj):
        """False only for the draft offered before anything was written."""
        return True
