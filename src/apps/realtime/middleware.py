"""JWT authentication for WebSocket connections."""
import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


@database_sync_to_async
def _resolve_user(raw_token: str):
    """Validate a SimpleJWT access token and return its user.

    Returns None when the token is missing, malformed, expired, or points at
    a user that no longer exists.
    """
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    try:
        token = AccessToken(raw_token)
    except TokenError as e:
        logger.warning(f"Rejected websocket token: {e}")
        return None

    user_id = token.get('user_id')
    if not user_id:
        return None

    User = get_user_model()
    try:
        return User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        logger.warning(f"Websocket token references unknown user {user_id}")
        return None


@database_sync_to_async
def _resolve_guest(raw_token: str):
    """Return a lightweight description of the guest a token names.

    Only admitted guests are treated as present in the meeting; everyone else
    is still in the waiting room.
    """
    from src.apps.meetings.guest_tokens import resolve_guest

    guest = resolve_guest(raw_token)
    if guest is None:
        return None
    return {
        'id': str(guest.id),
        'name': guest.full_name,
        'meeting_code': guest.meeting.meeting_code,
        'status': guest.status,
    }


class JWTAuthMiddleware(BaseMiddleware):
    """Populate ``scope['user']`` from a SimpleJWT access token.

    A browser cannot set an Authorization header on a websocket handshake, so
    the token travels in the query string (``?token=...``) instead. Any user
    already resolved by session auth is left in place when no token is sent.
    """

    async def __call__(self, scope, receive, send):
        token = self._extract_token(scope)

        if token:
            user = await _resolve_user(token)
            scope['user'] = user if user is not None else AnonymousUser()
        elif 'user' not in scope:
            scope['user'] = AnonymousUser()

        # A guest has no account; identify them by their signed guest token.
        guest_token = self._extract_param(scope, 'guest_token')
        scope['guest'] = await _resolve_guest(guest_token) if guest_token else None

        return await super().__call__(scope, receive, send)

    @staticmethod
    def _extract_param(scope, name):
        query_string = scope.get('query_string', b'').decode()
        return parse_qs(query_string).get(name, [None])[0]

    @staticmethod
    def _extract_token(scope):
        query_string = scope.get('query_string', b'').decode()
        token = parse_qs(query_string).get('token', [None])[0]
        if token:
            return token

        # Also accept the `Sec-WebSocket-Protocol: jwt, <token>` convention.
        subprotocols = scope.get('subprotocols') or []
        if len(subprotocols) >= 2 and subprotocols[0] == 'jwt':
            return subprotocols[1]

        return None


def JWTAuthMiddlewareStack(inner):
    """Session auth first, with JWT taking precedence when a token is sent."""
    from channels.auth import AuthMiddlewareStack

    return AuthMiddlewareStack(JWTAuthMiddleware(inner))
