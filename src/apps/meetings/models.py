from django.db import models
from django.utils import timezone
from src.apps.accounts.models import User
import uuid

class Event(models.Model):
    """A programme people join, and the running order inside it.

    An event is both the thing people are invited to and the room they
    actually enter: it carries the code on the invitation, the hours it
    runs between, and the sessions that make up its running order. There
    is nothing in between - a session belongs to an event directly.
    """
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        ACTIVE = 'active', 'Active'
        ENDED = 'ended', 'Ended'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # What is on the invitation, and what somebody types to get in.
    code = models.CharField(max_length=20, unique=True, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    host = models.ForeignKey(User, on_delete=models.PROTECT, related_name='hosted_events')

    venue = models.CharField(max_length=255, blank=True)
    # The day it runs. The hours within it are the two fields below.
    event_date = models.DateField()

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
    event_metadata = models.JSONField(default=dict, blank=True)

    # The guests who were admitted, kept as the register rather than as
    # rows about people.
    #
    # A guest's own row lasts as long as the event and is then deleted, so
    # this is what remains: a list of {"name", "at"} belonging to this
    # event and nothing else. It is attendance - who was in the hall that
    # afternoon - and it cannot be joined to anything, which is the point.
    # There is no guest to look up across events because there is no
    # guest, only a name on one register.
    guest_attendance = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'events'
        ordering = ['-event_date', '-created_at']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['host']),
            models.Index(fields=['status']),
            models.Index(fields=['scheduled_start']),
            models.Index(fields=['host', 'event_date']),
        ]

    def __str__(self):
        return f"{self.code} - {self.title}"

    @property
    def is_active(self):
        """Check if the event is currently under way"""
        return self.status == self.Status.ACTIVE

    @property
    def duration_seconds(self):
        """Calculate how long it actually ran, in seconds"""
        if self.started_at and self.ended_at:
            return (self.ended_at - self.started_at).total_seconds()
        return 0

    def get_participant_count(self):
        """Get current participant count"""
        return EventParticipant.objects.filter(
            event=self,
            is_active=True
        ).count()


class EventParticipant(models.Model):
    """
    Tracks event participants and their roles
    """
    class Role(models.TextChoices):
        HOST = 'host', 'Host'
        CO_HOST = 'co_host', 'Co-Host'
        PRESENTER = 'presenter', 'Presenter'
        ATTENDEE = 'attendee', 'Attendee'
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='event_participations')
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
        db_table = 'event_participants'
        unique_together = [['event', 'user']]
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return f"{self.user.email} - {self.event.code} ({self.role})"
    
    @property
    def is_online(self):
        """Check if participant is currently online"""
        return self.is_active and not self.left_at

class EventPermission(models.Model):
    """
    Fine-grained event access control
    """
    class Permission(models.TextChoices):
        VIEW_EVENT = 'view', 'View event'
        JOIN_EVENT = 'join', 'Join event'
        RECORD_EVENT = 'record', 'Record event'
        SHARE_SCREEN = 'share_screen', 'Share Screen'
        MUTE_PARTICIPANTS = 'mute', 'Mute Participants'
        REMOVE_PARTICIPANTS = 'remove', 'Remove Participants'
        MANAGE_EVENT = 'manage', 'Manage event'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='permissions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='event_permissions')
    permission = models.CharField(max_length=50, choices=Permission.choices)
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='permissions_granted')

    class Meta:
        db_table = 'event_permissions'
        unique_together = [['event', 'user', 'permission']]
        indexes = [
            models.Index(fields=['event', 'permission']),
            models.Index(fields=['user']),
        ]

    def __str__(self):
        return f"{self.user.email} - {self.permission} on {self.event.code}"

class ChatMessage(models.Model):
    """A message sent inside an event.

    A message with no recipient is public to the room; one with a recipient is
    a direct message and is only ever delivered to the sender and recipient.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='chat_messages')
    # A message comes from either an account holder or a guest, never both.
    sender = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='sent_chat_messages',
        null=True, blank=True,
    )
    # The guest's row goes when the event ends; what they wrote does
    # not. A question asked from the floor belongs to the event - it may
    # be on the board already - so the message keeps the name itself
    # rather than only pointing at somebody who will not be there.
    guest_sender = models.ForeignKey(
        'GuestAttendee', on_delete=models.SET_NULL,
        related_name='sent_chat_messages', null=True, blank=True,
    )
    guest_sender_name = models.CharField(max_length=120, blank=True, default='')

    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='received_chat_messages',
        null=True,
        blank=True,
        help_text="Null for a public room message",
    )
    guest_recipient = models.ForeignKey(
        'GuestAttendee', on_delete=models.SET_NULL,
        related_name='received_chat_messages', null=True, blank=True,
    )
    guest_recipient_name = models.CharField(max_length=120, blank=True, default='')
    #: Which part of the running order was on stage when this was written.
    #:
    #: A question belongs to the talk it was asked during - that is how
    #: the host reads a queue, and how the board sorts itself afterwards.
    #: Null where nothing was on stage, which is a question asked of the
    #: event at large rather than of any one talk.
    session = models.ForeignKey(
        'Session',
        on_delete=models.SET_NULL,
        related_name='chat_messages',
        null=True,
        blank=True,
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
    # everyone in the event, so a private message put on it stops being
    # private. Nothing lands there without the host putting it there.
    topic = models.CharField(
        max_length=20,
        choices=Topic.choices,
        default=Topic.NONE,
        help_text="Questions and suggestions the host has put on the board",
    )

    # The answer given from the front of the room. A question on the board
    # without one is only half of an exchange, and the answer is usually
    # what the rest of the room actually came for. Written whenever it
    # suits - mid-event, or days later.
    answer = models.TextField(blank=True)
    answered_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='answered_chat_messages',
        null=True,
        blank=True,
    )
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'event_chat_messages'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['event', 'created_at']),
            models.Index(fields=['event', 'recipient']),
            models.Index(fields=['event', 'guest_recipient']),
            models.Index(fields=['event', 'moderation_status']),
            models.Index(fields=['event', 'topic']),
        ]
        constraints = [
            # One or the other, never both. A message from a guest who has
            # since been forgotten has neither - what it has is their name,
            # which is what it needed the row for in the first place.
            models.CheckConstraint(
                check=~models.Q(sender__isnull=False, guest_sender__isnull=False),
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
        if self.guest_sender_name:
            # A guest who has been forgotten. What they asked is still
            # here, and still theirs.
            return self.guest_sender_name
        if self.sender_id:
            return self.sender.display_name or self.sender.email
        return 'Someone'

    @property
    def recipient_label(self):
        if self.guest_recipient_id:
            return self.guest_recipient.full_name
        if self.guest_recipient_name:
            return self.guest_recipient_name
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
    """Someone joining by event code without an account.

    Guests must be admitted by the host before they can enter. They are not
    EventParticipants, which require a real user account.

    These rows last as long as the event does and no longer. A guest gave
    a name at a door to sit in a hall for an afternoon; that is not a
    relationship with this platform, and keeping a row about them
    afterwards would make it one. When the event ends they are forgotten
    - see ``lifecycle.forget_guests`` - and what survives is the register:
    the name, against the sessions they were actually present for.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Waiting for host'
        ADMITTED = 'admitted', 'Admitted'
        DENIED = 'denied', 'Denied'
        LEFT = 'left', 'Left'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='guests')
    full_name = models.CharField(max_length=120)
    # Asked for once, and no longer. A name is what the host needs to
    # decide whether to let somebody in, and it is all the register keeps;
    # a telephone number was a piece of personal data collected for no
    # purpose either of them had. Kept on the model, blank, so the rows
    # that already carry one are not rewritten by this.
    phone = models.CharField(max_length=32, blank=True, default='')

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='decided_guest_requests',
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'event_guests'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['event', 'status']),
        ]

    @property
    def is_admitted(self) -> bool:
        return self.status == self.Status.ADMITTED

    def __str__(self):
        return f"{self.full_name} ({self.status}) @ {self.event.code}"


class EventInvite(models.Model):
    """An invitation link the host sent to a specific email address.

    The number of invites is the expected headcount; matching them against who
    actually turned up is what makes the attendance record meaningful.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='invites')
    email = models.EmailField()
    invited_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='sent_event_invites',
    )

    # Filled in when the invited address actually joins.
    joined_at = models.DateTimeField(null=True, blank=True)
    joined_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='accepted_event_invites',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'event_invites'
        ordering = ['created_at']
        unique_together = [['event', 'email']]
        indexes = [
            models.Index(fields=['event', 'joined_at']),
        ]

    @property
    def has_joined(self) -> bool:
        return self.joined_at is not None

    def __str__(self):
        state = 'joined' if self.has_joined else 'invited'
        return f"{self.email} ({state}) @ {self.event.code}"


class Session(models.Model):
    """A timed segment inside an event.

    People join the event, not the session: a session is a slot in the
    running order, so the room's code, chat and transcript stay on the
    event while the session says what is happening at that moment.
    """
    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        LIVE = 'live', 'Live'
        DONE = 'done', 'Done'
        SKIPPED = 'skipped', 'Skipped'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='sessions'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    # Free text rather than a link to an account: speakers are often guests
    # of the institution who never sign in.
    speaker_name = models.CharField(max_length=255, blank=True)

    # What they do, as it should read under their name on the running
    # order: "Director, Emergency Services". Free text for the same reason
    # the name is - a speaker is often somebody with no account here.
    speaker_role = models.CharField(max_length=255, blank=True)

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
        indexes = [models.Index(fields=['event', 'starts_at'])]

    def __str__(self):
        return f"{self.title} @ {self.starts_at:%H:%M}"

    @property
    def ends_at(self):
        return self.starts_at + timezone.timedelta(minutes=self.duration_minutes)


class SessionAttendance(models.Model):
    """Who was present for one session.

    Attendance is per session rather than per event, so a certificate can
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
    # The guest's row goes when the event ends; the register stays, so
    # it holds the name itself rather than only pointing at one.
    guest = models.ForeignKey(
        'meetings.GuestAttendee',
        on_delete=models.SET_NULL,
        related_name='session_attendance',
        null=True,
        blank=True,
    )
    guest_name = models.CharField(max_length=120, blank=True, default='')

    # Recorded automatically from the room, or ticked off by an organizer.
    marked_manually = models.BooleanField(default=False)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # One or the other, never both. A guest row that has been
            # forgotten leaves neither - the name is what identifies that
            # seat from then on.
            models.CheckConstraint(
                check=~models.Q(user__isnull=False, guest__isnull=False),
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
        if self.user:
            who = self.user.email
        else:
            who = self.guest.full_name if self.guest else (self.guest_name or '?')
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
    EventParticipant. It is addressed by email, so a co-host can be named
    before they have ever signed in; and it is scoped, which a participant
    row cannot be - that row only ever describes one event.

    The scope is exactly one of event or session, and it decides how far
    the role reaches and how long it lasts:

    * on an event, for every session inside that programme;
    * on a session, for that session alone.

    Reach stops at the thing named. Somebody made co-host of one event is
    not a co-host of the next, and being co-host of an event says nothing
    about the sessions of another. Giving them the role there too is a
    decision the host makes again.

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
                    models.Q(event__isnull=False, session__isnull=True)
                    | models.Q(event__isnull=True, session__isnull=False)
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
                fields=['email', 'role', 'session'],
                condition=models.Q(session__isnull=False),
                name='one_role_per_email_per_session',
            ),
        ]
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['event']),
            models.Index(fields=['session']),
        ]

    @property
    def scope(self) -> str:
        return 'event' if self.event_id else 'session'

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

    #: What somebody has to go and do, as ``{task, owner, due}`` rows.
    #: A decision with nobody's name against it is a note; the whole value
    #: of the list is that each line says who and by when, which is why
    #: they are held apart from the prose rather than buried in it.
    actions = models.JSONField(default=list, blank=True)

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


class HubPost(models.Model):
    """Something an attendee put into the hub: a question, an idea, a suggestion.

    One table rather than three, because they are the same shape - somebody
    writes a line, other people vote on it, and the organizer answers or
    acts. Only what they are *for* differs, and that is the kind.

    Where they go differs too. A question and an idea are read by the room,
    so they wait for the organizer to let them through. A suggestion is
    addressed to the organizer alone and is never shown to anybody else.
    """
    class Kind(models.TextChoices):
        QUESTION = 'question', 'Question'
        IDEA = 'idea', 'Idea'
        SUGGESTION = 'suggestion', 'Suggestion to the organizer'

    class Status(models.TextChoices):
        PENDING = 'pending', 'In moderation'
        PUBLISHED = 'published', 'Published'
        DECLINED = 'declined', 'Declined'
        # Suggestions end somewhere else: the organizer did something, or
        # is thinking about it.
        LOOKING = 'looking', 'Being looked at'
        ADDRESSED = 'addressed', 'Addressed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='hub_posts'
    )
    # Which part of the running order it was about, where that is known.
    session = models.ForeignKey(
        'meetings.Session', on_delete=models.SET_NULL,
        related_name='hub_posts', null=True, blank=True,
    )

    # Exactly one of these wrote it; guests have no account.
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='hub_posts',
        null=True, blank=True,
    )
    guest = models.ForeignKey(
        'meetings.GuestAttendee', on_delete=models.CASCADE,
        related_name='hub_posts', null=True, blank=True,
    )

    # Asked without a name against it. The author is still recorded - one
    # person gets one vote and one question - but it is not shown.
    anonymous = models.BooleanField(default=False)

    kind = models.CharField(max_length=20, choices=Kind.choices)
    body = models.TextField()

    # Suggestions are filed under a heading, so the organizer can see at a
    # glance what kind of thing people keep raising.
    category = models.CharField(max_length=40, blank=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )

    # The organizer's reply, shown under the question.
    answer = models.TextField(blank=True)
    answered_by = models.CharField(max_length=255, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hub_posts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['event', 'kind', 'status']),
            models.Index(fields=['session']),
        ]
        constraints = [
            models.CheckConstraint(
                name='hub_post_exactly_one_author',
                check=(
                    models.Q(user__isnull=False, guest__isnull=True)
                    | models.Q(user__isnull=True, guest__isnull=False)
                ),
            ),
        ]

    @property
    def author_label(self) -> str:
        """Who to show. Anonymous posts say only that somebody attending asked."""
        if self.anonymous:
            return 'Anonymous'
        if self.user:
            full = f"{self.user.first_name} {self.user.last_name}".strip()
            return full or self.user.email
        return self.guest.full_name if self.guest else 'Attendee'

    def __str__(self):
        return f"{self.kind}: {self.body[:40]}"


class HubVote(models.Model):
    """One person's opinion of one thing on a board.

    Held as a row per voter rather than a running total so that changing
    your mind is possible and voting twice is not. The score is worked out
    from these.

    Two kinds of thing can be voted on and they are the same kind of thing
    to a reader: a question somebody posted in the hub, and a private
    message the host put on the board. One table rather than two, so the
    rules about one vote each and changing your mind live in one place.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Exactly one of these is what the vote is about.
    post = models.ForeignKey(
        HubPost, on_delete=models.CASCADE, related_name='votes',
        null=True, blank=True,
    )
    message = models.ForeignKey(
        ChatMessage, on_delete=models.CASCADE, related_name='votes',
        null=True, blank=True,
    )

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='hub_votes',
        null=True, blank=True,
    )
    guest = models.ForeignKey(
        'meetings.GuestAttendee', on_delete=models.CASCADE,
        related_name='hub_votes', null=True, blank=True,
    )

    #: +1 for up, -1 for down. A withdrawn vote is deleted, not stored as 0.
    value = models.SmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hub_votes'
        constraints = [
            models.CheckConstraint(
                name='hub_vote_exactly_one_subject',
                check=(
                    models.Q(post__isnull=False, message__isnull=True)
                    | models.Q(post__isnull=True, message__isnull=False)
                ),
            ),
            models.CheckConstraint(
                name='hub_vote_exactly_one_voter',
                check=(
                    models.Q(user__isnull=False, guest__isnull=True)
                    | models.Q(user__isnull=True, guest__isnull=False)
                ),
            ),
            models.CheckConstraint(
                name='hub_vote_is_up_or_down',
                check=models.Q(value__in=[1, -1]),
            ),
            models.UniqueConstraint(
                fields=['post', 'user'],
                condition=models.Q(user__isnull=False, post__isnull=False),
                name='one_vote_per_person_per_post',
            ),
            models.UniqueConstraint(
                fields=['post', 'guest'],
                condition=models.Q(guest__isnull=False, post__isnull=False),
                name='one_vote_per_guest_per_post',
            ),
            models.UniqueConstraint(
                fields=['message', 'user'],
                condition=models.Q(user__isnull=False, message__isnull=False),
                name='one_vote_per_person_per_message',
            ),
            models.UniqueConstraint(
                fields=['message', 'guest'],
                condition=models.Q(guest__isnull=False, message__isnull=False),
                name='one_vote_per_guest_per_message',
            ),
        ]


class Reminder(models.Model):
    """A nudge somebody is owed before something they are part of happens.

    A row rather than a message fired and forgotten: a row can be shown in
    the app, marked as read, and written again without duplicating, none of
    which an email already sent can do.

    Two lead times, because two different things are being remembered. A
    event is somewhere you have to get to, so an hour's warning helps. A
    session is a talk inside an event you are probably already at, so
    fifteen minutes is enough - and an hour's warning for each of four
    talks would be noise.
    """
    class Kind(models.TextChoices):
        EVENT = 'event', 'Event starting'
        SESSION = 'session', 'Session starting'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reminders')

    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='reminders'
    )
    session = models.ForeignKey(
        'meetings.Session', on_delete=models.CASCADE,
        related_name='reminders', null=True, blank=True,
    )

    kind = models.CharField(max_length=20, choices=Kind.choices)

    #: When to tell them, and what it is they are being told about.
    due_at = models.DateTimeField()
    starts_at = models.DateTimeField()

    #: Set once it has actually been shown to them.
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'reminders'
        ordering = ['due_at']
        constraints = [
            # One reminder per person per thing. Regenerating after the
            # timetable moves updates the row rather than adding another.
            models.UniqueConstraint(
                fields=['user', 'event', 'kind'],
                condition=models.Q(session__isnull=True),
                name='one_event_reminder_per_person',
            ),
            models.UniqueConstraint(
                fields=['user', 'session', 'kind'],
                condition=models.Q(session__isnull=False),
                name='one_session_reminder_per_person',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'due_at']),
            models.Index(fields=['due_at', 'delivered_at']),
        ]

    @property
    def is_due(self) -> bool:
        from django.utils import timezone as tz

        return tz.now() >= self.due_at

    def __str__(self):
        return f"{self.kind} reminder for {self.user.email} at {self.due_at}"
