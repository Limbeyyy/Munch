"""The ordinary URLs, plus the frontend and the uploads.

Used only by ``config.settings.standalone``, where one Python process
serves the whole application and there is no nginx or IIS in front of
it to hand out files.

Written as its own module rather than as a few lines appended to
``config/urls.py`` so that the deployment with a proxy - which should
never reach these routes, because the proxy answers them first - keeps
exactly the URL map it had.
"""
from django.conf import settings
from django.urls import re_path
from django.views.static import serve as serve_file

from config.urls import urlpatterns as base_urlpatterns
from config.spa import spa

# The root redirect goes. `config/urls.py` sends `/` to the allauth
# login page, which is right when Django is the whole site and wrong
# here: `/` is where the frontend lives, and with the redirect in
# place the application never loads at all - the browser is sent to a
# Django login form instead. Dropped by name rather than by position
# so that reordering that file cannot silently turn this back on.
_without_root_redirect = [
    route for route in base_urlpatterns
    if getattr(route, 'name', None) != 'root'
]

urlpatterns = [
    *_without_root_redirect,

    # What people have uploaded. Django is an inefficient way to send a
    # file and says so in its own documentation; at the size of one
    # event's resources that is a trade worth making for not having to
    # run a second server.
    re_path(
        r'^media/(?P<path>.*)$',
        serve_file,
        {'document_root': settings.MEDIA_ROOT},
    ),

    # Everything left over is the frontend. Last, so it can only ever
    # catch what nothing above it claimed - the API, the admin and the
    # rest are matched before this is reached.
    re_path(r'^(?P<path>.*)$', spa, name='spa'),
]
