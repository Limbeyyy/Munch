import logging
import json
from django.conf import settings

class JSONFormatter(logging.Formatter):
    """
    JSON formatter for structured logging
    """
    def format(self, record):
        log_data = {
            'level': record.levelname,
            'time': self.formatTime(record, self.datefmt),
            'module': record.module,
            'message': record.getMessage(),
            'pathname': record.pathname,
            'lineno': record.lineno,
        }
        if hasattr(record, 'user_id'):
            log_data['user_id'] = record.user_id
        if hasattr(record, 'meeting_code'):
            log_data['meeting_code'] = record.meeting_code
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        return json.dumps(log_data)

def get_logger(name):
    """Get a logger with appropriate configuration"""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        if settings.DEBUG:
            formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        else:
            formatter = JSONFormatter()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)
    return logger