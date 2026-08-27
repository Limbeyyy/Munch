"""
Account services for Google OAuth, user management, and token handling.
"""
import logging
import secrets
from typing import Optional, Dict, Any
from urllib.parse import urlencode
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.conf import settings
from django.utils import timezone
from django.db import transaction
from requests_oauthlib import OAuth2Session
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

from src.apps.accounts.models import GoogleConnection
from src.utilities.utils import encrypt_token, decrypt_token
from src.utilities.exceptions import AccountException

User = get_user_model()
logger = logging.getLogger(__name__)


class AccountService:
    """
    Handles Google OAuth flow, user lookup/creation, and token management.
    """

    def get_google_auth_url(self, redirect_uri: str) -> str:
        """
        Generate the Google OAuth 2.0 authorization URL.

        Args:
            redirect_uri: The callback URL where Google redirects after auth

        Returns:
            str: The full authorization URL
        """
        client_id = settings.GOOGLE_CLIENT_ID
        logger.info(f"Client ID: {client_id}")

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

        logger.info(f"Params: {params}")
        query_string = urlencode(params)
        logger.info(f"Query string: {query_string}")

        auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + query_string
        logger.info(f"Generated auth URL: {auth_url}")
        return auth_url

    @transaction.atomic
    def handle_google_callback(
        self, code: str, redirect_uri: str, state: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Exchange authorization code for tokens, find or create user,
        and store the Google connection.

        Args:
            code: The authorization code from Google
            redirect_uri: The redirect URI used in the initial request
            state: The state parameter (optional, for CSRF verification)

        Returns:
            dict: Contains 'user' and 'connection' if successful,
                  or 'error' if something fails.
        """
        try:
            # Exchange code for tokens using OAuth2Session
            client_id = settings.GOOGLE_CLIENT_ID
            client_secret = settings.GOOGLE_CLIENT_SECRET
            token_url = 'https://oauth2.googleapis.com/token'

            oauth = OAuth2Session(client_id, redirect_uri=redirect_uri)
            token = oauth.fetch_token(
                token_url=token_url,
                code=code,
                client_secret=client_secret,
            )

            # Get user info from Google using the access token
            user_info = oauth.get('https://www.googleapis.com/oauth2/v2/userinfo').json()
            google_sub = user_info.get('id')
            email = user_info.get('email')
            name = user_info.get('name')
            avatar = user_info.get('picture')

            if not google_sub or not email:
                return {'error': 'Missing Google user data'}

            # Find or create the user
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    'username': email.split('@')[0],
                    'first_name': name.split()[0] if name else '',
                    'last_name': ' '.join(name.split()[1:]) if name and len(name.split()) > 1 else '',
                    'google_subject': google_sub,
                    'avatar_url': avatar,
                    'is_verified': True,
                }
            )

            if not created and not user.google_subject:
                # Update existing user with google_subject if not set
                user.google_subject = google_sub
                user.avatar_url = avatar or user.avatar_url
                user.is_verified = True
                user.save(update_fields=['google_subject', 'avatar_url', 'is_verified'])

            # Create or update the GoogleConnection
            connection, _ = GoogleConnection.objects.get_or_create(
                user=user,
                provider='google',
                provider_subject=google_sub,
                defaults={
                    'is_active': True,
                    'scopes': settings.GOOGLE_DRIVE_SCOPES,
                }
            )

            # Update tokens (encrypted)
            connection.access_token = token.get('access_token')
            if token.get('refresh_token'):
                connection.refresh_token = token.get('refresh_token')
            if token.get('expires_in'):
                connection.token_expiry = timezone.now() + timezone.timedelta(
                    seconds=int(token['expires_in'])
                )
            connection.is_active = True
            connection.save()

            logger.info(f"Google connection established for user {user.email}")
            return {
                'user': user,
                'connection': connection,
            }

        except Exception as e:
            logger.error(f"Google callback error: {str(e)}", exc_info=True)
            return {'error': str(e)}

    def disconnect_google(self, user: User) -> bool:
        """
        Disconnect the user's Google account.

        Args:
            user: The user to disconnect

        Returns:
            bool: True if disconnected successfully
        """
        try:
            connection = GoogleConnection.objects.get(user=user, is_active=True)
            connection.is_active = False
            connection.save()
            logger.info(f"Google account disconnected for user {user.email}")
            return True
        except GoogleConnection.DoesNotExist:
            logger.warning(f"No active Google connection found for user {user.email}")
            return False

    def refresh_google_token(self, connection: GoogleConnection) -> bool:
        """
        Refresh the Google access token using the refresh token.

        Args:
            connection: The GoogleConnection instance

        Returns:
            bool: True if token was refreshed successfully
        """
        try:
            if not connection.refresh_token:
                return False

            client_id = settings.GOOGLE_CLIENT_ID
            client_secret = settings.GOOGLE_CLIENT_SECRET
            token_url = 'https://oauth2.googleapis.com/token'

            refresh_token = connection.refresh_token
            oauth = OAuth2Session(client_id)
            new_token = oauth.refresh_token(
                token_url=token_url,
                refresh_token=refresh_token,
                client_secret=client_secret,
            )

            connection.access_token = new_token.get('access_token')
            if new_token.get('expires_in'):
                connection.token_expiry = timezone.now() + timezone.timedelta(
                    seconds=int(new_token['expires_in'])
                )
            connection.save()

            logger.info(f"Token refreshed for user {connection.user.email}")
            return True

        except Exception as e:
            logger.error(f"Token refresh failed: {str(e)}")
            return False

    def get_valid_google_credentials(self, user: User) -> Optional[Credentials]:
        """
        Get valid Google credentials for the user, refreshing if needed.

        Args:
            user: The user

        Returns:
            Credentials: Google credentials object, or None if not available
        """
        try:
            connection = GoogleConnection.objects.get(user=user, is_active=True)
        except GoogleConnection.DoesNotExist:
            return None

        if not connection.access_token:
            return None

        # Check if token is expired and refresh if possible
        if connection.is_token_expired():
            if connection.refresh_token:
                if not self.refresh_google_token(connection):
                    return None
            else:
                return None

        # Build credentials object
        credentials = Credentials(
            token=connection.access_token,
            refresh_token=connection.refresh_token,
            token_uri='https://oauth2.googleapis.com/token',
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=settings.GOOGLE_DRIVE_SCOPES,
        )
        return credentials

    def get_user_by_google_sub(self, google_sub: str) -> Optional[User]:
        """
        Retrieve a user by their Google subject ID.

        Args:
            google_sub: Google subject ID

        Returns:
            User or None
        """
        try:
            return User.objects.get(google_subject=google_sub)
        except User.DoesNotExist:
            return None