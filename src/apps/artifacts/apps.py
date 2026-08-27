from django.apps import AppConfig

class ArtifactsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'src.apps.artifacts'
    label = 'artifacts'
    verbose_name = 'Artifacts'

    def ready(self):
        pass