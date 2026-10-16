import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Before anything opens a socket. On Windows a phone that vanishes
# mid-websocket otherwise costs a handle as well as a traceback.
from config.winsock import install as _quiet_windows_resets

_quiet_windows_resets()

from django.core.asgi import get_asgi_application

# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter

from src.apps.realtime.middleware import JWTAuthMiddlewareStack
from src.apps.realtime.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': JWTAuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})