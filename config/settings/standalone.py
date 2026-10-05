"""One process serving the whole application.

The production settings assume something in front - nginx or IIS -
handing out the frontend, the collected static files and the uploads,
and passing the rest to the application server. That is the right
shape, and it is also a second piece of software to install,
configure and keep running.

This drops it. Django serves everything, uvicorn serves Django, and
the deployment is one command. The cost is real but small at this
scale: a proxy sends files faster than Python does, and there is
nothing in front to terminate TLS, so a certificate has to be given
to uvicorn directly or the thing sits behind something else later.

Appropriate for an event on a local network, or a single server with
one application on it. Not a reason to take the proxy out of a
deployment that already has one working.

    set DJANGO_ENV=prod
    set DJANGO_SETTINGS_MODULE=config.settings.standalone
    python -m uvicorn config.asgi:application --host 0.0.0.0 --port 8000
"""
import os

from .production import *  # noqa: F401,F403
from .production import MIDDLEWARE, ROOT_DIR, env

# The extra routes - the uploads, and the frontend's catch-all. Set
# here rather than appended to config/urls.py so that a deployment
# with a proxy keeps exactly the URL map it had.
ROOT_URLCONF = 'config.urls_standalone'

# Where `npm run build` left the frontend.
SPA_ROOT = env('SPA_ROOT', default=str(ROOT_DIR / 'Munch-frontend' / 'build'))

# Django's own collected assets - the admin, the browsable API,
# swagger. WhiteNoise serves them from inside the application, with
# the caching and compression a web server would otherwise be doing.
#
# Directly after SecurityMiddleware, which is where it has to go: it
# answers the request itself and returns, so anything above it in the
# list would be skipped for every static file.
if 'whitenoise.middleware.WhiteNoiseMiddleware' not in MIDDLEWARE:
    _after = 'django.middleware.security.SecurityMiddleware'
    _at = MIDDLEWARE.index(_after) + 1 if _after in MIDDLEWARE else 0
    MIDDLEWARE.insert(_at, 'whitenoise.middleware.WhiteNoiseMiddleware')

STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        # Hashed filenames and a pre-compressed copy of each, built
        # once by collectstatic rather than on every request.
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# No proxy in front, so there is nothing to have terminated TLS and
# nothing whose word to take for it. Trusting the header here would
# mean trusting whatever the client sent.
SECURE_PROXY_SSL_HEADER = None

# Honest default. Switch it on only once uvicorn itself has a
# certificate (--ssl-keyfile / --ssl-certfile), or everything
# redirects to a port nothing is listening on.
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
SECURE_HSTS_SECONDS = env.int(
    'SECURE_HSTS_SECONDS', default=31536000 if SECURE_SSL_REDIRECT else 0
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0

os.makedirs(SPA_ROOT, exist_ok=True)
