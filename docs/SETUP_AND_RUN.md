# 🚀 Complete Setup & Run Guide

**Status:** ✅ All systems verified and ready

---

## 📋 What's Been Completed

### ✅ Backend (Django)
- Perfect modular architecture with `config/` and `src/` structure
- 9 Django apps properly configured
- Environment-specific settings (local, production)
- API routing structure ready
- Database models for all features
- Services layer for business logic
- Celery workers for async tasks

### ✅ Frontend (React)
- 14 full-featured pages
- 9 Zustand state management stores
- 80+ API endpoints typed in TypeScript
- 30+ TypeScript interfaces
- Complete form submissions & data management
- Professional UI with Tailwind CSS

### ✅ Both Verified
- Django: `System check identified no issues ✓`
- React: All imports and exports valid

---

## 🛠️ Environment Setup

### 1. **Backend Environment Variables**

Create `.env` file in project root (or use existing `.env.dev`):

```bash
# Core Django
SECRET_KEY=cu4ozekl_6jjz0u326qd0$_f3^o2$*z313_ji2v=p!h0u%4%2@
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0
DJANGO_ENV=local

# Database
DB_NAME=munch_db
DB_USER=munch
DB_PASSWORD=munch
DB_HOST=localhost
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379/0
REDIS_HOST=localhost
REDIS_PORT=6379

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 2. **Frontend Environment Variables**

Create `.env` in `Munch-frontend/`:

```bash
REACT_APP_API_URL=http://localhost:8000/api/v1
REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

---

## 📦 Prerequisites

### Required Services

Before running the application, ensure these are running:

```bash
# 1. PostgreSQL Database
sudo systemctl start postgresql

# 2. Redis Cache/Broker
redis-server

# 3. (Optional) Create DB
createdb munch_db
createuser munch
# In psql:  ALTER USER munch WITH PASSWORD 'munch';
# GRANT ALL PRIVILEGES ON DATABASE munch_db TO munch;
```

Or use Docker:

```bash
# PostgreSQL + Redis (Docker)
docker compose up -d

# Or individually:
docker run -d --name postgres \
  -e POSTGRES_DB=munch_db \
  -e POSTGRES_USER=munch \
  -e POSTGRES_PASSWORD=munch \
  -p 5432:5432 \
  postgres:15

docker run -d --name redis -p 6379:6379 redis:latest
```

---

## ▶️ Running the Application

### Terminal 1: Django Backend API

```bash
# Activate virtual environment
source venv/bin/activate

# Load environment (if using .env.dev)
export $(cat .env.dev | grep -v '#' | xargs)

# Or set manually:
export SECRET_KEY="cu4ozekl_6jjz0u326qd0\$_f3^o2\$*z313_ji2v=p!h0u%4%2@"
export DEBUG=True
export DJANGO_ENV=local
export DJANGO_SETTINGS_MODULE=config.settings.local

# (Optional) Run migrations
python manage.py migrate

# (Optional) Create superuser
python manage.py createsuperuser

# Start Django development server
python manage.py runserver 0.0.0.0:8000
```

**Server runs at:** http://localhost:8000

**API available at:** http://localhost:8000/api/v1/

**Admin at:** http://localhost:8000/admin

---

### Terminal 2: Celery Worker (for async tasks)

```bash
source venv/bin/activate
export $(cat .env.dev | grep -v '#' | xargs)

# Start Celery worker
celery -A config.celery worker -l info
```

---

### Terminal 3: Celery Beat (for scheduled tasks)

```bash
source venv/bin/activate
export $(cat .env.dev | grep -v '#' | xargs)

# Start Celery beat scheduler
celery -A config.celery beat -l info
```

---

### Terminal 4: React Frontend

```bash
cd Munch-frontend

# Install dependencies (first time only)
npm install

# Start development server
npm start
```

**Frontend runs at:** http://localhost:3000

---

## 📝 Quick Commands

### Django

```bash
# Check system health
python manage.py check

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Collect static files
python manage.py collectstatic

# Shell
python manage.py shell

# Run tests
python manage.py test

# API documentation
# Swagger: http://localhost:8000/swagger/
# ReDoc: http://localhost:8000/redoc/
```

### React

```bash
# Install dependencies
npm install

# Start dev server
npm start

# Build for production
npm run build

# Run tests
npm test
```

---

## 🔗 URLs & Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| Django API | http://localhost:8000/api/v1 | REST API endpoints |
| Django Admin | http://localhost:8000/admin | Administrative panel |
| Swagger Docs | http://localhost:8000/swagger/ | API documentation |
| ReDoc Docs | http://localhost:8000/redoc/ | Alternative API docs |
| React Frontend | http://localhost:3000 | User interface |

---

## 🗺️ Project Structure

```
Munch/
├── config/                    # Django configuration
│   ├── settings/
│   │   ├── base.py
│   │   ├── local.py
│   │   └── production.py
│   ├── asgi.py, wsgi.py, urls.py, celery.py
│   └── __init__.py
│
├── src/                       # Application source code
│   ├── apps/                  # Django apps
│   │   ├── accounts/
│   │   ├── meetings/
│   │   ├── transcription/
│   │   ├── artifacts/
│   │   ├── recordings/
│   │   ├── organizations/
│   │   ├── drive/
│   │   ├── monitoring/
│   │   └── realtime/
│   │
│   ├── integrations/          # External service adapters
│   ├── api/versions/v1/       # API routing
│   ├── workers/               # Celery tasks
│   ├── utilities/             # Shared utilities
│   └── tests/                 # Test suite
│
├── Munch-frontend/            # React frontend
│   ├── src/
│   │   ├── pages/             # React pages
│   │   ├── store/             # Zustand stores
│   │   ├── services/          # API client
│   │   ├── types/             # TypeScript types
│   │   └── App.tsx
│   └── package.json
│
├── manage.py
├── requirements.txt
├── docker-compose.yml
├── .env                       # Environment variables
└── .env.dev                   # Development defaults

```

---

## ✅ Verification Checklist

Before committing to development:

- [ ] PostgreSQL running
- [ ] Redis running  
- [ ] Virtual environment activated
- [ ] `.env` file configured
- [ ] `python manage.py check` passes
- [ ] Django server starts without errors
- [ ] React server starts without errors
- [ ] Can access http://localhost:3000
- [ ] Can access http://localhost:8000/admin

---

## 🐛 Troubleshooting

### Django Check Fails
```bash
# Verify environment variables
echo $DJANGO_SETTINGS_MODULE
echo $SECRET_KEY

# Re-run check
python manage.py check --verbose
```

### Database Connection Error
```bash
# Check PostgreSQL
psql -U munch -d munch_db -h localhost

# Create database if needed
createdb munch_db
createuser -P munch  # Enter password: munch
psql -d munch_db -c "GRANT ALL PRIVILEGES ON DATABASE munch_db TO munch;"
```

### Redis Connection Error
```bash
# Check Redis
redis-cli ping  # Should return PONG

# Start Redis if not running
redis-server
```

### React can't reach API
```bash
# Ensure Django is running on port 8000
# Check CORS settings in config/settings/base.py
# Verify REACT_APP_API_URL in Munch-frontend/.env
```

---

## 📚 Key Documentation Files

- **FRONTEND_COMPLETE.md** - React frontend complete documentation
- **ARCHITECTURE_MIGRATION_COMPLETE.md** - Backend architecture details
- **PERFECT_DJANGO_ARCHITECTURE.md** - Django patterns and best practices

---

## 🚀 Next Steps

1. **Start all services** (4 terminals as shown above)
2. **Create admin user** for Django
3. **Login** at http://localhost:3000
4. **Create meetings** and test features
5. **Monitor** Celery tasks in second terminal
6. **Check logs** for any errors

---

## 💡 Development Tips

- Hot reload is enabled for both Django and React
- Django shell for quick testing: `python manage.py shell`
- React DevTools browser extension recommended
- Use `python manage.py dbshell` for direct SQL queries
- Monitor Celery tasks in real-time in Terminal 2

---

**Everything is ready to go!** 🎉

Questions or issues? Check the documentation files listed above.
