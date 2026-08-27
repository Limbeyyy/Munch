import re
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

def validate_meeting_code(value):
    """
    Validate meeting code format (alphanumeric, 6-10 characters, no ambiguous characters)
    """
    pattern = re.compile(r'^[A-Z0-9]{6,10}$')
    if not pattern.match(value):
        raise ValidationError(
            _('Meeting code must be 6-10 alphanumeric characters (uppercase)'),
            code='invalid_meeting_code'
        )
    # Exclude ambiguous characters
    ambiguous = ['0', 'O', '1', 'I', 'L']
    if any(c in value for c in ambiguous):
        raise ValidationError(
            _('Meeting code cannot contain ambiguous characters: 0, O, 1, I, L'),
            code='ambiguous_characters'
        )

def validate_file_size(size_in_bytes, max_size_mb=100):
    """
    Validate file size
    """
    max_bytes = max_size_mb * 1024 * 1024
    if size_in_bytes > max_bytes:
        raise ValidationError(
            _('File size exceeds maximum allowed size of %(max_size_mb)s MB'),
            params={'max_size_mb': max_size_mb},
            code='file_too_large'
        )

def validate_url_safe(value):
    """
    Validate that a string is URL-safe
    """
    import urllib.parse
    if not urllib.parse.quote(value) == value:
        raise ValidationError(
            _('Value must be URL-safe'),
            code='not_url_safe'
        )