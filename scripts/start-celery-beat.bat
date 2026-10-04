@echo off
setlocal
cd /d "%~dp0.."

if not exist "venv\Scripts\activate.bat" (
    echo Could not find venv\Scripts\activate.bat. Create the project virtual environment first.
    exit /b 1
)

call "venv\Scripts\activate.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

python -m celery -A config.celery beat -l info
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
