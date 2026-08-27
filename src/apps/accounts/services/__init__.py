"""Account services"""
import secrets
import logging
from urllib.parse import urlencode
from django.conf import settings
from requests_oauthlib import OAuth2Session
from .oauth_service import OAuthService

logger = logging.getLogger(__name__)


class AccountService:
    """Wrapper service for account operations"""

    def __init__(self):
        self.oauth = OAuthService()

    def disconnect_google(self, user):
        """Disconnect Google account"""
        return OAuthService.disconnect_google(user)

    def get_google_auth_url(self, redirect_uri):
        """Get Google OAuth URL"""
        client_id = settings.GOOGLE_CLIENT_ID
        scopes = [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.metadata.readonly',
        ]

        params = {
            'client_id': client_id,
            'redirect_uri': redirect_uri,
            'response_type': 'code',
            'scope': ' '.join(scopes),
            'access_type': 'offline',
            'prompt': 'consent',
            'state': secrets.token_urlsafe(32),
        }

        query_string = urlencode(params)
        auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + query_string
        logger.info(f"Generated OAuth URL with client_id: {client_id}")
        return auth_url

    def handle_google_callback(self, code, redirect_uri, state):
        """Handle OAuth callback - exchange code for tokens and create/update user"""
        try:
            client_id = settings.GOOGLE_CLIENT_ID
            client_secret = settings.GOOGLE_CLIENT_SECRET
            token_url = 'https://oauth2.googleapis.com/token'

            # Exchange code for tokens
            oauth = OAuth2Session(client_id, redirect_uri=redirect_uri)
            token = oauth.fetch_token(
                token_url=token_url,
                code=code,
                client_secret=client_secret,
            )

            # Get user info from Google
            user_info = oauth.get('https://www.googleapis.com/oauth2/v2/userinfo').json()

            # Call OAuthService to handle user creation/update
            user, connection = OAuthService.handle_oauth_callback(user_info)

            # Create/update Google connection with tokens
            if token.get('access_token'):
                OAuthService.create_google_connection(
                    user=user,
                    google_subject=user_info.get('id'),
                    access_token=token.get('access_token'),
                    refresh_token=token.get('refresh_token'),
                    scopes=settings.GOOGLE_DRIVE_SCOPES,
                )

            return {'user': user, 'connection': connection}
        except Exception as e:
            logger.error(f"Google callback error: {str(e)}", exc_info=True)
            return {'error': str(e)}
