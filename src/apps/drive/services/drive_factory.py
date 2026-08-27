from django.conf import settings
from .drive_adapter import DriveAdapter
from .google_drive_adapter import GoogleDriveAdapter

class DriveFactory:
    """
    Factory to create appropriate drive adapter
    """
    
    @staticmethod
    def get_adapter(provider: str, user_id: str) -> DriveAdapter:
        """
        Get the appropriate drive adapter based on provider
        """
        if provider == 'google':
            return GoogleDriveAdapter(user_id)
        else:
            raise ValueError(f"Unsupported drive provider: {provider}")