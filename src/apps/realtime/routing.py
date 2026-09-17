"""WebSocket URL routing"""
from django.urls import path
from src.apps.realtime.consumers import EventConsumer, SignalingConsumer

websocket_urlpatterns = [
    path('ws/event/<str:code>/', EventConsumer.as_asgi()),
    path('ws/signaling/<str:code>/', SignalingConsumer.as_asgi()),
]
