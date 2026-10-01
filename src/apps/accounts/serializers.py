from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from src.apps.accounts.models import GoogleConnection
from src.utilities.validators import validate_event_code

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    #: Whichever picture applies - see User.photo_url.
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'first_name', 'last_name', 
                  'avatar_url', 'created_at', 'is_verified']
        read_only_fields = ['id', 'created_at', 'is_verified']

    def get_avatar_url(self, obj):
        return obj.photo_url(self.context.get('request'))

class UserProfileSerializer(serializers.ModelSerializer):
    """What somebody may change about themselves.

    The name and the picture are theirs: Google supplied them at
    sign-in and this table has owned them since, so editing one here
    changes nothing about the Google account.

    The address is not. It is what the account is identified by and
    what an invitation is matched against, so it is read only - the
    place to change it is Google.
    """
    #: Read: whichever picture applies. Write: the file being put up,
    #: under `avatar`, so an arbitrary URL cannot be written in.
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'first_name', 'last_name',
                  'phone', 'position', 'organization_name', 'billing_address',
                  'avatar', 'avatar_url', 'preferred_language', 'timezone',
                  'notification_preferences', 'is_verified']
        read_only_fields = ['id', 'email', 'is_verified']
        extra_kwargs = {'avatar': {'write_only': True, 'required': False}}

    def get_avatar_url(self, obj):
        return obj.photo_url(self.context.get('request'))
    
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