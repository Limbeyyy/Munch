from django.contrib import admin

from .models import PaymentOrder


@admin.register(PaymentOrder)
class PaymentOrderAdmin(admin.ModelAdmin):
    list_display = (
        'order_id', 'user', 'amount', 'currency', 'status',
        'transaction_reference', 'created_at', 'updated_at',
    )
    list_filter = ('status', 'currency', 'created_at')
    search_fields = ('order_id', 'transaction_id', 'transaction_reference', 'user__email')
    readonly_fields = (
        'id', 'transaction_id', 'gateway_signature', 'callback_payload',
        'created_at', 'updated_at', 'paid_at',
    )
    ordering = ('-created_at',)
