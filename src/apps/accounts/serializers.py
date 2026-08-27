from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from src.apps.accounts.models import GoogleConnection
from src.utilities.validators import validate_meeting_code

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'first_name', 'last_name', 
                  'avatar_url', 'created_at', 'is_verified']
        read_only_fields = ['id', 'created_at', 'is_verified']

class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'first_name', 'last_name', 
                  'avatar_url', 'preferred_language', 'timezone', 
                  'notification_preferences', 'is_verified']
        read_only_fields = ['id', 'email', 'is_verified']
    
    def update(self, instance, validated_data):
        # Handle password separately if needed
        instance = super().update(instance, validated_data)
        return instance

class GoogleConnectSerializer(serializers.Serializer):
    redirect_uri = serializers.URLField(required=True)

class GoogleCallbackSerializer(serializers.Serializer):
    code = serializers.CharField(required=True)
    state = serializers.CharField(required=False, allow_blank=True)
    redirect_uri = serializers.URLField(required=True)

class GoogleConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoogleConnection
        fields = ['id', 'provider', 'provider_subject', 'is_active', 'created_at']
        read_only_fields = ['id', 'provider', 'provider_subject', 'is_active', 'created_at']