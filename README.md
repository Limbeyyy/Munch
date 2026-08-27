# Meeting Platform

A multi-tenant meeting platform with Google Drive integration.

## Features

- Real-time video/audio meetings using WebRTC
- Google Drive integration for meeting artifacts
- Transcript storage and synchronization
- Meeting notes and shared resources
- Attendance tracking
- Role-based permissions
- Asynchronous background processing with Celery
- REST API with JWT authentication

## Architecture

- **Backend**: Django 4.2 + Django REST Framework
- **Database**: PostgreSQL
- **Cache/Queue**: Redis + Celery
- **Real-time**: Django Channels + WebSockets
- **Storage**: Google Drive API

## Installation

1. Clone the repository
2. Create a virtual environment: `python -m venv venv`
3. Activate: `source venv/bin/activate`
4. Install dependencies: `pip install -r requirements.txt`
5. Copy `.env.example` to `.env` and fill in credentials
6. Run migrations: `python manage.py migrate`
7. Create superuser: `python manage.py createsuperuser`
8. Run server: `python manage.py runserver`

## Docker

```bash
docker-compose up -d