from django.urls import path

from . import views

app_name = 'payments'

urlpatterns = [
    path('initiate/', views.initiate, name='payment-initiate'),
    path('callback/', views.callback, name='payment-callback'),
    path('submit-manual-qr/', views.submit_manual_qr, name='payment-manual-qr'),
]
