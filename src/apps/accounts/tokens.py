"""How long a sign-in lasts, and how it is carried forward.

The access token is short by design: it is renewed in the background, and
the user never sees it happen. What must not be open-ended is the sign-in
itself. Rotation issues a fresh refresh token each time, so left alone the
session would renew for ever - anyone using the app steadily would never be
asked to log in again.

So the moment somebody actually authenticated is stamped on the refresh
token and carried across every rotation. That stamp, not the token's own
expiry, is what decides when the session is over.
"""
from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

#: When the person behind this token last actually signed in, as a unix time.
SESSION_START_CLAIM = 'auth_time'


def session_length():
    return timezone.timedelta(hours=getattr(settings, 'AUTH_SESSION_HOURS', 8))


def issue_tokens(user):
    """Mint a fresh pair for somebody who has just proved who they are."""
    refresh = RefreshToken.for_user(user)
    refresh[SESSION_START_CLAIM] = int(timezone.now().timestamp())
    return {'access': str(refresh.access_token), 'refresh': str(refresh)}


def _session_started(token):
    """When this session began.

    Tokens minted before this claim existed fall back to when they were
    issued, which for those is the same thing.
    """
    stamped = token.payload.get(SESSION_START_CLAIM)
    if stamped is None:
        stamped = token.payload.get('iat')
    return int(stamped) if stamped is not None else None


def session_expired(token, now=None):
    started = _session_started(token)
    if started is None:
        # Nothing to judge it by. The token's own expiry still applies.
        return False
    now = now or timezone.now()
    return now.timestamp() - started > session_length().total_seconds()


class SessionRefreshSerializer(TokenRefreshSerializer):
    """Renew an access token, without letting the session outlive its cap.

    Everything about validating and rotating the refresh token is left to
    SimpleJWT. The two things added here are the ceiling on the session,
    and carrying the sign-in stamp onto the token that replaces this one -
    without which each rotation would quietly restart the clock.
    """

    def validate(self, attrs):
        try:
            incoming = RefreshToken(attrs['refresh'])
        except TokenError as error:
            raise InvalidToken(str(error))

        if session_expired(incoming):
            raise InvalidToken(
                f'This sign-in is more than '
                f'{int(session_length().total_seconds() // 3600)} hours old. '
                'Please sign in again.'
            )

        data = super().validate(attrs)

        rotated = data.get('refresh')
        if rotated:
            carried = RefreshToken(rotated)
            carried[SESSION_START_CLAIM] = _session_started(incoming)
            data['refresh'] = str(carried)

        return data
