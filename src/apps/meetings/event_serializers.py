"""Serializers for the event / session hierarchy.

An event is created whole: the organizer describes the day and the
sessions inside it, and the server writes the lot in one transaction so a
half-built programme never reaches the database.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from src.apps.meetings.serializers import EventSerializer as RoomEventSerializer

from src.apps.meetings.models import (
    RoleGrant,
    SessionSummary,
    ContactRequest, Event, Session, SessionAttendance,
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
    #: The speaker's photograph, so every screen that names them can show
    #: them without going and fetching the profile itself.
    speaker_photo_url = serializers.SerializerMethodField()

    def validate(self, attrs):
        # Only on the way in. A patch that leaves the speaker alone should
        # not have to resend details that are already stored.
        if self.instance is None:
            return _require_speaker_details(attrs)
        return attrs

    class Meta:
        model = Session
        fields = [
            'id', 'event', 'title', 'description', 'speaker_name', 'speaker_role',
            'speaker_email', 'speaker_phone', 'speaker_visibility',
            'speaker_contact', 'speaker', 'speaker_photo_url',
            'starts_at', 'duration_minutes', 'ends_at', 'position',
            'status', 'started_at', 'ended_at', 'attendance_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'ends_at', 'started_at', 'ended_at', 'speaker_contact',
            'speaker_photo_url', 'attendance_count', 'created_at', 'updated_at',
        ]

        # Writable, but never read back with the session: who may see a
        # speaker's details is decided by its own endpoint.
        extra_kwargs = {
            'speaker_email': {'write_only': True},
            'speaker_phone': {'write_only': True},
        }

    def get_speaker_photo_url(self, obj):
        profile = obj.speaker
        if profile is None or not profile.photo:
            return None
        request = self.context.get('request')
        url = profile.photo.url
        return request.build_absolute_uri(url) if request else url

    def get_attendance_count(self, obj):
        return obj.attendance.count()

    def get_speaker_contact(self, obj):
        """The speaker's details, for the host of this event and nobody else.

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
        if str(obj.event.host_id) != str(user.id):
            return None
        return {'email': obj.speaker_email, 'phone': obj.speaker_phone}


class SessionWriteSerializer(serializers.ModelSerializer):
    """A session as written inside an event, where the parent is implied."""

    class Meta:
        model = Session
        fields = [
            'title', 'description', 'speaker_name', 'speaker_role',
            'speaker_email', 'speaker_phone', 'speaker_visibility',
            'starts_at', 'duration_minutes', 'position',
        ]

    def validate(self, attrs):
        return _require_speaker_details(attrs)


class EventSummarySerializer(serializers.ModelSerializer):
    """An event with its running order, as it appears in a list."""
    sessions = SessionSerializer(many=True, read_only=True)
    session_count = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id', 'code', 'title', 'description', 'status',
            'scheduled_start', 'scheduled_end', 'started_at', 'ended_at',
            'participant_count', 'sessions', 'session_count',
        ]

    def get_session_count(self, obj):
        return obj.sessions.count()

    def get_participant_count(self, obj):
        return obj.participants.filter(is_active=True).count()


class EventWriteSerializer(serializers.Serializer):
    """An event being created, together with the sessions inside it."""
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    venue = serializers.CharField(required=False, allow_blank=True, default='')
    event_date = serializers.DateField(required=False)
    scheduled_start = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(min_value=5, default=60)
    sessions = SessionWriteSerializer(many=True, required=False, default=list)

    def validate_sessions(self, sessions):
        if len(sessions) > 50:
            raise serializers.ValidationError('An event can hold at most 50 sessions.')
        return sessions


class EventSerializer(RoomEventSerializer):
    """One event, whole: what it is, when it runs, and what runs in it.

    It is the room serializer with the programme half added, because an
    event is one thing - the code on the invitation and the running order
    are the same row, so they are read in one request.
    """
    sessions = SessionSerializer(many=True, read_only=True)
    host_email = serializers.EmailField(source='host.email', read_only=True)
    session_count = serializers.SerializerMethodField()

    class Meta(RoomEventSerializer.Meta):
        fields = RoomEventSerializer.Meta.fields + [
            'venue', 'event_date', 'host_email', 'sessions', 'session_count',
        ]

    def get_session_count(self, obj):
        return obj.sessions.count()


class EventCreateSerializer(serializers.ModelSerializer):
    """Create a whole event in one request.

    The sessions are optional - an event can be set up first and filled in
    later - but it arrives with whatever running order was typed.
    """
    sessions = SessionWriteSerializer(many=True, required=False, default=list)
    scheduled_start = serializers.DateTimeField(required=False)
    duration_minutes = serializers.IntegerField(min_value=5, required=False, default=60)

    class Meta:
        model = Event
        fields = [
            'title', 'description', 'venue', 'event_date', 'status',
            'scheduled_start', 'duration_minutes', 'sessions',
        ]

    def validate_sessions(self, sessions):
        if len(sessions) > 50:
            raise serializers.ValidationError('An event can hold at most 50 sessions.')
        return sessions

    @transaction.atomic
    def create(self, validated_data):
        return build_event(validated_data, host=self.context['request'].user)


def build_event(data, *, host):
    """Create one event, along with the sessions that make it up.

    Its window is stretched to cover its sessions when they run past the
    length the organizer typed, so a session can never fall outside the
    event that contains it.
    """
    from src.apps.meetings.models import Event as EventModel
    from src.apps.meetings.services.event_service import EventService

    if host is None:
        raise ValueError('An event needs a host.')

    from src.apps.meetings.scheduling import normalise_running_order

    # The order the organizer typed is kept; the times are spaced out so the
    # mandatory gap holds from the moment the event exists rather than
    # having to be corrected afterwards. The host's own interval, since the
    # event does not exist yet to be asked for it.
    account = getattr(host, 'host_account', None)
    spacing = timezone.timedelta(
        minutes=account.session_gap_minutes if account else 15
    )
    start = data.get('scheduled_start') or timezone.now()
    sessions_data = normalise_running_order(
        data.get('sessions') or [],
        first_start=start,
        gap=spacing,
    )
    end = start + timezone.timedelta(minutes=data.get('duration_minutes', 60) or 60)

    for session in sessions_data:
        session_end = session['starts_at'] + timezone.timedelta(
            minutes=session.get('duration_minutes', 30)
        )
        end = max(end, session_end)

    event = EventModel.objects.create(
        host=host,
        title=data['title'],
        description=data.get('description', ''),
        venue=data.get('venue', ''),
        event_date=data.get('event_date') or timezone.localdate(start),
        status=data.get('status', EventModel.Status.SCHEDULED),
        scheduled_start=start,
        scheduled_end=end,
        code=EventService.generate_code(),
    )

    Session.objects.bulk_create([
        Session(
            event=event,
            title=s['title'],
            description=s.get('description', ''),
            speaker_name=s.get('speaker_name', ''),
            speaker_role=s.get('speaker_role', ''),
            speaker_email=s.get('speaker_email', ''),
            speaker_phone=s.get('speaker_phone', ''),
            speaker_visibility=s.get('speaker_visibility', Session.SpeakerVisibility.PRIVATE),
            starts_at=s['starts_at'],
            duration_minutes=s.get('duration_minutes', 30),
            position=s.get('position', index),
        )
        for index, s in enumerate(sessions_data)
    ])

    return event


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
    event_title = serializers.CharField(source='session.event.title', read_only=True)
    event_id = serializers.UUIDField(source='session.event_id', read_only=True)

    class Meta:
        model = ContactRequest
        fields = [
            'id', 'session', 'session_title', 'speaker_name',
            'event_id', 'event_title',
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
        return f'{obj.session.title} ({obj.session.event.title})'

    def get_scope_id(self, obj):
        return str(obj.event_id or obj.session_id)

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
            'session', 'session_title', 'body', 'actions', 'status',
            'is_published', 'saved', 'published_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_saved(self, obj):
        """False only for the draft offered before anything was written."""
        return True
