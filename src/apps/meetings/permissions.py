"""Event permission classes for API access control"""
from rest_framework import permissions
from src.apps.meetings.models import Event, EventParticipant, EventPermission


class IsMeetingHost(permissions.BasePermission):
    """Allow only the event host"""

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Event):
            return obj.host == request.user
        return False


class IsMeetingParticipant(permissions.BasePermission):
    """Allow event host or active participants"""

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Event):
            if obj.host == request.user:
                return True

            return EventParticipant.objects.filter(
                event=obj,
                user=request.user,
                is_active=True
            ).exists()

        return False


class HasMeetingPermission(permissions.BasePermission):
    """Check if user has specific permission for event"""

    def __init__(self, permission_name):
        self.permission_name = permission_name

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Event):
            # Host always has all permissions
            if obj.host == request.user:
                return True

            # Check explicit permission
            return EventPermission.objects.filter(
                event=obj,
                user=request.user,
                permission=self.permission_name
            ).exists()

        return False


class CanRecordMeeting(HasMeetingPermission):
    """Permission to record event"""

    def __init__(self):
        super().__init__(EventPermission.Permission.RECORD_MEETING)


class CanManageMeeting(HasMeetingPermission):
    """Permission to manage event settings"""

    def __init__(self):
        super().__init__(EventPermission.Permission.MANAGE_MEETING)


class CanMuteParticipants(HasMeetingPermission):
    """Permission to mute participants"""

    def __init__(self):
        super().__init__(EventPermission.Permission.MUTE_PARTICIPANTS)
