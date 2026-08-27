#!/bin/bash
# Comprehensive import migration script
# Migrates all Python files to use the new modular architecture paths

set -e

echo "🔄 Starting import migration..."

# Function to replace imports in files
replace_imports() {
    local pattern=$1
    local replacement=$2
    local message=$3

    find . -type f -name "*.py" -not -path "./venv/*" -not -path "./.git/*" -not -path "./migrations/*" \
        -exec sed -i "s|${pattern}|${replacement}|g" {} \;

    echo "✅ ${message}"
}

# Core replacements
replace_imports "from apps\." "from src.apps." "Updated: apps imports"
replace_imports "import apps\." "import src.apps." "Updated: apps imports (import statement)"
replace_imports "from core\." "from src.utilities." "Updated: core imports"
replace_imports "import core\." "import src.utilities." "Updated: core imports (import statement)"
replace_imports "from workers\." "from src.workers." "Updated: workers imports"
replace_imports "import workers\." "import src.workers." "Updated: workers imports (import statement)"
replace_imports "from api\.v1" "from src.api.versions.v1" "Updated: API imports"

# Update Django settings module references
replace_imports "meeting_platform\.settings" "config.settings" "Updated: settings module references"
replace_imports "'meeting_platform\.urls'" "'config.urls'" "Updated: ROOT_URLCONF"
replace_imports "'meeting_platform\.asgi\.application'" "'config.asgi.application'" "Updated: ASGI_APPLICATION"
replace_imports "'meeting_platform\.wsgi\.application'" "'config.wsgi.application'" "Updated: WSGI_APPLICATION"

# Update Celery references
replace_imports "meeting_platform\.celery" "config.celery" "Updated: Celery module references"

echo ""
echo "✨ Import migration complete!"
echo ""
echo "Next steps:"
echo "1. Review any test failures: pytest src/tests/"
echo "2. Check for remaining import errors: python manage.py check"
echo "3. Run migrations: python manage.py migrate"
echo "4. Start services: python manage.py runserver"
