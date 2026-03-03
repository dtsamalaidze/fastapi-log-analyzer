# -*- coding: utf-8 -*-
# run.py
import uvicorn
import webbrowser
from threading import Timer
import sys
from pathlib import Path

# Добавляем текущую папку в PATH
sys.path.insert(0, str(Path(__file__).parent))

try:
    from app import config
except ImportError as e:
    print(f"❌ Ошибка импорта: {e}")
    print("   Убедитесь, что структура проекта правильная:")
    print("   - app/config.py существует")
    print("   - app/main.py существует")
    print("   - app/log_analyzer.py существует")
    print("   - app/auth.py существует")
    sys.exit(1)


def check_logs_folder():
    """Проверяет наличие папки с логами и файлов"""
    logs_path = Path(config.LOG_FOLDER)

    if not logs_path.exists():
        print(f"⚠️ Папка не найдена: {config.LOG_FOLDER}")
        print(f"   Создаю папку: {config.LOG_FOLDER}")
        logs_path.mkdir(parents=True, exist_ok=True)
        return False

    log_files = list(logs_path.glob("*.log"))

    if not log_files:
        print(f"⚠️ В папке нет лог-файлов: {config.LOG_FOLDER}")
        return False

    print(f"✅ Папка найдена: {config.LOG_FOLDER}")
    print(f"📄 Найдено лог-файлов: {len(log_files)}")

    for i, f in enumerate(log_files[:5], 1):
        size_kb = f.stat().st_size / 1024
        print(f"   {i}. {f.name} ({size_kb:.1f} KB)")

    if len(log_files) > 5:
        print(f"   ... и еще {len(log_files) - 5} файлов")

    return True


def create_data_folder():
    """Создает папку для данных"""
    data_path = Path(config.DATA_FOLDER)
    data_path.mkdir(parents=True, exist_ok=True)
    print(f"📁 Папка для данных: {data_path}")
    return True


def open_browser():
    """Открывает браузер после запуска сервера"""
    webbrowser.open(f'http://{config.HOST}:{config.PORT}')


def main():
    """Главная функция запуска"""
    print("=" * 70)
    print("🚀 FASTAPI LOG ANALYZER")
    print("=" * 70)

    print(f"\n📁 КОНФИГУРАЦИЯ:")
    print(f"   Папка с логами: {config.LOG_FOLDER}")
    print(f"   Папка с данными: {config.DATA_FOLDER}")
    print(f"   Веб-интерфейс: http://{config.HOST}:{config.PORT}")

    print(f"\n🔍 ПРОВЕРКА:")
    create_data_folder()
    has_logs = check_logs_folder()

    print("\n" + "=" * 70)

    if not has_logs:
        print("\n⚠️  ВНИМАНИЕ: Нет лог-файлов для анализа!")
        print(f"   Поместите лог-файлы в папку: {config.LOG_FOLDER}")
        print("   или измените путь в app/config.py")
        print("=" * 70)

    print("\n🔄 Запуск сервера...")
    Timer(2.0, open_browser).start()

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info"
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Сервер остановлен")
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
