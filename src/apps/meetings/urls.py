from django.urls import path
from . import views

app_name = 'meetings'

urlpatterns = [
    # Only include if you need non-API views; otherwise, the API routes handle everything.
    # This can be empty if you're using DRF exclusively.
]