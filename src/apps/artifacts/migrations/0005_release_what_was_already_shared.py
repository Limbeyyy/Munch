"""Release the files that were held by a default nobody chose.

`visibility` defaulted to `after_session`, and nothing in the product
ever set it to anything else - there is no control for it on any
screen. So every file a host shared was held until the talk it was
filed against had finished, and a file on an event that had not
started yet was invisible to every person the event was for.

The default is `now` from here. This is for what is already in the
table: the same files, shared by the same hosts, who had no way of
knowing they were choosing to hide them.

Only the ones left at the old default move. A file explicitly marked
organizers-only, or public, is left exactly as it is - those are
choices somebody made, and this is for the ones nobody did.
"""
from django.db import migrations


def release(apps, schema_editor):
    Artifact = apps.get_model('artifacts', 'Artifact')
    Artifact.objects.filter(visibility='after_session').update(visibility='now')


def hold(apps, schema_editor):
    """Put them back, so the migration can be undone cleanly.

    This cannot tell the files it released from any that were held on
    purpose afterwards, because there is nothing to tell them apart by.
    Going backwards therefore holds both - which is the old behaviour,
    which is what going backwards asks for.
    """
    Artifact = apps.get_model('artifacts', 'Artifact')
    Artifact.objects.filter(visibility='now').update(visibility='after_session')


class Migration(migrations.Migration):

    dependencies = [
        ('artifacts', '0004_alter_artifact_visibility'),
    ]

    operations = [
        migrations.RunPython(release, hold),
    ]
