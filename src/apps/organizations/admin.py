from django.contrib import admin
from .models import Organization, OrganizationMember, Subscription, WebhookEndpoint, AuditLog

@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'is_active', 'created_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('name', 'slug')

@admin.register(OrganizationMember)
class OrganizationMemberAdmin(admin.ModelAdmin):
    list_display = ('user', 'organization', 'role', 'is_active')
    list_filter = ('role', 'is_active')

@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('organization', 'tier', 'status', 'billing_email')
    list_filter = ('tier', 'status')

@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(admin.ModelAdmin):
    list_display = ('organization', 'url', 'is_active', 'last_triggered')
    list_filter = ('is_active',)

@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('organization', 'action', 'actor', 'created_at')
    list_filter = ('action', 'created_at')
    readonly_fields = ('id', 'created_at')
