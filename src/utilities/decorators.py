import functools
import time
from django.core.cache import cache
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status

def rate_limit(requests=60, period=60):
    """
    Rate limit decorator for views
    """
    def decorator(view_func):
        @functools.wraps(view_func)
        def wrapped_view(view_instance, request, *args, **kwargs):
            if not hasattr(request, 'user') or not request.user.is_authenticated:
                # Use IP for anonymous
                key = f"rate_limit_anon_{request.META.get('REMOTE_ADDR')}_{view_func.__name__}"
            else:
                key = f"rate_limit_user_{request.user.id}_{view_func.__name__}"
            
            # Get current count
            count = cache.get(key, 0)
            
            if count >= requests:
                return JsonResponse(
                    {'error': 'Rate limit exceeded. Please try again later.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS
                )
            
            # Increment count
            cache.set(key, count + 1, period)
            
            return view_func(view_instance, request, *args, **kwargs)
        return wrapped_view
    return decorator

def log_request(func):
    """
    Log request details
    """
    @functools.wraps(func)
    def wrapper(self, request, *args, **kwargs):
        from src.utilities.logger import get_logger
        logger = get_logger(__name__)
        
        start_time = time.time()
        
        # Log request
        logger.info(f"Request: {request.method} {request.path} from {request.user}",
                    extra={'user_id': getattr(request.user, 'id', None)})
        
        # Execute view
        response = func(self, request, *args, **kwargs)
        
        # Log response time
        duration = time.time() - start_time
        logger.info(f"Response: {response.status_code} in {duration:.3f}s")
        
        return response
    return wrapper

def catch_exceptions(func):
    """
    Catch and log exceptions
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        from src.utilities.logger import get_logger
        logger = get_logger(__name__)
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Exception in {func.__name__}: {str(e)}", exc_info=True)
            raise
    return wrapper