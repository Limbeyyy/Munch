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
            # Generate JWT tokens
            from rest_framework_simplejwt.tokens import RefreshToken
            refresh = RefreshToken.for_user(result['user'])
            
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': UserSerializer(result['user']).data,
                'google_connected': True
            })
        
        return Response({'error': result.get('error', 'Authentication failed')}, 
                       status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def logout(self, request):
        """Logout user"""
        try:
            refresh_token = request.data.get('refresh')
            if refresh_token:
                from rest_framework_simplejwt.tokens import RefreshToken
                token = RefreshToken(refresh_token)
                token.blacklist()
        except:
            pass
        return Response({'message': 'Logged out successfully'})