from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone
from django.core.validators import EmailValidator
from src.utilities.utils import encrypt_token, decrypt_token
import uuid

class User(AbstractUser):
    """
    Custom User model with Google OAuth integration
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, validators=[EmailValidator()])
    google_subject = models.CharField(max_length=255, unique=True, null=True, blank=True)
    avatar_url = models.URLField(max_length=500, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Application-specific fields
    preferred_language = models.CharField(max_length=10, default='en')
    timezone = models.CharField(max_length=50, default='UTC')
    notification_preferences = models.JSONField(default=dict, blank=True)
    
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']
    
    class Meta:
        db_table = 'users'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['google_subject']),
        ]
    
    def __str__(self):
        return f"{self.email} ({self.get_full_name()})"
    
    @property
    def display_name(self):
        return self.get_full_name() or self.email
    
    def get_google_connection(self):
        """Get the user's Google connection"""
        return GoogleConnection.objects.filter(user=self, is_active=True).first()

class GoogleConnection(models.Model):
    """
    Stores Google OAuth connection details securely
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='google_connections')
    provider = models.CharField(max_length=50, default='google')
    provider_subject = models.CharField(max_length=255, unique=True)
    
    # Encrypted tokens
    _access_token = models.TextField(db_column='access_token_encrypted')
    _refresh_token = models.TextField(db_column='refresh_token_encrypted', null=True, blank=True)
    
    token_expiry = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'google_connections'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['provider_subject']),
        ]
    
    @property
    def access_token(self):
        """Decrypt and return access token"""
        return decrypt_token(self._access_token) if self._access_token else None
    
    @access_token.setter
    def access_token(self, value):
        """Encrypt and store access token"""
        self._access_token = encrypt_token(value) if value else None
    
    @property
    def refresh_token(self):
        """Decrypt and return refresh token"""
        return decrypt_token(self._refresh_token) if self._refresh_token else None
    
    @refresh_token.setter
    def refresh_token(self, value):
        """Encrypt and store refresh token"""
        self._refresh_token = encrypt_token(value) if value else None
    
    def is_token_expired(self):
        """Check if the current token is expired"""
        if not self.token_expiry:
            return True
        return timezone.now() >= self.token_expiry
    
    def __str__(self):
        return f"Google connection for {self.user.email}"

class GoogleConnectionScope(models.Model):
    """
    Track granular OAuth scopes for each connection
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    connection = models.ForeignKey(GoogleConnection, on_delete=models.CASCADE, related_name='scope_grants')
    scope = models.CharField(max_length=500)
    granted_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)
    is_revoked = models.BooleanField(default=False)

    class Meta:
        db_table = 'google_connection_scopes'
        unique_together = [['connection', 'scope']]
        indexes = [
            models.Index(fields=['connection', 'is_revoked']),
        ]

    def __str__(self):
        return f"{self.scope} for {self.connection.user.email}"

class HostAccount(models.Model):
    """Marks a user as a host, and says what they are paying for.

    Its presence is what makes someone a host: choosing to host for the first
    time creates one on the free trial. The plan named here only counts while
    the subscription is live — a lapsed one falls back to free rather than
    locking the host out of what they already run.
    """
    class Plan(models.TextChoices):
        FREE = 'free', 'Free'
        STARTER = 'starter', 'Starter'
        GROWTH = 'growth', 'Growth'
        BUSINESS = 'business', 'Business'
        ENTERPRISE = 'enterprise', 'Enterprise'

    class Status(models.TextChoices):
        TRIAL = 'trial', 'Trial'
        ACTIVE = 'active', 'Active'
        CANCELED = 'canceled', 'Canceled'
        EXPIRED = 'expired', 'Expired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='host_account')

    plan = models.CharField(max_length=20, choices=Plan.choices, default=Plan.FREE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TRIAL)

    #: The breathing room this host wants between one session and the next.
    #: Fifteen minutes was the rule for everybody; some halls need longer to
    #: clear and some programmes run back to back, so it is theirs to set.
    session_gap_minutes = models.PositiveSmallIntegerField(default=15)

    #: How much warning this host's programme gives. A meeting is called
    #: further ahead than a talk inside it, because people travel to the
    #: first and walk down a corridor to the second - but how much further
    #: depends on the event, so both are theirs to set.
    meeting_reminder_minutes = models.PositiveSmallIntegerField(default=60)
    session_reminder_minutes = models.PositiveSmallIntegerField(default=15)
    #: Off means the programme sends none at all.
    reminders_enabled = models.BooleanField(default=True)

    started_at = models.DateTimeField(auto_now_add=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'host_accounts'

    def __str__(self):
        return f"{self.user.email} - {self.plan}"

    @property
    def is_current(self) -> bool:
        """Whether the paid plan is still in force."""
        from django.utils import timezone

        if self.status not in (self.Status.TRIAL, self.Status.ACTIVE):
            return False
        if self.current_period_end and self.current_period_end < timezone.now():
            return False
        return True


class UpgradeRequest(models.Model):
    """Somebody asking to move to a bigger plan.

    There is no checkout yet, and a button that silently does nothing is
    worse than no button. This records the ask so it can be actioned - by
    the operator, with set_host_plan - and so the person can see that it
    was heard rather than wondering.
    """
    class Status(models.TextChoices):
        ASKED = 'asked', 'Asked'
        DONE = 'done', 'Applied'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='upgrade_requests'
    )

    #: The plan they are asking for, from accounts.plans.
    plan = models.CharField(max_length=20)
    #: What they were on when they asked, so the ask still makes sense later.
    from_plan = models.CharField(max_length=20, blank=True)
    note = models.TextField(blank=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ASKED
    )
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'upgrade_requests'
        ordering = ['-created_at']
        constraints = [
            # One open ask per person per plan: pressing twice is not two
            # requests.
            models.UniqueConstraint(
                fields=['user', 'plan'],
                condition=models.Q(status='asked'),
                name='one_open_upgrade_request_per_plan',
            ),
        ]

    def __str__(self):
        return f"{self.user.email} -> {self.plan} ({self.status})"
