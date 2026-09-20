from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='PaymentOrder',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('order_id', models.CharField(db_index=True, max_length=100, unique=True)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('currency', models.CharField(default='NPR', max_length=3)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('SUCCESS', 'Success'), ('FAILED', 'Failed'), ('PENDING_MANUAL_VERIFICATION', 'Pending manual verification')], default='PENDING', max_length=40)),
                ('transaction_id', models.CharField(db_index=True, max_length=150, unique=True)),
                ('transaction_reference', models.CharField(blank=True, max_length=150)),
                ('gateway_signature', models.CharField(blank=True, max_length=128)),
                ('callback_payload', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='payment_orders', to=settings.AUTH_USER_MODEL)),
            ],
            options={'db_table': 'payment_orders', 'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='paymentorder',
            index=models.Index(fields=['user', 'status'], name='payment_ord_user_id_7b9f0d_idx'),
        ),
    ]
