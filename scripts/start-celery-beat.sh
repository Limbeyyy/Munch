#!/bin/bash
source venv/bin/activate
set -a
source .env
set +a
celery -A config.celery beat -l info
