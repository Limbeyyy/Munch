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

# The built frontend, served by WhiteNoise rather than by the view
# below. WhiteNoise is made for this - correct content types, caching
# headers, and no synchronous file iterator for ASGI to complain
# about on every request. The view is left with the one case
# WhiteNoise cannot answer: a client-side route, which is not a file.
WHITENOISE_ROOT = SPA_ROOT
# index.html names the current bundle, so a cached copy goes on
# pointing at the previous deploy's files.
WHITENOISE_INDEX_FILE = False

# Which files may be cached forever. WhiteNoise's own test looks for
# the hash Django's ManifestStaticFilesStorage adds, and does not
# recognise the one Create React App puts in - so the bundles, which
# are the largest things here and the most safely cacheable, were
# being served with a minute's cache. A changed file gets a new name,
# so the URL can never go stale.
WHITENOISE_IMMUTABLE_FILE_TEST = r'\.[0-9a-f]{8,}\.(js|css|map|woff2?|png|jpg|jpeg|gif|svg)$'

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

# -- Is anything in front? ---------------------------------------------
#
# Off by default, and it has to be. `X-Forwarded-Proto` is a header
# like any other: with nothing in front to overwrite it, any client
# can send `X-Forwarded-Proto: https` on a plain HTTP request and
# Django will believe the connection was secure - set a secure
# cookie, skip the redirect, build https:// URLs - for a request that
# crossed the network in the clear.
#
# With a proxy in front it is the opposite: the header is the only
# way Django can know, because the proxy terminates TLS and speaks
# plain HTTP to this process. Without it, every absolute URL comes
# back http://, secure cookies are refused, and SECURE_SSL_REDIRECT
# bounces a request that already arrived over TLS straight back to
# itself, forever.
#
# So it is a statement about the deployment, not a preference:
# TRUST_PROXY_HEADER=True means "a proxy I control sets this".
# Three values rather than two, because there are three situations:
#
#   False   nothing in front. The header is whatever a client chose
#           to send, so it is ignored.
#   True    a proxy in front that sets X-Forwarded-Proto. Believe it.
#   always  a proxy in front that serves HTTPS and nothing else, but
#           does not say so - Tailscale Funnel. The scheme is known
#           for certain and simply absent from the request.
#
# `always` is only safe when nothing can reach the application except
# that proxy, which in practice means bound to loopback. See
# config/proxy.py.
_trust = (env('TRUST_PROXY_HEADER', default='False') or '').split('#')[0].strip().lower()
TRUST_PROXY_HEADER = _trust in {'true', 'yes', '1', 'on', 'always'}
ASSUME_TLS = _trust == 'always'

if TRUST_PROXY_HEADER:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    USE_X_FORWARDED_HOST = True
else:
    SECURE_PROXY_SSL_HEADER = None

if ASSUME_TLS:
    # First, so everything after it sees the request as secure.
    MIDDLEWARE.insert(0, 'config.proxy.AssumeTLS')

# Honest default. Switch it on once there is actually TLS - either a
# proxy in front terminating it, or a certificate given to uvicorn
# directly (--ssl-keyfile / --ssl-certfile). On before that, and
# everything redirects to a port nothing is listening on.
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
SECURE_HSTS_SECONDS = env.int(
    'SECURE_HSTS_SECONDS', default=31536000 if SECURE_SSL_REDIRECT else 0
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0

os.makedirs(SPA_ROOT, exist_ok=True)
