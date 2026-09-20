from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('payments', '0001_initial')]

    operations = [
        migrations.AddField(
            model_name='paymentorder',
            name='payment_channel',
            field=models.CharField(default='esewa', max_length=40),
        ),
    ]
