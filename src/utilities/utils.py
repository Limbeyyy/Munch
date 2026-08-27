import base64
import hashlib
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.conf import settings
import os
import json
import logging

logger = logging.getLogger(__name__)

def get_encryption_key():
    """
    Get encryption key from settings or generate one
    """
    key = settings.ENCRYPTION_KEY
    
    if not key:
        # Generate a key from SECRET_KEY for development
        salt = b'salt_'
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode()))
    
    return key

def encrypt_token(token):
    """
    Encrypt a token using Fernet symmetric encryption
    """
    if not token:
        return None
    
    try:
        key = get_encryption_key()
        f = Fernet(key)
        encrypted = f.encrypt(token.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    except Exception as e:
        logger.error(f"Failed to encrypt token: {str(e)}")
        return None

def decrypt_token(encrypted_token):
    """
    Decrypt a token using Fernet symmetric encryption
    """
    if not encrypted_token:
        return None
    
    try:
        key = get_encryption_key()
        f = Fernet(key)
        decoded = base64.urlsafe_b64decode(encrypted_token.encode())
        decrypted = f.decrypt(decoded)
        return decrypted.decode()
    except Exception as e:
        logger.error(f"Failed to decrypt token: {str(e)}")
        return None

def generate_meeting_code(length=8):
    """
    Generate a unique meeting code
    """
    import random
    import string
    
    chars = string.ascii_uppercase + string.digits
    # Avoid ambiguous characters
    exclude = ['0', 'O', '1', 'I', 'L']
    chars = ''.join(c for c in chars if c not in exclude)
    
    return ''.join(random.choices(chars, k=length))

def format_duration(seconds):
    """
    Format duration in seconds to human readable format
    """
    if not seconds:
        return "0s"
    
    minutes = int(seconds // 60)
    hours = int(minutes // 60)
    minutes = minutes % 60
    seconds = int(seconds % 60)
    
    if hours > 0:
        return f"{hours}h {minutes}m {seconds}s"
    elif minutes > 0:
        return f"{minutes}m {seconds}s"
    else:
        return f"{seconds}s"

def safe_json_loads(data, default=None):
    """
    Safely load JSON data
    """
    if not data:
        return default or {}
    
    try:
        if isinstance(data, str):
            return json.loads(data)
        return data
    except (json.JSONDecodeError, TypeError):
        return default or {}

def safe_json_dumps(data):
    """
    Safely dump JSON data
    """
    try:
        return json.dumps(data)
    except (TypeError, ValueError):
        return '{}'

def mask_sensitive_data(data, fields=['token', 'password', 'secret']):
    """
    Mask sensitive fields in data for logging
    """
    if not isinstance(data, dict):
        return data
    
    masked = data.copy()
    for field in fields:
        if field in masked:
            masked[field] = '***MASKED***'
    
    return masked

def validate_meeting_code(code):
    """
    Validate meeting code format
    """
    import re
    pattern = re.compile(r'^[A-Z0-9]{6,10}$')
    return bool(pattern.match(code))