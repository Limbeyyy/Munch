from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('meetings', '0010_clear_speaker_emails_nothing_asked_for'),
    ]

    operations = [
        migrations.AddField(
            model_name='guestattendee',
            name='device_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
