from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'src.apps.realtime'
    label = 'realtime'
    verbose_name = 'Real-Time Communication'

    def ready(self):
        pass