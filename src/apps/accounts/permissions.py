from rest_framework import permissions

class IsOwnUser(permissions.BasePermission):
    """
    Permission to allow users to access only their own data
    """
    def has_object_permission(self, request, view, obj):
        return obj == request.user

class HasGoogleConnection(permissions.BasePermission):
    """
    Permission to check if user has a Google connection
    """
    def has_permission(self, request, view):
        return hasattr(request.user, 'google_connections') and \
               request.user.google_connections.filter(is_active=True).exists()