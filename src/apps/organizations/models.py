"""Multi-tenant organization and enterprise models"""
from django.db import models
from src.apps.accounts.models import User
import uuid


class Organization(models.Model):
    """Multi-tenant organization"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='owned_organizations')

    description = models.TextField(blank=True)
    logo_url = models.URLField(max_length=500, null=True, blank=True)
    website = models.URLField(max_length=500, null=True, blank=True)

    settings = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'organizations'
        indexes = [models.Index(fields=['slug']), models.Index(fields=['owner'])]

    def __str__(self):
        return self.name


class OrganizationMember(models.Model):
    """Organization membership"""
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        MANAGER = 'manager', 'Manager'
        MEMBER = 'member', 'Member'
        VIEWER = 'viewer', 'Viewer'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='organization_memberships')
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)

    invited_at = models.DateTimeField(auto_now_add=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'organization_members'
        unique_together = [['organization', 'user']]

    def __str__(self):
        return f"{self.user.email} - {self.organization.name} ({self.role})"


class Subscription(models.Model):
    """Billing subscription"""
    class Tier(models.TextChoices):
        FREE = 'free', 'Free'
        PRO = 'pro', 'Pro'
        ENTERPRISE = 'enterprise', 'Enterprise'

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        CANCELED = 'canceled', 'Canceled'
        EXPIRED = 'expired', 'Expired'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name='subscription')

    tier = models.CharField(max_length=20, choices=Tier.choices, default=Tier.FREE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    stripe_subscription_id = models.CharField(max_length=255, null=True, blank=True)
    stripe_customer_id = models.CharField(max_length=255, null=True, blank=True)

    billing_email = models.EmailField()
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at = models.DateTimeField(null=True, blank=True)

    metadata = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'subscriptions'

    def __str__(self):
        return f"{self.organization.name} - {self.tier}"


class WebhookEndpoint(models.Model):
    """Webhook endpoint for external integrations"""
    class Event(models.TextChoices):
        MEETING_CREATED = 'meeting.created'
        MEETING_STARTED = 'meeting.started'
        MEETING_ENDED = 'meeting.ended'
        RECORDING_READY = 'recording.ready'
        TRANSCRIPT_READY = 'transcript.ready'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='webhooks')

    url = models.URLField(max_length=500)
    events = models.JSONField(default=list, help_text="List of event types to subscribe to")

    secret_key = models.CharField(max_length=255, default=uuid.uuid4)
    is_active = models.BooleanField(default=True)

    retry_count = models.IntegerField(default=0)
    last_error = models.TextField(blank=True)
    last_triggered = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'webhook_endpoints'

    def __str__(self):
        return f"Webhook: {self.organization.name} -> {self.url}"


class AuditLog(models.Model):
    """Organization audit trail"""
    class Action(models.TextChoices):
        CREATE_MEETING = 'create_meeting'
        DELETE_MEETING = 'delete_meeting'
        UPDATE_SETTINGS = 'update_settings'
        ADD_MEMBER = 'add_member'
        REMOVE_MEMBER = 'remove_member'
        UPGRADE_SUBSCRIPTION = 'upgrade_subscription'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='audit_logs')
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='audit_logs_created')

    action = models.CharField(max_length=50, choices=Action.choices)
    resource_type = models.CharField(max_length=50)  # e.g., 'Meeting', 'User'
    resource_id = models.CharField(max_length=255)

    changes = models.JSONField(default=dict, help_text="Before/after values")
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_logs'
        indexes = [models.Index(fields=['organization', 'created_at'])]

    def __str__(self):
        return f"{self.organization.name} - {self.action} - {self.created_at}"
