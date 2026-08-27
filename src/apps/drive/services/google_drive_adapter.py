"""
Google Drive API adapter - abstraction layer for all Drive operations
Allows for future provider swapping (S3, OneDrive, etc)
"""
import io
import logging
from typing import Optional, List, Dict, Any
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.auth.transport.requests import Request
from src.apps.accounts.models import GoogleConnection
from src.utilities.exceptions import DriveException

logger = logging.getLogger(__name__)


class GoogleDriveAdapter:
    """
    Adapter for Google Drive API operations
    Manages authentication, folder creation, file operations
    """

    SCOPES = [
        'https://www.googleapis.com/auth/drive.appdata',
    ]

    def __init__(self, user_id: str):
        """Initialize adapter with user's Google connection"""
        self.user_id = user_id
        self.service = None
        self._get_service()

    def _get_service(self):
        """Get authenticated Drive service"""
        try:
            connection = GoogleConnection.objects.get(
                user_id=self.user_id,
                is_active=True
            )

            if connection.is_token_expired():
                self._refresh_token(connection)

            from google.oauth2.credentials import Credentials
            creds = Credentials(
                token=connection.access_token,
                refresh_token=connection.refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id='YOUR_CLIENT_ID',
                client_secret='YOUR_CLIENT_SECRET'
            )

            self.service = build('drive', 'v3', credentials=creds)

        except GoogleConnection.DoesNotExist:
            raise DriveException(f"No Google connection found for user {self.user_id}")
        except Exception as e:
            logger.error(f"Failed to initialize Drive service: {str(e)}")
            raise DriveException(f"Failed to initialize Drive service: {str(e)}")

    def _refresh_token(self, connection: GoogleConnection):
        """Refresh expired OAuth token"""
        try:
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials

            creds = Credentials(
                token=connection.access_token,
                refresh_token=connection.refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id='YOUR_CLIENT_ID',
                client_secret='YOUR_CLIENT_SECRET'
            )

            creds.refresh(Request())
            connection.access_token = creds.token
            if creds.expiry:
                connection.token_expiry = creds.expiry
            connection.save()

            logger.info(f"Refreshed token for user {self.user_id}")

        except Exception as e:
            logger.error(f"Failed to refresh token: {str(e)}")
            raise DriveException(f"Failed to refresh token: {str(e)}")

    def create_folder(self, folder_name: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        """Create a folder in Google Drive"""
        try:
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder'
            }
            if parent_id:
                file_metadata['parents'] = [parent_id]

            folder = self.service.files().create(
                body=file_metadata,
                fields='id, name, webViewLink, createdTime'
            ).execute()

            logger.info(f"Created Drive folder: {folder_name} (ID: {folder.get('id')})")
            return folder

        except HttpError as e:
            logger.error(f"Drive API error creating folder: {str(e)}")
            raise DriveException(f"Failed to create folder '{folder_name}': {str(e)}")

    def create_document(self, doc_name: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        """Create a Google Doc for transcripts/notes"""
        try:
            file_metadata = {
                'name': doc_name,
                'mimeType': 'application/vnd.google-apps.document'
            }
            if parent_id:
                file_metadata['parents'] = [parent_id]

            doc = self.service.files().create(
                body=file_metadata,
                fields='id, name, webViewLink, createdTime'
            ).execute()

            logger.info(f"Created Google Doc: {doc_name} (ID: {doc.get('id')})")
            return doc

        except HttpError as e:
            logger.error(f"Drive API error creating document: {str(e)}")
            raise DriveException(f"Failed to create document '{doc_name}': {str(e)}")

    def upload_file(
        self,
        file_obj,
        filename: str,
        mime_type: str,
        parent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload a binary file (document, image, ...) to Drive.

        `file_obj` is any readable binary stream, e.g. an UploadedFile.
        """
        try:
            file_metadata: Dict[str, Any] = {'name': filename}
            if parent_id:
                file_metadata['parents'] = [parent_id]

            media = MediaIoBaseUpload(
                file_obj,
                mimetype=mime_type or 'application/octet-stream',
                resumable=True,
            )

            uploaded = self.service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id, name, mimeType, size, webViewLink, createdTime',
            ).execute()

            logger.info(f"Uploaded file to Drive: {filename} (ID: {uploaded.get('id')})")
            return uploaded

        except HttpError as e:
            logger.error(f"Drive API error uploading file: {str(e)}")
            raise DriveException(f"Failed to upload '{filename}': {str(e)}")

    def share_file(self, file_id: str, email: str, role: str = 'reader') -> bool:
        """Grant a person access to a file or folder.

        Returns False rather than raising: a share that fails should not undo
        an upload that succeeded.
        """
        try:
            self.service.permissions().create(
                fileId=file_id,
                body={'type': 'user', 'role': role, 'emailAddress': email},
                sendNotificationEmail=False,
                fields='id',
            ).execute()
            logger.info(f"Shared {file_id} with {email} as {role}")
            return True

        except HttpError as e:
            logger.warning(f"Could not share {file_id} with {email}: {str(e)}")
            return False

    def download_file(self, file_id: str) -> bytes:
        """Fetch a file's bytes.

        Lets the server hand a file to someone who has no Drive access of
        their own, such as a guest, without loosening the file's sharing.
        """
        try:
            request = self.service.files().get_media(fileId=file_id)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)

            done = False
            while not done:
                _, done = downloader.next_chunk()

            return buffer.getvalue()

        except HttpError as e:
            logger.error(f"Drive API error downloading file: {str(e)}")
            raise DriveException(f"Failed to download file: {str(e)}")

    def list_files(self, folder_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """List files in a Drive folder"""
        try:
            query = f"'{folder_id}' in parents and trashed=false"
            results = self.service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name, mimeType, size, modifiedTime, webViewLink)',
                pageSize=limit
            ).execute()

            files = results.get('files', [])
            logger.info(f"Listed {len(files)} files in folder {folder_id}")
            return files

        except HttpError as e:
            logger.error(f"Drive API error listing files: {str(e)}")
            raise DriveException(f"Failed to list files: {str(e)}")

    def get_file_metadata(self, file_id: str) -> Dict[str, Any]:
        """Get metadata for a specific file"""
        try:
            file = self.service.files().get(
                fileId=file_id,
                fields='id, name, mimeType, size, modifiedTime, webViewLink, createdTime'
            ).execute()
            return file

        except HttpError as e:
            logger.error(f"Drive API error getting file metadata: {str(e)}")
            raise DriveException(f"Failed to get file metadata: {str(e)}")

    def delete_file(self, file_id: str) -> bool:
        """Delete a file or folder from Drive"""
        try:
            self.service.files().delete(fileId=file_id).execute()
            logger.info(f"Deleted file/folder: {file_id}")
            return True

        except HttpError as e:
            logger.error(f"Drive API error deleting file: {str(e)}")
            raise DriveException(f"Failed to delete file: {str(e)}")
