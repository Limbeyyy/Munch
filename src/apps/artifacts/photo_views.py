"""Reading and adding the photographs from a meeting.

Who may see them is the same question as who may see the meeting, so the
existing visibility rules answer it. Who may add them is narrower, and
lives in ``photos``.
"""
import logging

from rest_framework import status
from rest_framework.decorators import (
    api_view, parser_classes, permission_classes,
)
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.artifacts import photos as photo_service
from src.apps.artifacts.models import MeetingPhoto, PhotoFolder

logger = logging.getLogger(__name__)


def _refused(error):
    """Turn a refusal into the status that describes it."""
    codes = {
        'not_an_organizer': status.HTTP_403_FORBIDDEN,
        'meeting_not_finished': status.HTTP_409_CONFLICT,
        'folder_is_default': status.HTTP_409_CONFLICT,
        'name_taken': status.HTTP_409_CONFLICT,
    }
    return Response(
        {'error': str(error), 'code': error.code},
        status=codes.get(error.code, status.HTTP_400_BAD_REQUEST),
    )


def _meeting_for(user, meeting_ref):
    """The meeting behind a code or an id, if this person may see it."""
    from src.apps.meetings.access import meetings_visible_to
    from src.apps.meetings.models import Meeting

    visible = Meeting.objects.filter(meetings_visible_to(user)).distinct()
    found = visible.filter(meeting_code=str(meeting_ref).upper()).first()
    if found is None and str(meeting_ref).count('-') >= 4:
        found = visible.filter(pk=meeting_ref).first()
    return found


def _photo_json(photo, request):
    """One photograph, with a link the browser can put in an <img>."""
    return {
        'id': str(photo.id),
        'folder_id': str(photo.folder_id),
        'caption': photo.caption,
        'mime_type': photo.mime_type,
        'file_size': photo.file_size,
        'taken_by': (
            photo.uploaded_by.display_name if photo.uploaded_by else ''
        ),
        'taken_by_id': str(photo.uploaded_by_id) if photo.uploaded_by_id else '',
        'is_mine': bool(
            photo.uploaded_by_id and str(photo.uploaded_by_id) == str(request.user.id)
        ),
        'created_at': photo.created_at,
        # Served from here rather than from Drive: a Drive link opens Drive's
        # own viewer and asks the reader to sign in to an account they may
        # not have, which is no use as the source of a preview.
        'url': f'/api/v1/meetings/photos/{photo.id}/file/',
    }


def _folder_json(folder, request, counts):
    return {
        'id': str(folder.id),
        'name': folder.name,
        'is_default': folder.is_default,
        'created_by': folder.created_by.display_name if folder.created_by else '',
        'is_mine': bool(
            folder.created_by_id and str(folder.created_by_id) == str(request.user.id)
        ),
        'photo_count': counts.get(folder.id, 0),
        'created_at': folder.created_at,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def meeting_photos(request, meeting_ref):
    """Every folder for this meeting, and the photographs in them."""
    meeting = _meeting_for(request.user, meeting_ref)
    if meeting is None:
        return Response(
            {'error': f'No meeting found for {meeting_ref}'},
            status=status.HTTP_404_NOT_FOUND,
        )

    folders = list(photo_service.folders_for(meeting))
    rows = list(
        MeetingPhoto.objects.filter(meeting=meeting).select_related('uploaded_by')
    )

    counts = {}
    for photo in rows:
        counts[photo.folder_id] = counts.get(photo.folder_id, 0) + 1

    return Response({
        'meeting_id': str(meeting.id),
        'meeting_code': meeting.meeting_code,
        'meeting_title': meeting.title,
        'meeting_is_finished': photo_service.meeting_is_done(meeting),
        # Whether this person may add one *now*: the permission and the
        # timing together, so the page does not offer a button the server
        # is going to refuse.
        'can_upload': (
            photo_service.may_upload(meeting, request.user)
            and photo_service.meeting_is_done(meeting)
        ),
        'is_a_photographer': photo_service.may_upload(meeting, request.user),
        'can_arrange': photo_service.may_arrange(meeting, request.user),
        'folders': [_folder_json(f, request, counts) for f in folders],
        'photos': [_photo_json(p, request) for p in rows],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_photo_folder(request, meeting_ref):
    """Make a folder to file photographs under. Host and co-hosts only."""
    meeting = _meeting_for(request.user, meeting_ref)
    if meeting is None:
        return Response(
            {'error': f'No meeting found for {meeting_ref}'},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        folder = photo_service.create_folder(
            meeting, request.user, request.data.get('name', '')
        )
    except photo_service.PhotoRefused as refusal:
        return _refused(refusal)

    return Response(
        _folder_json(folder, request, {}), status=status.HTTP_201_CREATED
    )


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def photo_folder(request, meeting_ref, folder_id):
    """Rename a folder, or remove it and keep what was inside."""
    meeting = _meeting_for(request.user, meeting_ref)
    if meeting is None:
        return Response(
            {'error': f'No meeting found for {meeting_ref}'},
            status=status.HTTP_404_NOT_FOUND,
        )

    folder = PhotoFolder.objects.filter(id=folder_id, meeting=meeting).first()
    if folder is None:
        return Response(
            {'error': 'No such folder'}, status=status.HTTP_404_NOT_FOUND
        )

    try:
        if request.method == 'DELETE':
            kept = photo_service.delete_folder(meeting, request.user, folder)
            return Response({'moved_to': str(kept.id)})
        renamed = photo_service.rename_folder(
            meeting, request.user, folder, request.data.get('name', '')
        )
    except photo_service.PhotoRefused as refusal:
        return _refused(refusal)

    return Response(_folder_json(renamed, request, {}))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_photo(request, meeting_ref, folder_id):
    """Add a photograph to one folder."""
    meeting = _meeting_for(request.user, meeting_ref)
    if meeting is None:
        return Response(
            {'error': f'No meeting found for {meeting_ref}'},
            status=status.HTTP_404_NOT_FOUND,
        )

    folder = PhotoFolder.objects.filter(id=folder_id, meeting=meeting).first()
    if folder is None:
        return Response(
            {'error': 'No such folder'}, status=status.HTTP_404_NOT_FOUND
        )

    picture = request.FILES.get('file')
    if picture is None:
        return Response(
            {'error': 'No photograph provided', 'code': 'no_file'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        photo = photo_service.store_photo(
            folder, picture, request.user, caption=request.data.get('caption', '')
        )
    except photo_service.PhotoRefused as refusal:
        return _refused(refusal)
    except Exception as e:
        logger.error(f"Photo upload failed for {meeting.meeting_code}: {e}")
        return Response(
            {'error': f'Could not store the photograph: {e}'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(_photo_json(photo, request), status=status.HTTP_201_CREATED)


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def photo_file(request, photo_id):
    """The photograph itself, or its removal.

    Sent inline so a page can show it without the reader clicking each one,
    and streamed from here on the host's credentials so the file's own
    sharing settings are left alone.
    """
    from django.http import HttpResponse

    photo = MeetingPhoto.objects.filter(id=photo_id).select_related('meeting').first()
    if photo is None:
        return Response(
            {'error': 'No such photograph'}, status=status.HTTP_404_NOT_FOUND
        )

    # Seeing the meeting is what entitles somebody to see its photographs.
    if _meeting_for(request.user, photo.meeting.meeting_code) is None:
        return Response(
            {'error': 'No such photograph'}, status=status.HTTP_404_NOT_FOUND
        )

    if request.method == 'DELETE':
        mine = str(photo.uploaded_by_id or '') == str(request.user.id)
        if not (mine or photo_service.may_arrange(photo.meeting, request.user)):
            return Response(
                {
                    'error': 'Only the host, a co-host, or whoever added it can '
                             'remove a photograph.',
                    'code': 'not_an_organizer',
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    try:
        content = photo_service.photo_bytes(photo)
    except Exception as e:
        logger.error(f"Could not fetch photo {photo.id}: {e}")
        return Response(
            {'error': 'Could not fetch this photograph'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    response = HttpResponse(
        content, content_type=photo.mime_type or 'image/jpeg'
    )
    response['Content-Disposition'] = (
        f'inline; filename="{photo.caption or photo.id}"'
    )
    response['Content-Length'] = str(len(content))
    # The bytes never change once uploaded, so the browser may keep them.
    response['Cache-Control'] = 'private, max-age=86400'
    return response
