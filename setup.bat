@echo off
echo ========================================
echo FASTAPI LOG ANALYZER - УСТАНОВКА
echo ========================================
echo.

echo [1/3] Проверка Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python не найден!
    echo Пожалуйста, установите Python 3.8 или выше
    pause
    exit /b 1
)
echo ✅ Python найден

echo [2/3] Установка зависимостей...
pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ Ошибка установки зависимостей
    pause
    exit /b 1
)
echo ✅ Зависимости установлены

echo [3/3] Запуск приложения...
echo.
python run.py

pause