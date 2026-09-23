"""WebSocket URL routing"""
from django.urls import path
from src.apps.realtime.consumers import EventConsumer, SignalingConsumer
from src.apps.realtime.device import DeviceConsumer

websocket_urlpatterns = [
    path('ws/event/<str:code>/', EventConsumer.as_asgi()),
    path('ws/signaling/<str:code>/', SignalingConsumer.as_asgi()),
    # The hall's capture device, streaming transcript lines for one event.
    # Named apart from the room's own socket because it is not a person in
    # the room: it carries a device token, joins no group, and may only
    # write transcript.
    path('ws/device/<str:code>/transcribe/', DeviceConsumer.as_asgi()),
]
