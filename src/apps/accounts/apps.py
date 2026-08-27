from django.apps import AppConfig

class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'src.apps.accounts'
    label = 'accounts'
    verbose_name = 'Accounts'

    def ready(self):
        # Import signals if any
        # import src.apps.accounts.signals
        pass