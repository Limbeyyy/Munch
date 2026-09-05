"""Settings for running the test suite.

The application role on this machine cannot create databases, and a test
run needs a throwaway one. SQLite in memory gives every run a clean
schema without asking anyone for Postgres privileges, and nothing in the
models depends on a Postgres-only feature.

    python manage.py test --settings=config.settings.test
"""
from .base import *  # noqa: F401,F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Nothing here should reach out to Redis, Celery or a channel layer.
CACHES = {
    'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}
}
CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}
}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

import logging  # noqa: E402

logging.disable(logging.CRITICAL)
