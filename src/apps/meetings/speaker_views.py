"""Speaker profiles, and which talks they give.

A speaker belongs to an event and may cover several of its talks. What
is stored here is the profile - a name, what they do, a photograph, a
link or two - and the assignment; the talk itself keeps its own copy of
the name so a running order still reads without one.
"""
import logging

from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.meetings.models import Event, Session, Speaker

logger = logging.getLogger(__name__)

MAX_PHOTO_BYTES = 5 * 1024 * 1024


class SpeakerSerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()
    #: The talks this profile gives, so a card can say so without a
    #: second request per speaker.
    sessions = serializers.SerializerMethodField()

    class Meta:
        model = Speaker
        fields = [
            'id', 'event', 'full_name', 'position', 'organization',
            'photo_url', 'linkedin_url', 'website_url', 'email', 'phone',
            'sessions', 'created_at',
        ]
        read_only_fields = ['id', 'event', 'photo_url', 'sessions', 'created_at']

    def get_photo_url(self, obj):
        if not obj.photo:
            return None
        request = self.context.get('request')
        url = obj.photo.url
        return request.build_absolute_uri(url) if request else url

    def get_sessions(self, obj):
        return [
            {'id': str(one.id), 'title': one.title}
            for one in obj.sessions.all().order_by('starts_at', 'position')
        ]


class SpeakerViewSet(viewsets.ModelViewSet):
    """The speakers of one event. Host only.

    Reading is open to anybody who can already reach the event - the
    running order names them anyway - but writing is the host's, because
    a profile is part of the programme.
    """
    serializer_class = SpeakerSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _event(self):
        from django.shortcuts import get_object_or_404

        return get_object_or_404(Event, pk=self.kwargs['event_pk'])

    def get_queryset(self):
        return Speaker.objects.filter(
            event_id=self.kwargs['event_pk']
        ).prefetch_related('sessions')

    def _require_host(self, event):
        if str(event.host_id) != str(self.request.user.id):
            raise PermissionDenied('Only the host can change the speakers')

    def perform_create(self, serializer):
        event = self._event()
        self._require_host(event)
        speaker = serializer.save(event=event)
        self._take_photo(speaker)
        self._assign(speaker)

    def perform_update(self, serializer):
        event = self._event()
        self._require_host(event)
        speaker = serializer.save()
        self._take_photo(speaker)
        self._assign(speaker)

    def perform_destroy(self, instance):
        self._require_host(instance.event)
        # The talks they were giving keep their name; only the profile
        # goes. Losing the name too would empty a running order because
        # somebody tidied a list of people.
        instance.sessions.update(speaker=None)
        instance.delete()

    def _take_photo(self, speaker) -> None:
        """Store the photograph, if one came with the form."""
        uploaded = self.request.FILES.get('photo')
        if uploaded is None:
            return
        if uploaded.size > MAX_PHOTO_BYTES:
            raise serializers.ValidationError({
                'photo': 'That photograph is larger than 5 MB.',
            })
        speaker.photo = uploaded
        speaker.save(update_fields=['photo', 'updated_at'])

    def _assign(self, speaker) -> None:
        """Put this speaker on the talks the form named, and off the rest.

        Sent as ``session_ids``. Left out entirely, the assignment is not
        touched - a form editing only a name should not silently take
        somebody off every talk they were giving.
        """
        data = self.request.data
        if 'session_ids' not in data:
            return

        wanted = data.getlist('session_ids') if hasattr(data, 'getlist') \
            else (data.get('session_ids') or [])
        wanted = [str(one) for one in wanted if str(one).strip()]

        mine = Session.objects.filter(event=speaker.event)
        chosen = mine.filter(id__in=wanted) if wanted else mine.none()

        # Off the ones no longer named, on to the ones now named. The
        # talk's own copy of the name follows, so the running order reads
        # the same whichever way it is looked at.
        speaker.sessions.exclude(
            id__in=[one.id for one in chosen]
        ).update(speaker=None)

        for one in chosen:
            one.speaker = speaker
            one.speaker_name = speaker.full_name
            if speaker.position:
                one.speaker_role = speaker.position
            one.save(update_fields=['speaker', 'speaker_name', 'speaker_role'])

    @action(detail=True, methods=['post'], url_path='photo')
    def photo(self, request, event_pk=None, pk=None):
        """Replace just the photograph, without resending the profile."""
        speaker = self.get_object()
        self._require_host(speaker.event)

        uploaded = request.FILES.get('photo')
        if uploaded is None:
            return Response(
                {'error': 'Send the image under "photo".'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if uploaded.size > MAX_PHOTO_BYTES:
            return Response(
                {'error': 'That photograph is larger than 5 MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        speaker.photo = uploaded
        speaker.save(update_fields=['photo', 'updated_at'])
        return Response(
            self.get_serializer(speaker).data, status=status.HTTP_200_OK
        )
