"""The named parts of a programme, and which talks are in them.

A grouping and nothing else: the talks keep their own hours, and one in
no group is still on the programme. Written by the host, read by
everybody who can already see the event.
"""
import logging

from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from src.apps.meetings.models import Event, Session, SubEvent

logger = logging.getLogger(__name__)


class SubEventSerializer(serializers.ModelSerializer):
    #: The talks in this group, so a screen can draw the heading and
    #: what is under it without a request per group.
    sessions = serializers.SerializerMethodField()

    class Meta:
        model = SubEvent
        fields = [
            'id', 'event', 'title', 'description', 'position',
            'sessions', 'created_at',
        ]
        read_only_fields = ['id', 'event', 'sessions', 'created_at']

    def get_sessions(self, obj):
        return [
            {'id': str(one.id), 'title': one.title}
            for one in obj.sessions.all().order_by('starts_at', 'position')
        ]


class SubEventViewSet(viewsets.ModelViewSet):
    """The groups of one event. Host only for writing."""
    serializer_class = SubEventSerializer
    permission_classes = [IsAuthenticated]

    def _event(self):
        from django.shortcuts import get_object_or_404

        return get_object_or_404(Event, pk=self.kwargs['event_pk'])

    def get_queryset(self):
        return SubEvent.objects.filter(
            event_id=self.kwargs['event_pk']
        ).prefetch_related('sessions')

    def _require_host(self, event):
        if str(event.host_id) != str(self.request.user.id):
            raise PermissionDenied('Only the host groups the running order')

    def perform_create(self, serializer):
        event = self._event()
        self._require_host(event)
        group = serializer.save(event=event)
        self._fill(group)

    def perform_update(self, serializer):
        self._require_host(self._event())
        self._fill(serializer.save())

    def perform_destroy(self, instance):
        self._require_host(instance.event)
        # The talks stay on the programme. A heading is a way of reading
        # the day, not a container the day is kept in, so removing one
        # must not remove what it was over.
        instance.sessions.update(sub_event=None)
        instance.delete()

    def _fill(self, group) -> None:
        """Put the named talks in this group, and take out the rest.

        Sent as ``session_ids``. Left out entirely, the membership is
        not touched - renaming a heading should not empty it.
        """
        data = self.request.data
        if 'session_ids' not in data:
            return

        wanted = data.getlist('session_ids') if hasattr(data, 'getlist') \
            else (data.get('session_ids') or [])
        wanted = [str(one) for one in wanted if str(one).strip()]

        mine = Session.objects.filter(event=group.event)
        chosen = mine.filter(id__in=wanted) if wanted else mine.none()

        group.sessions.exclude(
            id__in=[one.id for one in chosen]
        ).update(sub_event=None)
        chosen.update(sub_event=group)
