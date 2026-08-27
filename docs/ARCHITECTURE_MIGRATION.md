# Munch: Perfect Architecture Migration Guide

## Overview
This guide walks through migrating from the current structure to the perfect modular architecture.

## Current State
```
munch/
├── apps/                    # Existing apps
├── api/v1/                  # API views/serializers
├── core/                    # Utilities
├── meeting_platform/        # Django settings
├── workers/                 # Celery tasks
└── migrations/              # Migrations
```

## Target State
```
munch/
├── config/                  # Perfect settings structure
├── src/
│   ├── apps/               # Perfect app structure
│   ├── integrations/       # External service adapters
│   ├── api/                # API versioning
│   ├── workers/            # Perfect task structure
│   ├── utilities/          # Shared utilities
│   └── tests/              # Test suite
└── (existing files for reference)
```

## Migration Steps

### Phase 1: Create New Structure ✅
- [x] Create config/ directory
- [x] Create src/ with subdirectories
- [x] Create __init__.py files everywhere

### Phase 2: Move Core Files
```bash
# Move Django settings
cp meeting_platform/settings.py → config/settings/base.py
cp meeting_platform/asgi.py → config/asgi.py
cp meeting_platform/wsgi.py → config/wsgi.py
cp meeting_platform/celery.py → config/celery.py
cp meeting_platform/urls.py → config/urls.py

# Move apps
cp -r apps/* → src/apps/
cp -r core/* → src/utilities/core/
cp -r api/v1/* → src/api/versions/v1/
cp -r workers/* → src/workers/
```

### Phase 3: Update Imports
All imports need to be updated to reflect new paths:

**Before:**
```python
from apps.meetings.models import Meeting
from core.decorators import require_auth
from workers.meeting_worker import create_meeting_folder
```

**After:**
```python
from src.apps.meetings.models import Meeting
from src.utilities.decorators import require_auth
from src.workers.tasks.meetings import create_meeting_folder
```

### Phase 4: Update Django Settings
```python
# config/settings/base.py
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(BASE_DIR, 'src'))

INSTALLED_APPS = [
    # All apps now under src.apps
    'src.apps.accounts',
    'src.apps.meetings',
    # ...
]

ROOT_URLCONF = 'config.urls'
ASGI_APPLICATION = 'config.asgi.application'
WSGI_APPLICATION = 'config.wsgi.application'
```

### Phase 5: Update manage.py
```python
# Update DJANGO_SETTINGS_MODULE
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
```

## Detailed Migration Instructions

### Step 1: Backup Current State
```bash
git commit -m "Pre-architecture migration backup"
git checkout -b feat/perfect-architecture
```

### Step 2: Create Settings Hierarchy

**config/settings/__init__.py:**
```python
from .base import *
```

**config/settings/base.py:**
- Move all common settings from meeting_platform/settings.py
- Set DEBUG = False by default
- Add sys.path insertion for src/

**config/settings/local.py:**
```python
from .base import *
DEBUG = True
# Local-only settings
```

**config/settings/production.py:**
```python
from .base import *
DEBUG = False
# Production-only settings
```

### Step 3: Move Core Apps

Each app should be moved to src/apps/{app_name} with structure:
```
src/apps/{app_name}/
├── __init__.py
├── admin.py           # Django admin
├── apps.py            # App config
├── models.py          # Models
├── views.py           # ViewSets
├── serializers.py     # DRF serializers
├── permissions.py     # Permission classes
├── urls.py            # URL routing
├── filters.py         # DRF filters
├── tests/             # Tests
├── services/          # Business logic
│   ├── __init__.py
│   └── {service}.py
└── signals.py         # Django signals
```

### Step 4: Create Integration Adapters

Move external service code to src/integrations/

**src/integrations/google/drive.py:**
```python
# Move GoogleDriveAdapter here
```

**src/integrations/google/auth.py:**
```python
# Move OAuth logic here
```

**src/integrations/llm/base.py:**
```python
# Create base LLM interface
```

**src/integrations/llm/claude.py:**
```python
# Move Claude implementation here
```

### Step 5: Reorganize Celery Workers

**src/workers/tasks/meetings.py:**
```python
# All meeting-related tasks
@shared_task
def create_meeting_folder(meeting_id, user_id):
    pass
```

**src/workers/tasks/transcription.py:**
```python
# All transcription tasks
```

**src/workers/celery.py:**
```python
# Move from config/celery.py here
```

### Step 6: Update API Structure

**src/api/versions/v1/urls.py:**
```python
from rest_framework.routers import DefaultRouter
from src.apps.accounts.views import UserViewSet
from src.apps.meetings.views import MeetingViewSet

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'meetings', MeetingViewSet)

urlpatterns = router.urls
```

### Step 7: Create Utilities Module

**src/utilities/decorators.py:**
```python
# Move from core/decorators.py
```

**src/utilities/exceptions.py:**
```python
# Move custom exceptions here
```

**src/utilities/validators.py:**
```python
# Move validators here
```

**src/utilities/managers.py:**
```python
# Custom QuerySet managers
```

**src/utilities/mixins.py:**
```python
# Reusable model/view mixins
```

### Step 8: Update Root Files

**manage.py:**
```python
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
```

**config/asgi.py:**
```python
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.asgi.application')
application = get_asgi_application()
```

**config/wsgi.py:**
```python
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.wsgi.application')
application = get_wsgi_application()
```

## Import Updates

### Migration Script
```bash
#!/bin/bash
# Find and replace imports

# apps. → src.apps.
find . -type f -name "*.py" -exec sed -i 's/from apps\./from src.apps./g' {} \;
find . -type f -name "*.py" -exec sed -i 's/import apps\./import src.apps./g' {} \;

# core. → src.utilities.
find . -type f -name "*.py" -exec sed -i 's/from core\./from src.utilities./g' {} \;
find . -type f -name "*.py" -exec sed -i 's/import core\./import src.utilities./g' {} \;

# workers. → src.workers.
find . -type f -name "*.py" -exec sed -i 's/from workers\./from src.workers./g' {} \;
find . -type f -name "*.py" -exec sed -i 's/import workers\./import src.workers./g' {} \;

# api.v1 → src.api.versions.v1
find . -type f -name "*.py" -exec sed -i 's/from api.v1/from src.api.versions.v1/g' {} \;
```

## Testing Migration

### 1. Check for Syntax Errors
```bash
python -m py_compile src/**/*.py
```

### 2. Check Django Status
```bash
python manage.py check
```

### 3. Verify Migrations
```bash
python manage.py migrate --plan
```

### 4. Run Tests
```bash
pytest src/tests/
```

## Rollback Plan

If something goes wrong:
```bash
git reset --hard HEAD
git checkout {previous-branch}
```

## Timeline

- Phase 1 (Structure): 1 hour ✅
- Phase 2 (Move Files): 2 hours
- Phase 3 (Update Imports): 3 hours
- Phase 4 (Update Settings): 1 hour
- Phase 5 (Testing): 2 hours
- **Total: ~9 hours**

## Benefits After Migration

✅ Perfect modular structure  
✅ Easy to find code  
✅ Clear separation of concerns  
✅ Scalable architecture  
✅ Team onboarding friendly  
✅ CI/CD ready  
✅ Testing simplified  

