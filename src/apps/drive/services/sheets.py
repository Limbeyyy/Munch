"""Putting a table into the reader's own Google account.

A downloaded CSV is a file in somebody's Downloads folder: it cannot be
shared, it goes stale the moment the register changes, and on a phone it
often cannot be opened at all. A Sheet is a link the host can send to
whoever needs it.

The sheet is created in the signed-in person's **own** Drive, on the
credentials they granted at sign-in, so it belongs to them and not to this
service - nothing here holds a copy or needs a service account. The
``drive.file`` scope the login already asks for is exactly the permission
for this: it lets an app create files of its own in a user's Drive without
being able to see anything else in it.

Uploading a CSV and asking Drive to convert it does the whole job in one
call, so there is no Sheets API dance and no second round trip to fill the
cells in.
"""
import csv
import io
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

#: A guard on the request body, not a Sheets limit. Anything approaching
#: this is a report that wanted a database, not a spreadsheet.
MAX_ROWS = 20000
MAX_COLUMNS = 100


class SheetExportError(Exception):
    """Something between here and Drive said no."""

    def __init__(self, message, code='sheet_failed'):
        super().__init__(message)
        self.code = code


def as_csv(rows) -> bytes:
    """The rows as a CSV file Drive can convert.

    A byte-order mark, because Sheets and Excel both read one as "this is
    UTF-8" - without it Nepali headings arrive as mojibake.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(['' if cell is None else str(cell) for cell in row])
    return b'\xef\xbb\xbf' + buffer.getvalue().encode('utf-8')


def credentials_for(user):
    """The user's own Google credentials, refreshed if they have gone stale."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    from src.apps.accounts.models import GoogleConnection

    connection = (
        GoogleConnection.objects.filter(user=user, is_active=True)
        .order_by('-updated_at')
        .first()
    )
    if connection is None:
        raise SheetExportError(
            'This account is not connected to Google. Sign in with Google to '
            'export to Sheets.',
            code='google_not_connected',
        )

    creds = Credentials(
        token=connection.access_token,
        refresh_token=connection.refresh_token,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=settings.GOOGLE_DRIVE_SCOPES,
    )

    if connection.is_token_expired():
        if not connection.refresh_token:
            raise SheetExportError(
                'Your Google sign-in has expired. Sign in with Google again to '
                'export to Sheets.',
                code='google_reauth_needed',
            )
        try:
            creds.refresh(Request())
        except Exception as e:
            logger.warning(f"Could not refresh Google token for {user.email}: {e}")
            raise SheetExportError(
                'Your Google sign-in has expired. Sign in with Google again to '
                'export to Sheets.',
                code='google_reauth_needed',
            )
        connection.access_token = creds.token
        if creds.expiry:
            connection.token_expiry = creds.expiry
        connection.save(update_fields=['_access_token', 'token_expiry', 'updated_at'])

    return creds


def export_rows(user, *, title, rows):
    """Create a Sheet of these rows in this person's Drive.

    Returns the id and the link to open it. The link is Drive's own, so it
    opens under whichever Google account the reader is signed into - and
    the file is in that account's Drive, which is the point.
    """
    table = [list(row) for row in rows]
    if not table:
        raise SheetExportError('There is nothing to export.', code='nothing_to_export')
    if len(table) > MAX_ROWS:
        raise SheetExportError(
            f'That is {len(table)} rows; {MAX_ROWS} is the most this can export '
            'in one go.',
            code='too_many_rows',
        )
    if max(len(row) for row in table) > MAX_COLUMNS:
        raise SheetExportError('Too many columns to export.', code='too_many_columns')

    creds = credentials_for(user)

    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload

    try:
        service = build('drive', 'v3', credentials=creds)
        media = MediaIoBaseUpload(
            io.BytesIO(as_csv(table)), mimetype='text/csv', resumable=False
        )
        created = service.files().create(
            body={'name': title, 'mimeType': SHEET_MIME},
            media_body=media,
            fields='id,name,webViewLink',
        ).execute()
    except SheetExportError:
        raise
    except Exception as e:
        # The message carries Google's own words, which say far more about a
        # bad client or a missing scope than any wording of ours could.
        logger.error(f"Sheet export failed for {user.email}: {e}")
        raise SheetExportError(f'Google would not create the sheet: {e}')

    logger.info(f"Exported '{title}' to a sheet for {user.email}")
    return {
        'id': created.get('id'),
        'name': created.get('name', title),
        'url': created.get('webViewLink'),
    }
