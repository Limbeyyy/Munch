import logging
from typing import Dict, Any, Optional
from django.core.cache import cache
from src.apps.meetings.models import Meeting
from src.apps.accounts.models import User

logger = logging.getLogger(__name__)

class MeetingStateService:
    """
    Service for managing meeting state in Redis cache
    """
    
    @staticmethod
    def get_meeting_state(meeting_code: str) -> Optional[Dict[str, Any]]:
        """Get meeting state from cache"""
        key = f"meeting_state_{meeting_code}"
        return cache.get(key)
    
    @staticmethod
    def set_meeting_state(meeting_code: str, state: Dict[str, Any], timeout: int = 10):
        """Store meeting state in cache"""
        key = f"meeting_state_{meeting_code}"
        cache.set(key, state, timeout=timeout)
    
    @staticmethod
    def clear_meeting_state(meeting_code: str):
        """Clear meeting state from cache"""
        cache.delete(f"meeting_state_{meeting_code}")
    
    @staticmethod
    def get_participant_state(meeting_code: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get participant state from cache"""
        key = f"meeting_{meeting_code}_participant_{user_id}"
        return cache.get(key)
    
    @staticmethod
    def set_participant_state(meeting_code: str, user_id: str, state: Dict[str, Any], timeout: int = 3600):
        """Store participant state in cache"""
        key = f"meeting_{meeting_code}_participant_{user_id}"
        cache.set(key, state, timeout=timeout)
    
    @staticmethod
    def update_participant_state(meeting_code: str, user_id: str, updates: Dict[str, Any]):
        """Update participant state in cache"""
        key = f"meeting_{meeting_code}_participant_{user_id}"
        current = cache.get(key)
        if current:
            current.update(updates)
            cache.set(key, current, timeout=3600)
            return current
        return None
    
    @staticmethod
    def clear_participant_state(meeting_code: str, user_id: str):
        """Clear participant state from cache"""
        cache.delete(f"meeting_{meeting_code}_participant_{user_id}")
    
    @staticmethod
    def clear_all_meeting_cache(meeting_code: str):
        """Clear all cache related to a meeting"""
        cache.delete_pattern(f"meeting_{meeting_code}_*")
        cache.delete(f"meeting_state_{meeting_code}")