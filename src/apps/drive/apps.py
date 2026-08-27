from django.apps import AppConfig

class DriveConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'src.apps.drive'
    label = 'drive'
    verbose_name = 'Google Drive Integration'

    def ready(self):
        pass