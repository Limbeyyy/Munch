from django.db import models
from django.utils import timezone
from src.apps.accounts.models import User
import uuid

class Event(models.Model):
    """A day's programme, holding the meetings that make it up.

    An event is the thing people are invited to ("the Sunday conference");
    the meetings inside it are the rooms they actually join.
    """
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        ACTIVE = 'active', 'Active'
        ENDED = 'ended', 'Ended'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    organizer = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name='organized_events'
    )
    venue = models.CharField(max_length=255, blank=True)

    # The day the programme runs. Meetings carry their own times within it.
    event_date = models.DateField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-event_date', '-created_at']
        indexes = [models.Index(fields=['organizer', 'event_date'])]

    def __str__(self):
        return f"{self.title} ({self.event_date})"


class Meeting(models.Model):
    """
    Core meeting model - source of truth for meeting state
    """
    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        ACTIVE = 'active', 'Active'
        ENDED = 'ended', 'Ended'
        CANCELLED = 'cancelled', 'Cancelled'
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event,
        on_delete=models.CASCADE,
        related_name='meetings',
        null=True,
        blank=True,
        help_text='The programme this meeting belongs to, if any.',
    )
    meeting_code = models.CharField(max_length=20, unique=True, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    
    host = models.ForeignKey(User, on_delete=models.PROTECT, related_name='hosted_meetings')
    
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    
    # Google Drive resources
    drive_folder_id = models.CharField(max_length=255, null=True, blank=True)
    drive_metadata_file_id = models.CharField(max_length=255, null=True, blank=True)
    
    # Timing
    scheduled_start = models.DateTimeField()
    scheduled_end = models.DateTimeField()
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    
    # Settings
    max_participants = models.PositiveIntegerField(default=100)
    allow_recording = models.BooleanField(default=False)
    require_authentication = models.BooleanField(default=True)

    # Chat is opt-in: the host opens the room, and separately allows direct
    # messages to presenters within it.
    chat_enabled = models.BooleanField(default=False)
    direct_messages_enabled = models.BooleanField(default=False)
    
    # Metadata
    meeting_metadata = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'meetings'
        indexes = [
            models.Index(fields=['meeting_code']),
            models.Index(fields=['host']),
            models.Index(fields=['status']),
            models.Index(fields=['scheduled_start']),
        ]
    
    def __str__(self):
        return f"{self.meeting_code} - {self.title}"
    
    @property
    def is_active(self):
        """Check if meeting is currently active"""
        return self.status == self.Status.ACTIVE
    
    @property
    def duration_seconds(self):
        """Calculate meeting duration in seconds"""
        if self.started_at and self.ended_at:
            return (self.ended_at - self.started_at).total_seconds()
        return 0
    
    def get_participant_count(self):
        """Get current participant count"""
        return MeetingParticipant.objects.filter(
            meeting=self,
            is_active=True
        ).count()

class MeetingParticipant(models.Model):
    """
    Tracks meeting participants and their roles
    """
    class Role(models.TextChoices):
        HOST = 'host', 'Host'
        CO_HOST = 'co_host', 'Co-Host'
        PRESENTER = 'presenter', 'Presenter'
        ATTENDEE = 'attendee', 'Attendee'
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='meeting_participations')
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ATTENDEE)
    
    # Session tracking
    session_id = models.CharField(max_length=255, null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    is_muted = models.BooleanField(default=False)
    is_video_on = models.BooleanField(default=False)
    is_screen_sharing = models.BooleanField(default=False)
    
    # Metadata
    participant_metadata = models.JSONField(default=dict, blank=True)
    
    class Meta:
        db_table = 'meeting_participants'
        unique_together = [['meeting', 'user']]
        indexes = [
            models.Index(fields=['meeting']),
            models.Index(fields=['user']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return f"{self.user.email} - {self.meeting.meeting_code} ({self.role})"
    
    @property
    def is_online(self):
        """Check if participant is currently online"""
        return self.is_active and not self.left_at

class MeetingPermission(models.Model):
    """
    Fine-grained meeting access control
    """
    class Permission(models.TextChoices):
        VIEW_MEETING = 'view', 'View Meeting'
        JOIN_MEETING = 'join', 'Join Meeting'
        RECORD_MEETING = 'record', 'Record Meeting'
        SHARE_SCREEN = 'share_screen', 'Share Screen'
        MUTE_PARTICIPANTS = 'mute', 'Mute Participants'
        REMOVE_PARTICIPANTS = 'remove', 'Remove Participants'
        MANAGE_MEETING = 'manage', 'Manage Meeting'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='permissions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='meeting_permissions')
    permission = models.CharField(max_length=50, choices=Permission.choices)
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='permissions_granted')

    class Meta:
        db_table = 'meeting_permissions'
        unique_together = [['meeting', 'user', 'permission']]
        indexes = [
            models.Index(fields=['meeting', 'permission']),
            models.Index(fields=['user']),
        ]

    def __str__(self):
        return f"{self.user.email} - {self.permission} on {self.meeting.meeting_code}"

class ChatMessage(models.Model):
    """A message sent inside a meeting.

    A message with no recipient is public to the room; one with a recipient is
    a direct message and is only ever delivered to the sender and recipient.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='chat_messages')
    # A message comes from either an account holder or a guest, never both.
    sender = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='sent_chat_messages',
        null=True, blank=True,
    )
    guest_sender = models.ForeignKey(
        'GuestAttendee', on_delete=models.CASCADE,
        related_name='sent_chat_messages', null=True, blank=True,
    )

    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='received_chat_messages',
        null=True,
        blank=True,
        help_text="Null for a public room message",
    )
    guest_recipient = models.ForeignKey(
        'GuestAttendee', on_delete=models.CASCADE,
        related_name='received_chat_messages', null=True, blank=True,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Moderation(models.TextChoices):
        # Not subject to moderation - delivered immediately.
        NOT_REQUIRED = 'not_required', 'Not required'
        PENDING = 'pending', 'Awaiting host review'
        APPROVED = 'approved', 'Approved by host'
        DECLINED = 'declined', 'Declined by host'
        REMOVED = 'removed', 'Removed by host'

    moderation_status = models.CharField(
        max_length=20,
        choices=Moderation.choices,
        default=Moderation.NOT_REQUIRED,
        help_text="Direct messages from attendees are held for host review",
    )
    moderated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='moderated_chat_messages',
        null=True,
        blank=True,
    )
    moderated_at = models.DateTimeField(null=True, blank=True)

    class Topic(models.TextChoices):
        # Most messages are just messages.
        NONE = 'none', 'Not sorted'
        FAQ = 'faq', 'Question'
        SUGGESTION = 'suggestion', 'Suggestion'

    # What the host decided this message really is. Sorting a message onto
    # the board is a publishing decision, not a label: the board is read by
    # everyone in the meeting, so a private message put on it stops being
    # private. Nothing lands there without the host putting it there.
    topic = models.CharField(
        max_length=20,
        choices=Topic.choices,
        default=Topic.NONE,
        help_text="Questions and suggestions the host has put on the board",
    )

    class Meta:
        db_table = 'meeting_chat_messages'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['meeting', 'created_at']),
            models.Index(fields=['meeting', 'recipient']),
            models.Index(fields=['meeting', 'guest_recipient']),
            models.Index(fields=['meeting', 'moderation_status']),
            models.Index(fields=['meeting', 'topic']),
        ]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(sender__isnull=False, guest_sender__isnull=True)
                    | models.Q(sender__isnull=True, guest_sender__isnull=False)
                ),
                name='chat_message_exactly_one_sender',
            ),
            models.CheckConstraint(
                check=~models.Q(
                    recipient__isnull=False, guest_recipient__isnull=False
                ),
                name='chat_message_single_recipient',
            ),
        ]

    @property
    def is_direct(self) -> bool:
        return self.recipient_id is not None or self.guest_recipient_id is not None

    @property
    def sender_label(self) -> str:
        if self.guest_sender_id:
            return self.guest_sender.full_name
        return self.sender.display_name or self.sender.email

    @property
    def recipient_label(self):
        if self.guest_recipient_id:
            return self.guest_recipient.full_name
        if self.recipient_id:
            return self.recipient.display_name or self.recipient.email
        return None

    @property
    def is_deliverable(self) -> bool:
        """Whether the intended recipient may see this message."""
        return self.moderation_status in (
            self.Moderation.NOT_REQUIRED,
            self.Moderation.APPROVED,
        )

    def __str__(self):
        return f"{self.sender_label} -> {self.recipient_label or 'room'}"


class GuestAttendee(models.Model):
    """Someone joining by meeting code without an account.

    Guests must be admitted by the host before they can enter. They are not
    MeetingParticipants, which require a real user account.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Waiting for host'
        ADMITTED = 'admitted', 'Admitted'
        DENIED = 'denied', 'Denied'
        LEFT = 'left', 'Left'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='guests')
    full_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=32)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='decided_guest_requests',
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'meeting_guests'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['meeting', 'status']),
        ]

    @property
    def is_admitted(self) -> bool:
        return self.status == self.Status.ADMITTED

    def __str__(self):
        return f"{self.full_name} ({self.status}) @ {self.meeting.meeting_code}"


class MeetingInvite(models.Model):
    """An invitation link the host sent to a specific email address.

    The number of invites is the expected headcount; matching them against who
    actually turned up is what makes the attendance record meaningful.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='invites')
    email = models.EmailField()
    invited_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='sent_meeting_invites',
    )

    # Filled in when the invited address actually joins.
    joined_at = models.DateTimeField(null=True, blank=True)
    joined_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='accepted_meeting_invites',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'meeting_invites'
        ordering = ['created_at']
        unique_together = [['meeting', 'email']]
        indexes = [
            models.Index(fields=['meeting', 'joined_at']),
        ]

    @property
    def has_joined(self) -> bool:
        return self.joined_at is not None

    def __str__(self):
        state = 'joined' if self.has_joined else 'invited'
        return f"{self.email} ({state}) @ {self.meeting.meeting_code}"


class Session(models.Model):
    """A timed segment inside a meeting.

    People join the meeting, not the session: a session is a slot in the
    running order, so the room's code, chat and transcript stay on the
    meeting while the session says what is happening at that moment.
    """
    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        LIVE = 'live', 'Live'
        DONE = 'done', 'Done'
        SKIPPED = 'skipped', 'Skipped'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    meeting = models.ForeignKey(
        Meeting, on_delete=models.CASCADE, related_name='sessions'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    # Free text rather than a link to an account: speakers are often guests
    # of the institution who never sign in.
    speaker_name = models.CharField(max_length=255, blank=True)

    # How to reach the speaker once the day is over. Held against the
    # session rather than an account, for the same reason as the name.
    speaker_email = models.EmailField(blank=True)
    speaker_phone = models.CharField(max_length=40, blank=True)

    class SpeakerVisibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        PRIVATE = 'private', 'Private'

    # Whether attendees may simply read the speaker's details, or have to
    # ask the host first. Private is the default: handing out somebody's
    # phone number should be a decision, not an oversight.
    speaker_visibility = models.CharField(
        max_length=10,
        choices=SpeakerVisibility.choices,
        default=SpeakerVisibility.PRIVATE,
    )

    # Which room in the venue this runs in. Free text, because halls are
    # named differently at every venue and are not worth a table of their own.
    hall = models.CharField(max_length=255, blank=True)

    starts_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=30)

    # Keeps the running order stable when two sessions share a start time.
    position = models.PositiveIntegerField(default=0)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED
    )
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['starts_at', 'position']
        indexes = [models.Index(fields=['meeting', 'starts_at'])]

    def __str__(self):
        return f"{self.title} @ {self.starts_at:%H:%M}"

    @property
    def ends_at(self):
        return self.starts_at + timezone.timedelta(minutes=self.duration_minutes)


class SessionAttendance(models.Model):
    """Who was present for one session.

    Attendance is per session rather than per meeting, so a certificate can
    be judged on how much of the programme somebody actually sat through.
    A row exists only for people who were present.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name='attendance'
    )

    # Exactly one of these identifies the attendee: guests have no account.
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='session_attendance',
        null=True,
        blank=True,
    )
    guest = models.ForeignKey(
        'meetings.GuestAttendee',
        on_delete=models.CASCADE,
        related_name='session_attendance',
        null=True,
        blank=True,
    )

    # Recorded automatically from the room, or ticked off by an organizer.
    marked_manually = models.BooleanField(default=False)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, guest__isnull=True)
                    | models.Q(user__isnull=True, guest__isnull=False)
                ),
                name='session_attendance_exactly_one_attendee',
            ),
            models.UniqueConstraint(
                fields=['session', 'user'],
                condition=models.Q(user__isnull=False),
                name='session_attendance_unique_user',
            ),
            models.UniqueConstraint(
                fields=['session', 'guest'],
                condition=models.Q(guest__isnull=False),
                name='session_attendance_unique_guest',
            ),
        ]

    def __str__(self):
        who = self.user.email if self.user else (self.guest.full_name if self.guest else '?')
        return f"{who} @ {self.session.title}"


class ContactRequest(models.Model):
    """Somebody asking to be given a private speaker's details.

    A public speaker needs none of this - their details are readable once
    the session is over. A private one is reachable only through the host,
    who decides which requests are worth passing on.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name='contact_requests'
    )

    # Exactly one of these is the asker; guests have no account.
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='contact_requests',
        null=True,
        blank=True,
    )
    guest = models.ForeignKey(
        'meetings.GuestAttendee',
        on_delete=models.CASCADE,
        related_name='contact_requests',
        null=True,
        blank=True,
    )

    # Why they are asking. The host judges the request on this.
    reason = models.TextField(blank=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='contact_decisions',
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, guest__isnull=True)
                    | models.Q(user__isnull=True, guest__isnull=False)
                ),
                name='contact_request_exactly_one_asker',
            ),
            # One standing request per person per session: asking twice is
            # the same ask, and the host should see it once.
            models.UniqueConstraint(
                fields=['session', 'user'],
                condition=models.Q(user__isnull=False),
                name='contact_request_unique_user',
            ),
            models.UniqueConstraint(
                fields=['session', 'guest'],
                condition=models.Q(guest__isnull=False),
                name='contact_request_unique_guest',
            ),
        ]

    def __str__(self):
        who = self.user.email if self.user else (self.guest.full_name if self.guest else '?')
        return f"{who} -> {self.session.speaker_name} ({self.status})"


class RoleGrant(models.Model):
    """A role the host has given somebody, over one part of the programme.

    Two things make this its own table rather than a column on
    MeetingParticipant. It is addressed by email, so a co-host can be named
    before they have ever signed in; and it is scoped, which a participant
    row cannot be - that row only ever describes one meeting.

    The scope is exactly one of event, meeting or session, and it decides
    how far the role reaches and how long it lasts:

    * on an event, for every meeting and session inside that programme;
    * on a meeting, for that meeting and the sessions it holds;
    * on a session, for that session alone.

    Reach stops at the thing named. Somebody made co-host of the morning
    meeting is not a co-host of the evening one, and nothing about being
    co-host of one event carries into another. Giving them the role there
    too is a decision the host makes again.

    Speakers are not stored here. A session already names its speaker, and
    naming them is what makes them its presenter; keeping a second copy
    would only let the two drift apart.
    """
    class Role(models.TextChoices):
        CO_HOST = 'co_host', 'Co-host'
        PRESENTER = 'presenter', 'Presenter'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Who it is for. Held as an address because that is what the host knows
    # at the time; the account is linked once it turns up.
    email = models.EmailField()
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='role_grants',
        null=True,
        blank=True,
    )

    role = models.CharField(max_length=20, choices=Role.choices)

    # Exactly one of these three is set - see the constraint below.
    event = models.ForeignKey(
        'meetings.Event', on_delete=models.CASCADE,
        related_name='role_grants', null=True, blank=True,
    )
    meeting = models.ForeignKey(
        Meeting, on_delete=models.CASCADE,
        related_name='role_grants', null=True, blank=True,
    )
    session = models.ForeignKey(
        'meetings.Session', on_delete=models.CASCADE,
        related_name='role_grants', null=True, blank=True,
    )

    granted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='granted_roles',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'role_grants'
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                name='role_grant_has_exactly_one_scope',
                check=(
                    models.Q(event__isnull=False, meeting__isnull=True, session__isnull=True)
                    | models.Q(event__isnull=True, meeting__isnull=False, session__isnull=True)
                    | models.Q(event__isnull=True, meeting__isnull=True, session__isnull=False)
                ),
            ),
            # The same person cannot hold the same role twice over the same
            # thing. Given once is given.
            models.UniqueConstraint(
                fields=['email', 'role', 'event'],
                condition=models.Q(event__isnull=False),
                name='one_role_per_email_per_event',
            ),
            models.UniqueConstraint(
                fields=['email', 'role', 'meeting'],
                condition=models.Q(meeting__isnull=False),
                name='one_role_per_email_per_meeting',
            ),
            models.UniqueConstraint(
                fields=['email', 'role', 'session'],
                condition=models.Q(session__isnull=False),
                name='one_role_per_email_per_session',
            ),
        ]
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['event']),
            models.Index(fields=['meeting']),
            models.Index(fields=['session']),
        ]

    @property
    def scope(self) -> str:
        if self.event_id:
            return 'event'
        return 'meeting' if self.meeting_id else 'session'

    def __str__(self):
        return f"{self.email} as {self.role} on this {self.scope}"


class SessionSummary(models.Model):
    """What a session came to, in the host's words.

    The transcript is the raw record and stays untouched. This is the short
    account somebody writes from it - usually starting from the transcript,
    then cut down to the decisions and the numbers that matter.

    It is held back until the host publishes it. A summary is the thing
    attendees quote afterwards, so an unreviewed one going out would be
    worse than none at all.
    """
    class Status(models.TextChoices):
        NEEDS_APPROVAL = 'needs_approval', 'Needs approval'
        PUBLISHED = 'published', 'Published'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(
        'meetings.Session', on_delete=models.CASCADE, related_name='summary'
    )

    body = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.NEEDS_APPROVAL
    )

    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='edited_summaries',
    )
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'session_summaries'
        ordering = ['session__starts_at']

    @property
    def is_published(self) -> bool:
        return self.status == self.Status.PUBLISHED

    def __str__(self):
        return f"Summary of {self.session.title} ({self.status})"
