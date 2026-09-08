"""Send a table to the reader's own Google Sheets."""
import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.drive.services.sheets import SheetExportError, export_rows

logger = logging.getLogger(__name__)

#: Which report is being exported, and what to call the file. Named here
#: rather than sent by the client so two people exporting the same report
#: get the same title, and so the name is not something a caller chooses.
TITLES = {
    'attendance': 'Manch attendance',
    'report': 'Manch event report',
    'analytics': 'Manch analytics',
}


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def export_to_sheet(request):
    """Create a Sheet of the posted rows in this person's own Drive.

    The rows come from the screen the reader is looking at, so what they
    get is what they were shown - a server-side rebuild of the same numbers
    is a second implementation waiting to disagree with the first.

    It lands in their Drive, on the Google credentials they granted at
    sign-in, and the response carries the link to open it.
    """
    kind = str(request.data.get('kind', '')).strip()
    rows = request.data.get('rows')
    suffix = str(request.data.get('subject', '')).strip()[:80]

    if kind not in TITLES:
        return Response(
            {'error': f'kind must be one of {sorted(TITLES)}', 'code': 'unknown_kind'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
        return Response(
            {'error': 'rows must be a list of lists', 'code': 'bad_rows'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from django.utils import timezone

    title = TITLES[kind]
    if suffix:
        title = f'{title} — {suffix}'
    title = f'{title} ({timezone.localtime():%Y-%m-%d %H:%M})'

    try:
        sheet = export_rows(request.user, title=title, rows=rows)
    except SheetExportError as refusal:
        # Not connected is the caller's to put right, so it is a 409 rather
        # than a 500: nothing here is broken.
        code = getattr(refusal, 'code', 'sheet_failed')
        return Response(
            {'error': str(refusal), 'code': code},
            status=(
                status.HTTP_409_CONFLICT
                if code in ('google_not_connected', 'google_reauth_needed')
                else status.HTTP_400_BAD_REQUEST
                if code in ('nothing_to_export', 'too_many_rows', 'too_many_columns')
                else status.HTTP_502_BAD_GATEWAY
            ),
        )

    return Response(sheet, status=status.HTTP_201_CREATED)
