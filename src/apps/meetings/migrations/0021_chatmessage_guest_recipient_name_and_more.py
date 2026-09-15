from django.db import migrations, models
import django.db.models.deletion


def name_the_guests(apps, schema_editor):
    """Write down who wrote what, while the rows are still here.

    A guest's name lived only on the guest's own row, and that row is
    deleted when their meeting ends - which used to take the message with
    it, because the link cascaded. Everything already written gets its
    author stamped on it now, so nothing loses one later.
    """
    ChatMessage = apps.get_model('meetings', 'ChatMessage')

    for message in (
        ChatMessage.objects.exclude(guest_sender__isnull=True)
        .select_related('guest_sender').iterator()
    ):
        ChatMessage.objects.filter(id=message.id).update(
            guest_sender_name=message.guest_sender.full_name
        )

    for message in (
        ChatMessage.objects.exclude(guest_recipient__isnull=True)
        .select_related('guest_recipient').iterator()
    ):
        ChatMessage.objects.filter(id=message.id).update(
            guest_recipient_name=message.guest_recipient.full_name
        )


class Migration(migrations.Migration):
    dependencies = [
        ("meetings", "0020_meeting_guest_attendance"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatmessage",
            name="guest_recipient_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="guest_sender_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AlterField(
            model_name="chatmessage",
            name="guest_recipient",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="received_chat_messages",
                to="meetings.guestattendee",
            ),
        ),
        migrations.AlterField(
            model_name="chatmessage",
            name="guest_sender",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sent_chat_messages",
                to="meetings.guestattendee",
            ),
        ),
        migrations.RunPython(name_the_guests, migrations.RunPython.noop),
    ]
