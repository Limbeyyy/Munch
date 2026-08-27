"""Google OAuth authentication service"""
import logging
from typing import Optional, Dict, Any
from django.utils import timezone
from datetime import timedelta
from src.apps.accounts.models import User, GoogleConnection, GoogleConnectionScope
from src.apps.monitoring.models import ErrorLog

logger = logging.getLogger(__name__)


class OAuthService:
    """Handles Google OAuth flow and token management"""

    @staticmethod
    def handle_oauth_callback(google_id_token: Dict[str, Any]) -> tuple[User, GoogleConnection]:
        """
        Process OAuth callback and create/update user
        Returns: (User, GoogleConnection) tuple
        """
        try:
            google_subject = google_id_token.get('sub')
            email = google_id_token.get('email')
            name = google_id_token.get('name', '')
            avatar_url = google_id_token.get('picture', '')

            # Get or create user
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    'google_subject': google_subject,
                    'username': email.split('@')[0],
                    'first_name': name.split()[0] if name else '',
                    'last_name': ' '.join(name.split()[1:]) if len(name.split()) > 1 else '',
                    'avatar_url': avatar_url,
                    'is_verified': True
                }
            )

            if not user.google_subject:
                user.google_subject = google_subject
                user.avatar_url = avatar_url or user.avatar_url
                user.save()

            return user, None

        except Exception as e:
            logger.error(f"Failed to handle OAuth callback: {str(e)}")
            raise

    @staticmethod
    def create_google_connection(
        user: User,
        google_subject: str,
        access_token: str,
        refresh_token: Optional[str] = None,
        token_expiry: Optional[timezone.datetime] = None,
        scopes: list = None
    ) -> GoogleConnection:
        """Create or update Google connection"""
        try:
            connection, created = GoogleConnection.objects.get_or_create(
                user=user,
                provider_subject=google_subject,
                defaults={
                    'access_token': access_token,
                    'refresh_token': refresh_token,
                    'token_expiry': token_expiry or (timezone.now() + timedelta(hours=1)),
                    'scopes': scopes or [],
                    'is_active': True
                }
            )

            if not created:
                connection.access_token = access_token
                if refresh_token:
                    connection.refresh_token = refresh_token
                connection.token_expiry = token_expiry or (timezone.now() + timedelta(hours=1))
                connection.scopes = scopes or connection.scopes
                connection.is_active = True
                connection.save()

            # Track scope grants
            if scopes:
                for scope in scopes:
                    GoogleConnectionScope.objects.get_or_create(
                        connection=connection,
                        scope=scope,
                        defaults={'granted_at': timezone.now()}
                    )

            logger.info(f"Created/updated Google connection for {user.email}")
            return connection

        except Exception as e:
            logger.error(f"Failed to create Google connection: {str(e)}")
            raise

    @staticmethod
    def disconnect_google(user: User) -> bool:
        """Disconnect Google account from user"""
        try:
            connections = GoogleConnection.objects.filter(user=user)
            for connection in connections:
                connection.is_active = False
                connection.save()

            logger.info(f"Disconnected Google for {user.email}")
            return True

        except Exception as e:
            logger.error(f"Failed to disconnect Google: {str(e)}")
            raise

    @staticmethod
    def get_valid_connection(user: User) -> Optional[GoogleConnection]:
        """Get valid, active Google connection"""
        try:
            connection = GoogleConnection.objects.filter(
                user=user,
                is_active=True
            ).first()

            if not connection:
                return None

            # Check if token is expired
            if connection.is_token_expired():
                # Refresh logic would go here
                logger.warning(f"Token expired for {user.email}")
                return connection

            return connection

        except Exception as e:
            logger.error(f"Failed to get valid connection: {str(e)}")
            return None

    @staticmethod
    def has_scope(user: User, scope: str) -> bool:
        """Check if user has granted a specific scope"""
        try:
            connection = GoogleConnection.objects.filter(
                user=user,
                is_active=True
            ).first()

            if not connection:
                return False

            return GoogleConnectionScope.objects.filter(
                connection=connection,
                scope=scope,
                is_revoked=False
            ).exists()

        except Exception as e:
            logger.error(f"Failed to check scope: {str(e)}")
            return False
