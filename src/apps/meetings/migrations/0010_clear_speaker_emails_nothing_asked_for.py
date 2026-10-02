"""Empty the speaker addresses, because nothing asks for them.

A session's `speaker_email` is what makes somebody a presenter: being
named on the running order is enough to open the event and read
everything in it, without waiting for an invitation. That rule is
right and stays.

What is wrong is the data behind it. No screen collects the address
any more - the form that used to is no longer rendered anywhere - so
every value in the column was typed into a field that has since gone,
and several of them are plainly not the speaker's: a session for
"Sumin Maharjan" carrying the host's own address, two for "Prabhat"
carrying somebody else's. Each of those quietly handed an event to a
person who was never on it.

So the column is emptied and the link is detached. When a speaker's
address is asked for again, the ones entered then will mean something;
the ones here never did.

Not reversible in any useful sense: the addresses cannot be put back,
and putting back addresses that were wrong is not worth being able to
do. The reverse is a no-op so the migration can still be unapplied.
"""
from django.db import migrations


def detach(apps, schema_editor):
    Session = apps.get_model('meetings', 'Session')
    Session.objects.exclude(speaker_email='').update(speaker_email='')


def leave_empty(apps, schema_editor):
    """Nothing to restore. See the note above."""


class Migration(migrations.Migration):

    dependencies = [
        ('meetings', '0009_remove_hubpost_hub_post_exactly_one_author_and_more'),
    ]

    operations = [
        migrations.RunPython(detach, leave_empty),
    ]
