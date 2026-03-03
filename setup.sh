#!/bin/bash

echo "========================================"
echo "FASTAPI LOG ANALYZER - УСТАНОВКА"
echo "========================================"
echo

echo "[1/3] Проверка Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python не найден!"
    echo "Пожалуйста, установите Python 3.8 или выше"
    exit 1
fi
echo "✅ Python найден"

echo "[2/3] Установка зависимостей..."
pip3 install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi
echo "✅ Зависимости установлены"

echo "[3/3] Запуск приложения..."
echo
python3 run.py