import uuid

from django.conf import settings
from django.db import models


class PaymentOrder(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        SUCCESS = 'SUCCESS', 'Success'
        FAILED = 'FAILED', 'Failed'
        PENDING_MANUAL_VERIFICATION = (
            'PENDING_MANUAL_VERIFICATION', 'Pending manual verification'
        )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_id = models.CharField(max_length=100, unique=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='payment_orders',
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='NPR')
    payment_channel = models.CharField(max_length=40, default='esewa')
    status = models.CharField(max_length=40, choices=Status.choices, default=Status.PENDING)
    transaction_id = models.CharField(max_length=150, unique=True, db_index=True)
    transaction_reference = models.CharField(max_length=150, blank=True)
    gateway_signature = models.CharField(max_length=128, blank=True)
    callback_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'payment_orders'
        ordering = ['-created_at']
        indexes = [
            models.Index(
                fields=['user', 'status'],
                name='payment_ord_user_id_7b9f0d_idx',
            ),
        ]

    def __str__(self):
        return f'{self.order_id} ({self.status})'
