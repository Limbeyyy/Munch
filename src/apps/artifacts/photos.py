"""The photographs from a event: where they go, and who may put them there.

Two rules shape everything here.

A photograph may be added before, during, or after the event. The host
controls the folders, while permitted participants may add photographs
whenever they choose.

And a record of the event is the organizers' to make. The host and the
people presenting were there in that capacity; everybody else was a guest
of the occasion, and can look at the result without adding to it.
"""
import logging


logger = logging.getLogger(__name__)

#: Big enough for a photograph off a phone, small enough to refuse a video.
MAX_PHOTO_BYTES = 15 * 1024 * 1024

ALLOWED_TYPES = ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')


class PhotoRefused(Exception):
    """Somebody may not do this, or not yet."""

    def __init__(self, message, code='refused'):
        super().__init__(message)
        self.code = code


def folders_for(event):
    """Every folder this event has, in the order they were made.

    None, where the host has made none. There used to be a folder
    called Default conjured here on first sight, which meant every
    event opened showing a folder nobody had asked for, with the same
    name as the one in every other event - so it read as one shelf
    shared between them. An empty list says the true thing.
    """
    return event.photo_folders.all()


def event_is_done(event) -> bool:
    """Whether the event has finished, which is when photographs make sense."""
    from src.apps.meetings.models import Event

    return event.status == Event.Status.ENDED


def may_arrange(event, user) -> bool:
    """Who may make and name folders: the host and their co-hosts."""
    from src.apps.artifacts.visibility import can_organize

    return can_organize(event, user)


def may_upload(event, user) -> bool:
    """Who may add photographs: the host, co-hosts, and the presenters.

    Being on the programme is what counts, not having walked into the room:
    a speaker who presented is one of the people who made the day.
    """
    if may_arrange(event, user):
        return True
    if not user or not user.is_authenticated:
        return False

    from src.apps.meetings.roles import PRESENTER, roles_in_event, speaks_at

    return speaks_at(event, user=user) or PRESENTER in roles_in_event(
        event, user=user
    )


def check_can_upload(event, user):
    """Raise unless this person may add a photograph to this event now."""
    if not may_upload(event, user):
        raise PhotoRefused(
            'Only the host, a co-host or somebody who presented can add '
            'photographs.',
            code='not_an_organizer',
        )


def create_folder(event, user, name):
    """Make a folder for this event. Host and co-hosts only."""
    from src.apps.artifacts.models import PhotoFolder

    if not may_arrange(event, user):
        raise PhotoRefused(
            'Only the host or a co-host can create a folder.',
            code='not_an_organizer',
        )

    tidy = ' '.join((name or '').split())[:120]
    if len(tidy) < 2:
        raise PhotoRefused('Give the folder a name.', code='name_too_short')

    if event.photo_folders.filter(name__iexact=tidy).exists():
        raise PhotoRefused(
            f'There is already a folder called “{tidy}”.', code='name_taken'
        )

    return PhotoFolder.objects.create(
        event=event, name=tidy, created_by=user, is_default=False
    )


def rename_folder(event, user, folder, name):
    """Rename a folder. Host and co-hosts only."""
    if not may_arrange(event, user):
        raise PhotoRefused(
            'Only the host or a co-host can rename a folder.',
            code='not_an_organizer',
        )

    tidy = ' '.join((name or '').split())[:120]
    if len(tidy) < 2:
        raise PhotoRefused('Give the folder a name.', code='name_too_short')
    if event.photo_folders.filter(name__iexact=tidy).exclude(id=folder.id).exists():
        raise PhotoRefused(
            f'There is already a folder called “{tidy}”.', code='name_taken'
        )

    folder.name = tidy
    folder.save(update_fields=['name', 'updated_at'])
    return folder


def delete_folder(event, user, folder):
    """Remove an empty folder. Host and co-hosts only.

    What was in one used to move to the default on the way out. With no
    default there is nowhere for it to go, and the photographs are the
    record of the day - so a folder with anything in it is kept rather
    than taken down on top of them.
    """
    if not may_arrange(event, user):
        raise PhotoRefused(
            'Only the host or a co-host can remove a folder.',
            code='not_an_organizer',
        )

    if folder.photos.exists():
        raise PhotoRefused(
            'Empty the folder before removing it.', code='folder_not_empty'
        )

    folder.delete()
    return None


def _drive_folder_id(folder):
    """This folder's place in the host's Drive, made on first use."""
    from src.apps.artifacts.services.artifact_service import MeetingArtifactService

    if folder.drive_folder_id:
        return folder.drive_folder_id

    event = folder.event
    service = MeetingArtifactService(event.id, event.host_id)
    parent = service.get_or_create_photos_folder()
    made = service.drive_adapter.create_folder(folder.name, parent_id=parent)

    folder.drive_folder_id = made['id']
    folder.save(update_fields=['drive_folder_id', 'updated_at'])
    return folder.drive_folder_id


def store_photo(folder, uploaded_file, user, caption=''):
    """Put one photograph in a folder, in the host's own Drive."""
    from src.apps.artifacts.models import EventPhoto
    from src.apps.artifacts.services.artifact_service import MeetingArtifactService

    event = folder.event
    check_can_upload(event, user)

    if uploaded_file.size > MAX_PHOTO_BYTES:
        raise PhotoRefused(
            f'That photograph is larger than '
            f'{MAX_PHOTO_BYTES // (1024 * 1024)}MB.',
            code='too_large',
        )

    kind = (getattr(uploaded_file, 'content_type', '') or '').lower()
    if kind and not kind.startswith('image/'):
        raise PhotoRefused('That is not a photograph.', code='not_an_image')

    service = MeetingArtifactService(event.id, event.host_id)
    stored = service.drive_adapter.upload_file(
        file_obj=uploaded_file,
        filename=uploaded_file.name,
        mime_type=kind or 'image/jpeg',
        parent_id=_drive_folder_id(folder),
    )

    return EventPhoto.objects.create(
        folder=folder,
        event=event,
        caption=(caption or uploaded_file.name or '')[:255],
        drive_file_id=stored['id'],
        mime_type=stored.get('mimeType', kind),
        file_size=int(stored['size']) if stored.get('size') else uploaded_file.size,
        web_view_link=stored.get('webViewLink', '') or '',
        uploaded_by=user if getattr(user, 'is_authenticated', False) else None,
    )


def photo_bytes(photo):
    """The photograph itself, fetched on the host's credentials."""
    from src.apps.drive.services.google_drive_adapter import GoogleDriveAdapter

    adapter = GoogleDriveAdapter(str(photo.event.host_id))
    return adapter.download_file(photo.drive_file_id)
