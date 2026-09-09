from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from drf_yasg.utils import swagger_auto_schema
from src.apps.accounts.serializers import (
    UserSerializer, UserProfileSerializer, 
    GoogleConnectSerializer, GoogleCallbackSerializer
)
from src.apps.accounts.services import AccountService
from src.utilities.decorators import rate_limit

User = get_user_model()

class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for user management
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        # Users can only see themselves and their meeting participants
        return User.objects.filter(id=self.request.user.id)
    
    @action(detail=False, methods=['get', 'put'])
    def profile(self, request):
        """Get or update current user's profile"""
        if request.method == 'GET':
            serializer = UserProfileSerializer(request.user)
            return Response(serializer.data)
        else:
            serializer = UserProfileSerializer(request.user, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def roles(self, request):
        """Say whether this person hosts, attends, or both, and on what plan.

        The sign-in chooser reads this to decide which portals to offer, and
        the organizer dashboard reads the plan to show what is left of it.
        """
        from src.apps.accounts.roles import roles_payload

        return Response(roles_payload(request.user))

    @action(detail=False, methods=['post'])
    def start_hosting(self, request):
        """Take up the free trial. Hosting again later is a no-op, not an error."""
        from src.apps.accounts.models import HostAccount
        from src.apps.accounts.roles import roles_payload

        HostAccount.objects.get_or_create(
            user=request.user,
            defaults={'plan': HostAccount.Plan.FREE, 'status': HostAccount.Status.TRIAL},
        )
        request.user.refresh_from_db()
        return Response(roles_payload(request.user))

    @action(detail=False, methods=['get'])
    def profile_summary(self, request):
        """Who this person is here, and what their plan leaves them.

        One call, because a profile page that has to stitch three together
        shows three different loading states and gets them out of step.
        """
        from src.apps.accounts.plans import PLANS, plan_for, usage_for
        from src.apps.accounts.roles import roles_payload, signs_in_with_google

        payload = roles_payload(request.user)
        plan = plan_for(request.user)
        usage = usage_for(request.user)

        def left(cap, used):
            """What is left of an allowance. None means no ceiling."""
            if cap is None:
                return None
            return max(0, cap - used)

        return Response({
            'user': {
                'id': str(request.user.id),
                'email': request.user.email,
                'name': request.user.display_name,
                'avatar_url': request.user.avatar_url,
                'is_verified': request.user.is_verified,
                'joined': request.user.created_at,
                'signed_in_with_google': signs_in_with_google(request.user),
                'language': request.user.preferred_language,
                'timezone': request.user.timezone,
            },
            **payload,
            'remaining': {
                'events': left(plan.max_events, usage['events']),
                'meetings': left(plan.max_meetings, usage['meetings']),
                'sessions_per_meeting': plan.max_sessions_per_meeting,
                'attendees': plan.max_attendees,
            },
            'plans': [PLANS[key].as_json() for key in PLANS],
        })

    @action(detail=False, methods=['get', 'post'], url_path='scheduling')
    def scheduling(self, request):
        """The intervals this host's programme runs to.

        How much room a hall needs between one session and the next, and
        how much warning the people coming are given. All three were fixed
        numbers written into the code: fifteen minutes between sessions, an
        hour before a meeting, a quarter of an hour before a talk. They
        suit a conference people travel to and not a ward meeting down the
        corridor, so they are the host's to set.

        Fields are taken one at a time, so a screen may send only what it
        changed.
        """
        from src.apps.accounts.roles import ensure_host
        from src.apps.meetings.reminders import (
            MAX_LEAD_MINUTES, MEETING_LEAD_MINUTES, SESSION_LEAD_MINUTES,
        )
        from src.apps.meetings.scheduling import GAP_MINUTES, MAX_GAP_MINUTES

        #: field -> (default, largest allowed)
        NUMBERS = {
            'session_gap_minutes': (GAP_MINUTES, MAX_GAP_MINUTES),
            'meeting_reminder_minutes': (MEETING_LEAD_MINUTES, MAX_LEAD_MINUTES),
            'session_reminder_minutes': (SESSION_LEAD_MINUTES, MAX_LEAD_MINUTES),
        }

        def as_json():
            account = getattr(request.user, 'host_account', None)
            body = {
                field: getattr(account, field) if account else default
                for field, (default, _) in NUMBERS.items()
            }
            body['reminders_enabled'] = (
                account.reminders_enabled if account else True
            )
            body['defaults'] = {field: default for field, (default, _) in NUMBERS.items()}
            body['maximums'] = {field: most for field, (_, most) in NUMBERS.items()}
            # Kept under the older names, which the agenda already reads.
            body['default_session_gap_minutes'] = GAP_MINUTES
            body['max_session_gap_minutes'] = MAX_GAP_MINUTES
            return body

        if request.method == 'GET':
            return Response(as_json())

        changes = {}
        for field, (_, most) in NUMBERS.items():
            if field not in request.data:
                continue
            try:
                wanted = int(request.data[field])
            except (TypeError, ValueError):
                return Response(
                    {
                        'error': f'{field} must be a whole number of minutes',
                        'code': 'not_a_number',
                        'field': field,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if wanted < 0 or wanted > most:
                return Response(
                    {
                        'error': f'That goes from 0 to {most} minutes.',
                        'code': 'out_of_range',
                        'field': field,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            changes[field] = wanted

        if 'reminders_enabled' in request.data:
            changes['reminders_enabled'] = bool(request.data['reminders_enabled'])

        if not changes:
            return Response(
                {
                    'error': f'Send one of {sorted(NUMBERS) + ["reminders_enabled"]}',
                    'code': 'nothing_to_change',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Somebody setting how their days are spaced is hosting, whether or
        # not they have opened a programme yet.
        account = getattr(request.user, 'host_account', None) or ensure_host(request.user)
        for field, value in changes.items():
            setattr(account, field, value)
        account.save(update_fields=[*changes, 'updated_at'])
        request.user.refresh_from_db()

        return Response(as_json())

    @action(detail=False, methods=['get', 'post'], url_path='upgrade')
    def upgrade(self, request):
        """Ask to move to a bigger plan, or see what has been asked.

        No money changes hands here - there is no checkout yet - so this
        records the ask rather than pretending to charge. A button that
        silently does nothing would be worse than saying so.
        """
        from django.utils import timezone

        from src.apps.accounts.models import UpgradeRequest
        from src.apps.accounts.plans import PLANS, plan_for

        def as_json(row):
            return {
                'id': str(row.id),
                'plan': row.plan,
                'plan_name': PLANS[row.plan].name if row.plan in PLANS else row.plan,
                'from_plan': row.from_plan,
                'status': row.status,
                'note': row.note,
                'created_at': row.created_at,
            }

        mine = UpgradeRequest.objects.filter(user=request.user)

        if request.method == 'GET':
            return Response({'requests': [as_json(r) for r in mine]})

        wanted = request.data.get('plan')
        if wanted not in PLANS:
            return Response(
                {'error': f'plan must be one of {sorted(PLANS)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current = plan_for(request.user)
        if wanted == current.id:
            return Response(
                {
                    'error': f'You are already on {current.name}.',
                    'code': 'already_on_plan',
                },
                status=status.HTTP_409_CONFLICT,
            )

        asked, created = UpgradeRequest.objects.get_or_create(
            user=request.user, plan=wanted, status=UpgradeRequest.Status.ASKED,
            defaults={
                'from_plan': current.id,
                'note': (request.data.get('note') or '').strip()[:2000],
            },
        )
        return Response(
            as_json(asked),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=False, methods=['post'])
    @rate_limit(requests=5, period=60)
    def disconnect_google(self, request):
        """Disconnect Google account"""
        account_service = AccountService()
        success = account_service.disconnect_google(request.user)
        if success:
            return Response({'message': 'Google account disconnected'})
        return Response({'error': 'No Google connection found'}, status=status.HTTP_400_BAD_REQUEST)

class AuthViewSet(viewsets.GenericViewSet):
    """
    Authentication endpoints
    """
    permission_classes = [permissions.AllowAny]
    
    @swagger_auto_schema(
        request_body=GoogleConnectSerializer,
        responses={200: 'Google OAuth URL'}
    )
    @action(detail=False, methods=['post'])
    def google_connect(self, request):
        """Initiate Google OAuth flow"""
        serializer = GoogleConnectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        redirect_uri = serializer.validated_data.get('redirect_uri')
        
        account_service = AccountService()
        auth_url = account_service.get_google_auth_url(redirect_uri)
        
        return Response({'auth_url': auth_url})
    
    @swagger_auto_schema(
        request_body=GoogleCallbackSerializer,
        responses={200: 'Authentication successful'}
    )
    @action(detail=False, methods=['post'])
    def google_callback(self, request):
        """Handle Google OAuth callback"""
        serializer = GoogleCallbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        code = serializer.validated_data['code']
        state = serializer.validated_data.get('state')
        redirect_uri = serializer.validated_data.get('redirect_uri')
        
        account_service = AccountService()
        result = account_service.handle_google_callback(code, redirect_uri, state)
        
        if result.get('user'):
            from src.apps.accounts.tokens import issue_tokens

            return Response({
                **issue_tokens(result['user']),
                'user': UserSerializer(result['user']).data,
                'google_connected': True
            })
        
        return Response({'error': result.get('error', 'Authentication failed')}, 
                       status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'], url_path='token_refresh')
    def token_refresh(self, request):
        """Trade a refresh token for a new access token.

        This is what keeps somebody on the page they are on when their
        short access token runs out. It is not a way round the session
        cap: a refresh token from a sign-in older than the ceiling is
        refused here however valid the token itself still looks.
        """
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

        from src.apps.accounts.tokens import SessionRefreshSerializer

        serializer = SessionRefreshSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as error:
            raise InvalidToken(str(error))

        return Response(serializer.validated_data)

    @action(detail=False, methods=['post'])
    def logout(self, request):
        """Logout user"""
        revoked = False
        refresh_token = request.data.get('refresh')
        if refresh_token:
            from rest_framework_simplejwt.exceptions import TokenError
            from rest_framework_simplejwt.tokens import RefreshToken

            try:
                RefreshToken(refresh_token).blacklist()
                revoked = True
            except TokenError:
                # Already expired or already revoked: the session is over
                # either way, which is what the caller asked for.
                pass

        return Response({'message': 'Logged out successfully', 'revoked': revoked})