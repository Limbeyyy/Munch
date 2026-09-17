"""WebSocket URL routing"""
from django.urls import path
from src.apps.realtime.consumers import MeetingConsumer, SignalingConsumer

websocket_urlpatterns = [
    path('ws/event/<str:code>/', MeetingConsumer.as_asgi()),
    path('ws/signaling/<str:code>/', SignalingConsumer.as_asgi()),
]
