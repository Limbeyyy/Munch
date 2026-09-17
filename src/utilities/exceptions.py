"""
Custom exceptions for the event platform.
"""

class MeetingPlatformException(Exception):
    """Base exception for the event platform."""
    pass


class AccountException(MeetingPlatformException):
    """Exception for account-related errors (e.g., OAuth failures)."""
    pass


class MeetingException(MeetingPlatformException):
    """Exception for event-related errors (e.g., joining, ending)."""
    pass


class PermissionDeniedException(MeetingPlatformException):
    """Exception for permission errors (e.g., not allowed to access)."""
    pass


class DriveException(MeetingPlatformException):
    """Exception for Google Drive operations."""
    pass


class TokenExpiredException(DriveException):
    """Exception for expired OAuth tokens."""
    pass


class ArtifactException(MeetingPlatformException):
    """Exception for artifact (file) operations."""
    pass