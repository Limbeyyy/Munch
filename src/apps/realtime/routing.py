"""WebSocket URL routing"""
from django.urls import path
from src.apps.realtime.consumers import MeetingConsumer, SignalingConsumer

websocket_urlpatterns = [
    path('ws/meeting/<str:meeting_code>/', MeetingConsumer.as_asgi()),
    path('ws/signaling/<str:meeting_code>/', SignalingConsumer.as_asgi()),
]
