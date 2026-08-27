from django.db import models
from django.utils import timezone
from src.apps.accounts.models import User
import uuid

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

    class Meta:
        db_table = 'meeting_chat_messages'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['meeting', 'created_at']),
            models.Index(fields=['meeting', 'recipient']),
            models.Index(fields=['meeting', 'guest_recipient']),
            models.Index(fields=['meeting', 'moderation_status']),
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
