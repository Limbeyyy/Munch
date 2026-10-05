"""Settings for a deployed instance.

Everything that differs between one deployment and the next is read
from the environment, because the alternative is a file that has to be
edited before it will start - which is how the previous version of
this module came to name one organisation's domain, demand a database
replica nobody had, and write its log to a path that only exists on
Linux. It could not be imported, let alone run.

Behind a reverse proxy, always. Daphne listens on loopback and nginx
is what the world talks to, so the forwarded-proto header is trusted
and TLS is terminated in front.
"""
import os

from .base import *  # noqa: F401,F403
from .base import ROOT_DIR, env

DEBUG = False

# No default. A deployment that has not said who it answers for should
# refuse to start rather than quietly answer for anybody.
ALLOWED_HOSTS = [
    host.strip() for host in env.list('ALLOWED_HOSTS') if host.strip()
]

# -- In front of nginx -------------------------------------------------
#
# Daphne sees plain HTTP on loopback whatever the browser used, so
# without this Django believes every request is insecure: it builds
# http:// absolute URLs, refuses secure cookies, and - with the
# redirect below on - bounces a request that already arrived over TLS
# straight back to itself.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

# Opt-in, because the first thing a new deployment does is come up on
# plain HTTP on an internal address before a certificate exists.
# Turning these on by default makes that first boot a redirect loop
# with nothing to see and no obvious cause.
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=SECURE_SSL_REDIRECT)
SECURE_HSTS_SECONDS = env.int(
    'SECURE_HSTS_SECONDS', default=31536000 if SECURE_SSL_REDIRECT else 0
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0

SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# -- What base.py decided before this file got a say -------------------
#
# `DEBUG = False` above is this module's answer, but base.py had
# already branched on the *environment's* DEBUG several times on its
# way through - and that variable defaults to True when it is unset.
# So an instance running these settings without DEBUG=False in its
# environment came up with DEBUG off and `CORS_ALLOW_ALL_ORIGINS` on:
# every origin on the internet allowed to make credentialed calls
# against it. The browser's own rules were the only thing left.
#
# Deciding it again here is what makes this module true on its own,
# rather than true only when the environment happens to agree with it.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in env.list('CORS_ALLOWED_ORIGINS', default=[])
    if origin.strip()
]

# -- Static files ------------------------------------------------------
#
# The built frontend is served at the site root and keeps /static/ for
# its own bundles, which is where Create React App puts them. Django's
# collected assets - the admin, DRF's browsable API, swagger - move out
# of the way rather than being merged into it by hand. Nothing in this
# codebase writes the prefix down, so moving it is only a matter of
# saying so here.
STATIC_URL = '/django-static/'

# -- The read replica, if there is one ---------------------------------
#
# Optional. Naming the host is what asks for one; the old module
# demanded a password for a replica that did not exist, so importing
# these settings raised before Django had started.
_replica_host = env('DB_REPLICA_HOST', default='')
if _replica_host:
    DATABASES['replica'] = {  # noqa: F405
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_REPLICA_NAME', default=DATABASES['default']['NAME']),  # noqa: F405
        'USER': env('DB_REPLICA_USER', default=DATABASES['default']['USER']),  # noqa: F405
        'PASSWORD': env('DB_REPLICA_PASSWORD'),
        'HOST': _replica_host,
        'PORT': env('DB_REPLICA_PORT', default='5432'),
        'CONN_MAX_AGE': 600,
    }

# -- Email -------------------------------------------------------------
EMAIL_BACKEND = env(
    'EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend'
)
EMAIL_HOST = env('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')

# -- Logging -----------------------------------------------------------
#
# Under systemd the journal is where anybody will actually look, so
# that is the default and the file is the addition. The directory is
# made here because a RotatingFileHandler does not make it and the
# failure arrives as an exception during startup rather than as
# anything about logging.
LOG_DIR = env('LOG_DIR', default=str(ROOT_DIR / 'logs'))
os.makedirs(LOG_DIR, exist_ok=True)

_LEVELS = {'CRITICAL', 'FATAL', 'ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'NOTSET'}


def _level(raw, fallback='INFO'):
    """A logging level name, whatever the .env file actually said.

    Two things make this worth doing rather than trusting the value.

    An .env file keeps its inline comments. `LOG_LEVEL=INFO  # DEBUG,
    INFO, ...` - which is how the example file in this repository has
    always written it - arrives as that entire string, and the
    repository's own example is the obvious thing to copy.

    And the failure is out of all proportion to the mistake: logging
    is configured before anything else, so a bad level takes down
    every management command, migrate included, with a traceback
    about dictConfig that names neither the setting nor the file it
    came from. An unreadable level is worth a default, not an outage.
    """
    name = (raw or '').split('#')[0].strip().upper()
    return name if name in _LEVELS else fallback


LOG_LEVEL = _level(env('LOG_LEVEL', default='INFO'))

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'level': LOG_LEVEL,
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'file': {
            'level': LOG_LEVEL,
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOG_DIR, 'django.log'),
            'maxBytes': 1024 * 1024 * 10,
            'backupCount': 5,
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': LOG_LEVEL,
    },
}

# -- Background work ---------------------------------------------------
CELERY_TASK_ALWAYS_EAGER = False
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_BROKER_POOL_LIMIT = 50
