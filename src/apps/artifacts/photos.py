"""The photographs from a meeting: where they go, and who may put them there.

Two rules shape everything here.

A photograph of the day is worth having once the day has happened, so
uploading waits until the meeting is over. Before then the folders exist
and can be arranged, but there is nothing to record yet - and a hall
photograph taken during the session it is meant to show would be a
photograph of an empty hall.

And a record of the event is the organizers' to make. The host and the
people presenting were there in that capacity; everybody else was a guest
of the occasion, and can look at the result without adding to it.
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)

#: The folder every meeting has, whether or not anybody made one.
DEFAULT_FOLDER_NAME = 'Default'

#: Big enough for a photograph off a phone, small enough to refuse a video.
MAX_PHOTO_BYTES = 15 * 1024 * 1024

ALLOWED_TYPES = ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')


class PhotoRefused(Exception):
    """Somebody may not do this, or not yet."""

    def __init__(self, message, code='refused'):
        super().__init__(message)
        self.code = code


def default_folder(meeting):
    """The meeting's default folder, made on first sight if need be."""
    from src.apps.artifacts.models import PhotoFolder

    folder, _ = PhotoFolder.objects.get_or_create(
        meeting=meeting, is_default=True,
        defaults={'name': DEFAULT_FOLDER_NAME},
    )
    return folder


def folders_for(meeting):
    """Every folder this meeting has, the default first."""
    default_folder(meeting)
    return meeting.photo_folders.all()


def meeting_is_done(meeting) -> bool:
    """Whether the meeting has finished, which is when photographs make sense."""
    from src.apps.meetings.models import Meeting

    return meeting.status == Meeting.Status.ENDED


def may_arrange(meeting, user) -> bool:
    """Who may make and name folders: the host and their co-hosts."""
    from src.apps.artifacts.visibility import can_organize

    return can_organize(meeting, user)


def may_upload(meeting, user) -> bool:
    """Who may add photographs: the host, co-hosts, and the presenters.

    Being on the programme is what counts, not having walked into the room:
    a speaker who presented is one of the people who made the day.
    """
    if may_arrange(meeting, user):
        return True
    if not user or not user.is_authenticated:
        return False

    from src.apps.meetings.roles import PRESENTER, roles_in_meeting, speaks_at

    return speaks_at(meeting, user=user) or PRESENTER in roles_in_meeting(
        meeting, user=user
    )


def check_can_upload(meeting, user):
    """Raise unless this person may add a photograph to this meeting now."""
    if not may_upload(meeting, user):
        raise PhotoRefused(
            'Only the host, a co-host or somebody who presented can add '
            'photographs.',
            code='not_an_organizer',
        )
    if not meeting_is_done(meeting):
        raise PhotoRefused(
            'Photographs can be added once the meeting has finished.',
            code='meeting_not_finished',
        )


def create_folder(meeting, user, name):
    """Make a folder for this meeting. Host and co-hosts only."""
    from src.apps.artifacts.models import PhotoFolder

    if not may_arrange(meeting, user):
        raise PhotoRefused(
            'Only the host or a co-host can create a folder.',
            code='not_an_organizer',
        )

    tidy = ' '.join((name or '').split())[:120]
    if len(tidy) < 2:
        raise PhotoRefused('Give the folder a name.', code='name_too_short')

    if meeting.photo_folders.filter(name__iexact=tidy).exists():
        raise PhotoRefused(
            f'There is already a folder called “{tidy}”.', code='name_taken'
        )

    # The default has to exist before any custom one, or it sorts after
    # folders that were made before anybody looked at the list.
    default_folder(meeting)

    return PhotoFolder.objects.create(
        meeting=meeting, name=tidy, created_by=user, is_default=False
    )


def rename_folder(meeting, user, folder, name):
    """Rename a custom folder. The default keeps its name."""
    if not may_arrange(meeting, user):
        raise PhotoRefused(
            'Only the host or a co-host can rename a folder.',
            code='not_an_organizer',
        )
    if folder.is_default:
        raise PhotoRefused(
            'The default folder keeps its name.', code='folder_is_default'
        )

    tidy = ' '.join((name or '').split())[:120]
    if len(tidy) < 2:
        raise PhotoRefused('Give the folder a name.', code='name_too_short')
    if meeting.photo_folders.filter(name__iexact=tidy).exclude(id=folder.id).exists():
        raise PhotoRefused(
            f'There is already a folder called “{tidy}”.', code='name_taken'
        )

    folder.name = tidy
    folder.save(update_fields=['name', 'updated_at'])
    return folder


def delete_folder(meeting, user, folder):
    """Remove a custom folder. What was in it moves to the default."""
    if not may_arrange(meeting, user):
        raise PhotoRefused(
            'Only the host or a co-host can remove a folder.',
            code='not_an_organizer',
        )
    if folder.is_default:
        raise PhotoRefused(
            'The default folder stays.', code='folder_is_default'
        )

    # The photographs are the record of the day; the folder is only where
    # they were filed, so removing the shelf does not burn the album.
    keep = default_folder(meeting)
    with transaction.atomic():
        folder.photos.update(folder=keep)
        folder.delete()
    return keep


def _drive_folder_id(folder):
    """This folder's place in the host's Drive, made on first use."""
    from src.apps.artifacts.services.artifact_service import MeetingArtifactService

    if folder.drive_folder_id:
        return folder.drive_folder_id

    meeting = folder.meeting
    service = MeetingArtifactService(meeting.id, meeting.host_id)
    parent = service.get_or_create_photos_folder()
    made = service.drive_adapter.create_folder(folder.name, parent_id=parent)

    folder.drive_folder_id = made['id']
    folder.save(update_fields=['drive_folder_id', 'updated_at'])
    return folder.drive_folder_id


def store_photo(folder, uploaded_file, user, caption=''):
    """Put one photograph in a folder, in the host's own Drive."""
    from src.apps.artifacts.models import MeetingPhoto
    from src.apps.artifacts.services.artifact_service import MeetingArtifactService

    meeting = folder.meeting
    check_can_upload(meeting, user)

    if uploaded_file.size > MAX_PHOTO_BYTES:
        raise PhotoRefused(
            f'That photograph is larger than '
            f'{MAX_PHOTO_BYTES // (1024 * 1024)}MB.',
            code='too_large',
        )

    kind = (getattr(uploaded_file, 'content_type', '') or '').lower()
    if kind and not kind.startswith('image/'):
        raise PhotoRefused('That is not a photograph.', code='not_an_image')

    service = MeetingArtifactService(meeting.id, meeting.host_id)
    stored = service.drive_adapter.upload_file(
        file_obj=uploaded_file,
        filename=uploaded_file.name,
        mime_type=kind or 'image/jpeg',
        parent_id=_drive_folder_id(folder),
    )

    return MeetingPhoto.objects.create(
        folder=folder,
        meeting=meeting,
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

    adapter = GoogleDriveAdapter(str(photo.meeting.host_id))
    return adapter.download_file(photo.drive_file_id)
