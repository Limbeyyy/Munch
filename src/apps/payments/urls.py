from django.urls import path

from . import views

app_name = 'payments'

urlpatterns = [
    # What the browser calls.
    path('instruments/', views.instruments, name='payment-instruments'),
    path('service-charge/', views.service_charge, name='payment-service-charge'),
    path('initiate/', views.initiate, name='payment-initiate'),
    path('orders/<str:order_id>/', views.order_status, name='payment-order-status'),
    path('submit-manual-qr/', views.submit_manual_qr, name='payment-manual-qr'),

    # What OnePG calls. Both addresses are given to their support team
    # when the merchant account is set up, and neither can be changed
    # afterwards without telling them - so they are named for what they
    # are in the integration document rather than for what they do here.
    path('notification/', views.notification, name='payment-notification'),
    path('response/', views.payment_response, name='payment-response'),

    # The address the old guessed integration used. Kept pointing at
    # the notification handler so a gateway already configured with it
    # is not silently dropped on the floor.
    path('callback/', views.notification, name='payment-callback'),
]
