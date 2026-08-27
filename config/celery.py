import os
from celery import Celery

# Set default Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('meeting_platform')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

# src.workers is a plain package rather than a Django app, so autodiscovery
# never reaches it. Import the modules explicitly or their tasks stay
# unregistered and anything scheduled against them is discarded.
app.conf.imports = (
    'src.workers.drive_worker',
    'src.workers.meeting_worker',
    'src.workers.recording_worker',
    'src.workers.summarization_worker',
    'src.workers.transcription_worker',
)

@app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')