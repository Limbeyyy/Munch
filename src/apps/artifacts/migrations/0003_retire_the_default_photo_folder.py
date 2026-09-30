"""Take down the folder nobody asked for, without taking the album with it.

Every event used to be given a folder called Default the first time
anybody looked at its photographs. It was per-event all along, but it
carried the same name in every event, so it read as one shelf shared
between them - and a host opening a new event saw a folder they had not
made, sitting where last time's photographs had been.

Nothing conjures it any more. This clears up what is already there:

  - An empty one is deleted. Nobody filed anything in it and nobody
    made it, so there is nothing to keep.
  - One with photographs in it becomes an ordinary folder. Deleting it
    would cascade to the photographs inside, and those are the record of
    a day that has already happened. It keeps its name and its contents,
    and from now on the host may rename or empty it like any other.
"""
from django.db import migrations


def retire_defaults(apps, schema_editor):
    PhotoFolder = apps.get_model('artifacts', 'PhotoFolder')

    defaults = PhotoFolder.objects.filter(is_default=True)
    defaults.filter(photos__isnull=True).delete()
    defaults.update(is_default=False)


def unretire(apps, schema_editor):
    """Nothing to put back.

    The empty ones held nothing, and the ones that were kept are still
    there under their own names. Marking one Default again would only
    re-create the confusion this removed.
    """


class Migration(migrations.Migration):

    dependencies = [
        ('artifacts', '0002_alter_photofolder_options'),
    ]

    operations = [
        migrations.RunPython(retire_defaults, unretire),
        migrations.RemoveConstraint(
            model_name='photofolder',
            name='one_default_photo_folder_per_event',
        ),
    ]
