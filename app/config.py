# -*- coding: utf-8 -*-
# app/config.py
import os
from pathlib import Path

# =============================================
# ЗАГРУЗКА .env (если есть)
# =============================================
BASE_DIR = Path(__file__).parent.parent

_env_file = BASE_DIR / '.env'
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file)
    except ImportError:
        # python-dotenv не установлен — читаем .env вручную
        with open(_env_file) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith('#') and '=' in _line:
                    _key, _, _val = _line.partition('=')
                    os.environ.setdefault(_key.strip(), _val.strip())

# =============================================
# ПУТЬ К ПАПКЕ С ЛОГАМИ
# =============================================
DEFAULT_LOG_FOLDER = 'logs'
LOG_FOLDER = os.environ.get('LOG_FOLDER', DEFAULT_LOG_FOLDER)

# =============================================
# ПУТИ К ПАПКАМ С ДАННЫМИ
# =============================================
DATA_FOLDER = BASE_DIR / 'data'

# =============================================
# НАСТРОЙКИ СЕРВЕРА
# =============================================
HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8000'))
DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

# =============================================
# НАСТРОЙКИ АУТЕНТИФИКАЦИИ
# =============================================
import logging as _logging
import secrets as _secrets
SESSION_SECRET = os.environ.get('SESSION_SECRET', '')
if not SESSION_SECRET:
    SESSION_SECRET = _secrets.token_hex(32)
    _logging.warning("SESSION_SECRET не задан! Используется случайный ключ — сессии сбросятся при перезапуске. Задайте SESSION_SECRET в .env")
SESSION_MAX_AGE = 3600  # 1 час
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'

# =============================================
# YANDEX OBJECT STORAGE (S3-совместимое)
# =============================================
S3_ENDPOINT     = os.environ.get('S3_ENDPOINT',  'https://storage.yandexcloud.net')
S3_ACCESS_KEY   = os.environ.get('S3_ACCESS_KEY', '')
S3_SECRET_KEY   = os.environ.get('S3_SECRET_KEY', '')
S3_BUCKET       = os.environ.get('S3_BUCKET',     '')
S3_PREFIX       = os.environ.get('S3_PREFIX',     'logs')
S3_SYNC_INTERVAL = int(os.environ.get('S3_SYNC_INTERVAL', '3600'))
S3_ENABLED      = bool(S3_ACCESS_KEY and S3_SECRET_KEY and S3_BUCKET)

# =============================================
# БАЗА ДАННЫХ (PostgreSQL через SQLAlchemy)
# =============================================
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql+psycopg2://analyzer:analyzer_secret@localhost:5432/log_analyzer'
)

# =============================================
# CORS
# =============================================
_default_origins = f"http://127.0.0.1:{os.environ.get('PORT', '8000')},http://localhost:{os.environ.get('PORT', '8000')},http://localhost:5173"
CORS_ORIGINS: list[str] = [
    o.strip() for o in os.environ.get('CORS_ORIGINS', _default_origins).split(',') if o.strip()
]

# =============================================
# ПУТИ ПРОЕКТА
# =============================================
STATIC_DIR = BASE_DIR / "static"
