"""Meeting permission classes for API access control"""
from rest_framework import permissions
from src.apps.meetings.models import Meeting, MeetingParticipant, MeetingPermission


class IsMeetingHost(permissions.BasePermission):
    """Allow only the meeting host"""

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Meeting):
            return obj.host == request.user
        return False


class IsMeetingParticipant(permissions.BasePermission):
    """Allow meeting host or active participants"""

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Meeting):
            if obj.host == request.user:
                return True

            return MeetingParticipant.objects.filter(
                meeting=obj,
                user=request.user,
                is_active=True
            ).exists()

        return False


class HasMeetingPermission(permissions.BasePermission):
    """Check if user has specific permission for meeting"""

    def __init__(self, permission_name):
        self.permission_name = permission_name

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Meeting):
            # Host always has all permissions
            if obj.host == request.user:
                return True

            # Check explicit permission
            return MeetingPermission.objects.filter(
                meeting=obj,
                user=request.user,
                permission=self.permission_name
            ).exists()

        return False


class CanRecordMeeting(HasMeetingPermission):
    """Permission to record meeting"""

    def __init__(self):
        super().__init__(MeetingPermission.Permission.RECORD_MEETING)


class CanManageMeeting(HasMeetingPermission):
    """Permission to manage meeting settings"""

    def __init__(self):
        super().__init__(MeetingPermission.Permission.MANAGE_MEETING)


class CanMuteParticipants(HasMeetingPermission):
    """Permission to mute participants"""

    def __init__(self):
        super().__init__(MeetingPermission.Permission.MUTE_PARTICIPANTS)
