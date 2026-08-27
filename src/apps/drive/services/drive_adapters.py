from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List

class DriveAdapter(ABC):
    """
    Abstract base class for drive storage adapters
    """
    
    @abstractmethod
    def create_folder(self, name: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        pass
    
    @abstractmethod
    def create_document(self, name: str, content: str = '', parent_id: Optional[str] = None) -> Dict[str, Any]:
        pass
    
    @abstractmethod
    def create_sheet(self, name: str, data: Optional[List[List[Any]]] = None, parent_id: Optional[str] = None) -> Dict[str, Any]:
        pass
    
    @abstractmethod
    def append_to_document(self, document_id: str, content: str) -> bool:
        pass
    
    @abstractmethod
    def update_sheet(self, sheet_id: str, range_name: str, values: List[List[Any]]) -> bool:
        pass
    
    @abstractmethod
    def upload_file(self, file_content: bytes, filename: str, mime_type: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        pass
    
    @abstractmethod
    def get_file_content(self, file_id: str) -> Optional[bytes]:
        pass
    
    @abstractmethod
    def move_file(self, file_id: str, new_parent_id: str) -> bool:
        pass
    
    @abstractmethod
    def delete_file(self, file_id: str) -> bool:
        pass
    
    @abstractmethod
    def list_files(self, folder_id: Optional[str] = None, query: Optional[str] = None) -> List[Dict[str, Any]]:
        pass
    
    @abstractmethod
    def ensure_folder_exists(self, folder_path: List[str]) -> Optional[str]:
        pass