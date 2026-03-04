# -*- coding: utf-8 -*-
# app/main.py
import asyncio
import logging
import threading
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import sys
from datetime import datetime, timedelta
from typing import Optional

# ============= RATE LIMITER =============
_rate_lock = threading.Lock()

_login_attempts: dict[str, list[datetime]] = defaultdict(list)
_LOGIN_MAX_ATTEMPTS = 10   # попыток с одного IP за окно
_LOGIN_WINDOW_SEC   = 60   # окно в секундах

_user_fail_count: dict[str, int] = defaultdict(int)
_user_locked_until: dict[str, datetime] = {}
_USER_MAX_FAILS  = 5       # неудачных попыток до блокировки аккаунта
_USER_LOCK_SEC   = 300     # блокировка на 5 минут

def _check_rate_limit(ip: str) -> bool:
    """Возвращает True если IP-лимит не превышен."""
    with _rate_lock:
        now = datetime.now()
        cutoff = now - timedelta(seconds=_LOGIN_WINDOW_SEC)
        _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
        if len(_login_attempts[ip]) >= _LOGIN_MAX_ATTEMPTS:
            return False
        _login_attempts[ip].append(now)
        return True

def _check_user_lockout(username: str) -> bool:
    """Возвращает True если аккаунт не заблокирован."""
    with _rate_lock:
        locked_until = _user_locked_until.get(username)
        return not (locked_until and datetime.now() < locked_until)

def _record_failed_login(username: str) -> None:
    """Фиксирует неудачную попытку входа; блокирует аккаунт при превышении лимита."""
    with _rate_lock:
        _user_fail_count[username] += 1
        if _user_fail_count[username] >= _USER_MAX_FAILS:
            _user_locked_until[username] = datetime.now() + timedelta(seconds=_USER_LOCK_SEC)
            _user_fail_count[username] = 0
            logger.warning("Аккаунт %s заблокирован на %d сек после %d неудачных попыток",
                           username, _USER_LOCK_SEC, _USER_MAX_FAILS)

def _reset_user_lockout(username: str) -> None:
    """Сбрасывает счётчик неудач при успешном входе."""
    with _rate_lock:
        _user_fail_count.pop(username, None)
        _user_locked_until.pop(username, None)

sys.path.append(str(Path(__file__).parent.parent))

logger = logging.getLogger(__name__)

from app import config
from app.log_analyzer import LogAnalyzer
from app.auth import (
    auth_manager, global_apps_manager, department_apps_manager,
    department_manager
)
from app.s3_sync import s3_syncer


async def _s3_sync_loop():
    """Фоновая задача: синхронизация logs/ из S3 раз в S3_SYNC_INTERVAL секунд."""
    from app import config
    loop = asyncio.get_running_loop()
    while True:
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, s3_syncer.sync),
                timeout=300,
            )
            if result.get('downloaded', 0) > 0:
                logger.info("S3 скачал %d файлов — запускаю обработку логов...", result['downloaded'])
                await loop.run_in_executor(None, analyzer.process_log_files)
        except asyncio.TimeoutError:
            logger.error("S3 синхронизация превысила таймаут 300 сек")
        except Exception as e:
            logger.error("S3 фоновая синхронизация: %s", e, exc_info=True)
        await asyncio.sleep(config.S3_SYNC_INTERVAL)


async def _initial_log_load():
    """Начальная загрузка логов при старте сервера."""
    loop = asyncio.get_running_loop()
    try:
        logger.info("Начальная загрузка логов...")
        result = await loop.run_in_executor(None, analyzer.process_log_files)
        logger.info("Начальная загрузка завершена: обработано %d из %d файлов", result['processed'], result['candidates'])
        await loop.run_in_executor(None, analyzer.resolve_computer_ips)
    except Exception as e:
        logger.error("Ошибка при начальной загрузке логов: %s", e, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app import config
    from app.database import db_manager
    db_manager.bootstrap()
    analyzer.global_allowed = [a.lower() for a in global_apps_manager.get_allowed_apps()]
    analyzer.global_blocked = [a.lower() for a in global_apps_manager.get_blocked_apps()]
    logger.info("Global allowed apps: %d", len(analyzer.global_allowed))
    logger.info("Global blocked apps: %d", len(analyzer.global_blocked))
    logger.info("Departments: %d", len(department_manager.get_all_departments()))

    await _initial_log_load()

    s3_task = None
    if config.S3_ENABLED:
        s3_task = asyncio.create_task(_s3_sync_loop())
        logger.info("S3-синхронизация запущена (каждые %d мин, бакет: %s)", config.S3_SYNC_INTERVAL // 60, config.S3_BUCKET)
    else:
        logger.warning("S3 не настроен — автосинхронизация отключена.")
    yield
    if s3_task:
        s3_task.cancel()
        try:
            await s3_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Log Analyzer", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)

# Создаем директории
config.STATIC_DIR.mkdir(exist_ok=True)
config.DATA_FOLDER.mkdir(exist_ok=True)

# Монтируем assets React-приложения
_spa_assets = config.STATIC_DIR / "dist" / "assets"
try:
    if _spa_assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_spa_assets)), name="spa-assets")
except Exception as e:
    logger.warning("Ошибка монтирования SPA assets: %s", e)

# Создаем анализатор логов (списки заполняются в lifespan после инициализации БД)
analyzer = LogAnalyzer(log_folder=config.LOG_FOLDER)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


# ============= АУТЕНТИФИКАЦИЯ =============

def get_current_user(request: Request):
    """Получает текущего пользователя"""
    return auth_manager.get_current_user(request)


def require_auth(request: Request) -> dict:
    """FastAPI dependency: требует авторизации."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


def require_admin(request: Request) -> dict:
    """FastAPI dependency: требует роли admin."""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    return user


def get_user_data_scope(request: Request) -> dict:
    """Возвращает data_scope текущего пользователя. Admins — без ограничений."""
    user = get_current_user(request)
    if not user or user['role'] == 'admin':
        return {'departments': [], 'cities': [], 'users': []}
    from app.database import account_db
    perms = account_db.get_permissions(user['username'])
    return perms.get('data_scope', {'departments': [], 'cities': [], 'users': []})


def apply_data_scope(users_data: list, data_scope: dict) -> list:
    """Фильтрует пользователей по data_scope. Пустые списки = нет ограничений (OR между типами)."""
    depts = set(data_scope.get('departments', []))
    cities = set(data_scope.get('cities', []))
    users_set = set(data_scope.get('users', []))
    if not depts and not cities and not users_set:
        return users_data
    result = []
    for u in users_data:
        if depts and (u.get('department') or '') in depts:
            result.append(u)
        elif cities and (u.get('city') or '') in cities:
            result.append(u)
        elif users_set and u['username'] in users_set:
            result.append(u)
    return result


# ============= JSON AUTH ENDPOINTS =============

@app.post("/api/auth/login")
async def api_login(request: Request):
    """JSON-аутентификация для React SPA"""
    try:
        ip = request.client.host if request.client else 'unknown'
        if not _check_rate_limit(ip):
            return JSONResponse(status_code=429, content={"error": "Слишком много попыток входа. Подождите минуту."})
        data = await request.json()
        username = data.get('username', '')
        password = data.get('password', '')
        if not _check_user_lockout(username):
            return JSONResponse(status_code=429, content={"error": "Аккаунт временно заблокирован. Попробуйте позже."})
        token = auth_manager.authenticate(username, password)
        if token:
            _reset_user_lockout(username)
            from app.database import user_db
            user = user_db.get_user(username)
            response = JSONResponse({
                "success": True,
                "user": {"username": user['username'], "role": user['role']} if user else None
            })
            response.set_cookie(
                key="session_token",
                value=token,
                max_age=config.SESSION_MAX_AGE,
                httponly=True,
                secure=config.COOKIE_SECURE,
                samesite="lax",
                path="/"
            )
            return response
        else:
            _record_failed_login(username)
            return JSONResponse(status_code=401, content={"error": "Неверное имя пользователя или пароль"})
    except Exception as e:
        logger.error("Ошибка в /api/auth/login: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/auth/logout")
async def api_logout(request: Request):
    """JSON-выход для React SPA"""
    token = request.cookies.get('session_token')
    if token:
        auth_manager.logout(token)
    response = JSONResponse({"success": True})
    response.delete_cookie("session_token", path="/")
    return response


# ============= API =============

@app.get("/api/users")
async def get_users(request: Request):
    """API для получения данных пользователей со статусами приложений"""
    try:
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        return JSONResponse(content=users_data)
    except Exception as e:
        logger.error("Ошибка в /api/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/stats")
async def get_stats(request: Request):
    """API для получения статистики"""
    try:
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        stats_data = analyzer.get_global_stats(users_data)
        return JSONResponse(content=stats_data)
    except Exception as e:
        logger.error("Ошибка в /api/stats: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ГЛОБАЛЬНЫХ ПРИЛОЖЕНИЙ =============

@app.get("/api/global/allowed")
async def get_global_allowed(request: Request):
    """Получает список глобально разрешенных приложений"""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        apps = global_apps_manager.get_allowed_apps()
        return JSONResponse({
            "apps": apps,
            "count": len(apps)
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/global/allowed/add")
async def add_global_allowed(request: Request):
    """Добавляет приложение в глобально разрешенные"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        # Удаляем из глобально заблокированных, если было там
        global_apps_manager.remove_blocked_app(app_name)

        success = global_apps_manager.add_allowed_app(app_name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_global_allowed | app=%s", user['username'], app_name)

        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_allowed_apps(),
            "message": "Приложение добавлено в глобально разрешенные" if success else "Приложение уже в списке"
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/global/allowed/remove")
async def remove_global_allowed(request: Request):
    """Удаляет приложение из глобально разрешенных"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        success = global_apps_manager.remove_allowed_app(app_name)
        logger.info("AUDIT | user=%s | remove_global_allowed | app=%s", user['username'], app_name)

        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_allowed_apps(),
            "message": "Приложение удалено из глобально разрешенных" if success else "Приложение не найдено"
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/global/blocked")
async def get_global_blocked(request: Request):
    """Получает список глобально заблокированных приложений"""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        apps = global_apps_manager.get_blocked_apps()
        return JSONResponse({
            "apps": apps,
            "count": len(apps)
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/global/blocked/add")
async def add_global_blocked(request: Request):
    """Добавляет приложение в глобально заблокированные"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        # Удаляем из глобально разрешенных, если было там
        global_apps_manager.remove_allowed_app(app_name)

        success = global_apps_manager.add_blocked_app(app_name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_global_blocked | app=%s", user['username'], app_name)

        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_blocked_apps(),
            "message": "Приложение добавлено в глобально заблокированные" if success else "Приложение уже в списке"
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/global/blocked/remove")
async def remove_global_blocked(request: Request):
    """Удаляет приложение из глобально заблокированных"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        success = global_apps_manager.remove_blocked_app(app_name)
        logger.info("AUDIT | user=%s | remove_global_blocked | app=%s", user['username'], app_name)

        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_blocked_apps(),
            "message": "Приложение удалено из глобально заблокированных" if success else "Приложение не найдено"
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ОТДЕЛОВ =============

@app.get("/api/departments")
async def get_departments(request: Request):
    """Получает список всех отделов со статистикой"""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        departments = department_manager.get_departments_with_stats()
        return JSONResponse({"departments": departments})
    except Exception as e:
        logger.error("Ошибка в /api/departments: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/add")
async def add_department(request: Request):
    """Добавляет новый отдел"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        name = (data.get('name') or '').strip()

        if not name:
            return JSONResponse(status_code=400, content={"error": "Не указано название отдела"})

        success = department_manager.add_department(name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_department | name=%s", user['username'], name)

        return JSONResponse({
            "success": success,
            "message": "Отдел добавлен" if success else "Отдел уже существует"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/remove")
async def remove_department(request: Request):
    """Удаляет отдел"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        name = (data.get('name') or '').strip()

        if not name:
            return JSONResponse(status_code=400, content={"error": "Не указано название отдела"})

        success = department_manager.remove_department(name)
        if success:
            logger.info("AUDIT | user=%s | remove_department | name=%s", user['username'], name)

        return JSONResponse({
            "success": success,
            "message": "Отдел удален" if success else "Отдел не найден"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/set-user")
async def set_user_department(request: Request):
    """Устанавливает отдел пользователя"""
    try:
        data = await request.json()
        username = data.get('username')
        department = data.get('department')

        if not username:
            return JSONResponse(status_code=400, content={"error": "Не указан пользователь"})

        success = department_manager.set_user_department(username, department)

        return JSONResponse({
            "success": success,
            "message": f"Отдел пользователя {username} изменен на {department}" if success else "Ошибка при изменении отдела"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/set-user: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/departments/{department_name}/apps")
async def get_department_apps(department_name: str):
    """Получает списки приложений для отдела"""
    try:
        allowed = department_apps_manager.get_department_allowed(department_name)
        blocked = department_apps_manager.get_department_blocked(department_name)

        return JSONResponse({
            "department": department_name,
            "allowed": allowed,
            "blocked": blocked,
            "allowed_count": len(allowed),
            "blocked_count": len(blocked)
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/{department_name}/apps: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/{department_name}/apps/allowed/add")
async def add_department_allowed(department_name: str, request: Request):
    """Добавляет разрешенное приложение для отдела"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        # Удаляем из заблокированных для этого отдела, если было там
        department_apps_manager.remove_department_blocked(department_name, app_name)

        success = department_apps_manager.add_department_allowed(department_name, app_name, user['username'])

        return JSONResponse({
            "success": success,
            "message": f"Приложение добавлено в разрешенные для отдела {department_name}" if success else "Приложение уже в списке"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/{department_name}/apps/allowed/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/{department_name}/apps/allowed/remove")
async def remove_department_allowed(department_name: str, request: Request):
    """Удаляет разрешенное приложение для отдела"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        success = department_apps_manager.remove_department_allowed(department_name, app_name)

        return JSONResponse({
            "success": success,
            "message": f"Приложение удалено из разрешенных для отдела {department_name}" if success else "Приложение не найдено"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/{department_name}/apps/allowed/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/{department_name}/apps/blocked/add")
async def add_department_blocked(department_name: str, request: Request):
    """Добавляет заблокированное приложение для отдела"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        # Удаляем из разрешенных для этого отдела, если было там
        department_apps_manager.remove_department_allowed(department_name, app_name)

        success = department_apps_manager.add_department_blocked(department_name, app_name, user['username'])

        return JSONResponse({
            "success": success,
            "message": f"Приложение добавлено в заблокированные для отдела {department_name}" if success else "Приложение уже в списке"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/{department_name}/apps/blocked/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/departments/{department_name}/apps/blocked/remove")
async def remove_department_blocked(department_name: str, request: Request):
    """Удаляет заблокированное приложение для отдела"""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})

        success = department_apps_manager.remove_department_blocked(department_name, app_name)

        return JSONResponse({
            "success": success,
            "message": f"Приложение удалено из заблокированных для отдела {department_name}" if success else "Приложение не найдено"
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/{department_name}/apps/blocked/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ОБРАБОТКИ ЛОГОВ =============

@app.post("/api/logs/process")
async def process_logs(request: Request):
    """Триггер обработки логов. По умолчанию инкрементально. Передайте {'force_full': true} для полного."""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

        data = await request.json() if request.headers.get('content-type', '').startswith('application/json') else {}
        force_full = bool(data.get('force_full', False))
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: analyzer.process_log_files(force_full=force_full))
        await loop.run_in_executor(None, analyzer.resolve_computer_ips)
        return JSONResponse(content={"success": True, "result": result})
    except Exception as e:
        logger.error("Ошибка в /api/logs/process: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/logs/status")
async def logs_status(request: Request):
    """Статус обработки логов (в т.ч. последняя обработка)."""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        status = analyzer.get_processing_status()
        return JSONResponse(content=status)
    except Exception as e:
        logger.error("Ошибка в /api/logs/status: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ОТЧЕТОВ =============

@app.get("/api/reports/users")
async def get_users_report(request: Request):
    """Получает данные для отчета по пользователям со статусами приложений"""
    try:
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        return JSONResponse(content=users_data)
    except Exception as e:
        logger.error("Ошибка в /api/reports/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/reports/apps")
async def get_apps_report(request: Request):
    """Получает данные для отчета по приложениям"""
    try:
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))

        # Собираем статистику по приложениям
        apps_stats = {}
        for user in users_data:
            for app in user['apps']:
                if app['name'] not in apps_stats:
                    apps_stats[app['name']] = {
                        'name': app['name'],
                        'total_launches': 0,
                        'users': set(),
                        'computers': set(),
                        'first_seen': app['first_launch'],
                        'last_seen': app['first_launch'],
                        'global_status': global_apps_manager.get_app_status(app['name']),
                        'status_counts': {
                            'allowed': 0,
                            'blocked': 0,
                            'neutral': 0
                        }
                    }

                apps_stats[app['name']]['total_launches'] += app['launch_count']
                apps_stats[app['name']]['users'].add(user['username'])

                # Считаем статусы для каждого пользователя
                if app['status'] == 'allowed':
                    apps_stats[app['name']]['status_counts']['allowed'] += 1
                elif app['status'] == 'blocked':
                    apps_stats[app['name']]['status_counts']['blocked'] += 1
                else:
                    apps_stats[app['name']]['status_counts']['neutral'] += 1

                if user['computers'] and user['computers'] != 'Не указан':
                    for comp in user['computers'].split(', '):
                        apps_stats[app['name']]['computers'].add(comp)

                if app['first_launch'] < apps_stats[app['name']]['first_seen']:
                    apps_stats[app['name']]['first_seen'] = app['first_launch']
                if app['first_launch'] > apps_stats[app['name']]['last_seen']:
                    apps_stats[app['name']]['last_seen'] = app['first_launch']

        result = []
        for app_name, stats in apps_stats.items():
            result.append({
                'name': app_name,
                'global_status': stats['global_status'],
                'total_launches': stats['total_launches'],
                'users_count': len(stats['users']),
                'computers_count': len(stats['computers']),
                'first_seen': stats['first_seen'],
                'last_seen': stats['last_seen'],
                'status_counts': stats['status_counts']
            })

        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Ошибка в /api/reports/apps: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/reports/computers")
async def get_computers_report(request: Request):
    """Получает данные для отчета по компьютерам"""
    try:
        from app.database import log_user_db
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))

        # Загружаем IP-адреса из БД
        ip_map = {c['name']: c['ip_address'] for c in log_user_db.get_all_computers_with_ips()}

        computers_stats = {}
        for user in users_data:
            if user['computers'] and user['computers'] != 'Не указан':
                for comp in user['computers'].split(', '):
                    if comp not in computers_stats:
                        computers_stats[comp] = {
                            'name': comp,
                            'users': set(),
                            'total_launches': 0,
                            'apps': set(),
                            'last_seen': user['log_date'],
                            'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0}
                        }

                    computers_stats[comp]['users'].add(user['username'])
                    computers_stats[comp]['total_launches'] += user['total_launches']

                    for app in user['apps']:
                        computers_stats[comp]['apps'].add(app['name'])
                        computers_stats[comp]['status_counts'][app['status']] += 1

        result = []
        for comp_name, stats in computers_stats.items():
            result.append({
                'name': comp_name,
                'ip_address': ip_map.get(comp_name) or None,
                'users_count': len(stats['users']),
                'total_launches': stats['total_launches'],
                'apps_count': len(stats['apps']),
                'last_seen': stats['last_seen'],
                'status_counts': stats['status_counts']
            })

        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Ошибка в /api/reports/computers: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/reports/departments")
async def get_departments_report(request: Request):
    """Получает данные для отчета по отделам"""
    try:
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        departments = department_manager.get_departments_with_stats()

        # Собираем статистику по отделам
        depts_stats = {}
        for dept in departments:
            depts_stats[dept['name']] = {
                'name': dept['name'],
                'users': set(),
                'total_launches': 0,
                'apps': set(),
                'computers': set(),
                'status_counts': {
                    'allowed': 0,
                    'blocked': 0,
                    'neutral': 0
                }
            }

        # Добавляем отдел "Не указан"
        depts_stats['Не указан'] = {
            'name': 'Не указан',
            'users': set(),
            'total_launches': 0,
            'apps': set(),
            'computers': set(),
            'status_counts': {
                'allowed': 0,
                'blocked': 0,
                'neutral': 0
            }
        }

        for user in users_data:
            dept_name = user['department'] or 'Не указан'
            if dept_name not in depts_stats:
                depts_stats[dept_name] = {
                    'name': dept_name,
                    'users': set(),
                    'total_launches': 0,
                    'apps': set(),
                    'computers': set(),
                    'status_counts': {
                        'allowed': 0,
                        'blocked': 0,
                        'neutral': 0
                    }
                }

            depts_stats[dept_name]['users'].add(user['username'])
            depts_stats[dept_name]['total_launches'] += user['total_launches']

            # Считаем статусы для отдела
            depts_stats[dept_name]['status_counts']['allowed'] += user['allowed_count']
            depts_stats[dept_name]['status_counts']['blocked'] += user['blocked_count']
            depts_stats[dept_name]['status_counts']['neutral'] += user.get('neutral_count', 0)

            for app in user['apps']:
                depts_stats[dept_name]['apps'].add(app['name'])

            if user['computers'] and user['computers'] != 'Не указан':
                for comp in user['computers'].split(', '):
                    depts_stats[dept_name]['computers'].add(comp)

        result = []
        for dept_name, stats in depts_stats.items():
            if len(stats['users']) > 0:  # Только отделы с пользователями
                result.append({
                    'name': dept_name,
                    'users_count': len(stats['users']),
                    'total_launches': stats['total_launches'],
                    'apps_count': len(stats['apps']),
                    'computers_count': len(stats['computers']),
                    'status_counts': stats['status_counts'],
                    'avg_launches_per_user': stats['total_launches'] // len(stats['users']) if len(
                        stats['users']) > 0 else 0
                })

        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Ошибка в /api/reports/departments: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= ЭНДПОЙНТ ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ =============
@app.get("/api/auth-check")
async def auth_check(request: Request):
    """Проверка авторизации"""
    user = get_current_user(request)
    return JSONResponse({
        "authenticated": user is not None,
        "user": user
    })


# ============= S3-СИНХРОНИЗАЦИЯ =============

@app.get("/api/s3/status")
async def s3_status(request: Request):
    """Статус S3-синхронизации."""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    return JSONResponse(s3_syncer.status())


@app.post("/api/s3/sync")
async def s3_sync_now(request: Request):
    """Принудительная синхронизация logs/ из S3 (только для администратора)."""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, s3_syncer.sync)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= ЗДОРОВЬЕ СЕРВЕРА =============
@app.get("/health")
async def health_check():
    """Проверка работоспособности"""
    log_folder_exists = Path(config.LOG_FOLDER).exists()
    log_files = analyzer.find_all_log_files() if log_folder_exists else []

    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "log_folder": config.LOG_FOLDER,
        "log_folder_exists": log_folder_exists,
        "log_files_count": len(log_files),
        "global_allowed_count": len(global_apps_manager.get_allowed_apps()),
        "global_blocked_count": len(global_apps_manager.get_blocked_apps()),
        "departments_count": len(department_manager.get_all_departments()),
        "templates_exists": config.TEMPLATES_DIR.exists(),
        "static_exists": config.STATIC_DIR.exists(),
        "data_folder_exists": config.DATA_FOLDER.exists()
    }

# ============= ФИО ПОЛЬЗОВАТЕЛЯ =============

@app.post("/api/users/{username}/profile")
async def set_user_profile(username: str, request: Request):
    """Сохраняет профиль пользователя (ФИО, город, адрес, telegram)"""
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    if user['role'] != 'admin':
        from app.database import account_db as _acct_db
        perms = _acct_db.get_permissions(user['username']) or {}
        if not perms.get('users', {}).get('edit_profile'):
            return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        from app.database import log_user_db
        success = log_user_db.set_profile(
            username,
            data.get('last_name', '') or '',
            data.get('first_name', '') or '',
            data.get('middle_name', '') or '',
            data.get('city', '') or '',
            data.get('address', '') or '',
            data.get('telegram', '') or '',
        )
        return JSONResponse({"success": success})
    except Exception as e:
        logger.error("Ошибка в /api/users/{username}/profile: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ДЕТАЛЕЙ КОМПЬЮТЕРОВ =============

@app.get("/api/computers/{computer_name}/users")
async def get_computer_users(computer_name: str, request: Request):
    """Возвращает пользователей компьютера и его IP-адрес"""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        from app.database import log_user_db
        users = log_user_db.get_computer_users(computer_name)
        ip = log_user_db.get_computer_ip(computer_name)
        return JSONResponse(content={
            "name": computer_name,
            "ip_address": ip if ip else None,
            "users": users,
        })
    except Exception as e:
        logger.error("Ошибка в /api/computers/{computer_name}/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= API ДЛЯ ДЕТАЛЕЙ ПРИЛОЖЕНИЙ =============

@app.get("/api/apps/{app_name}/users")
async def get_app_users(app_name: str, request: Request):
    """Получает список пользователей и компьютеров для конкретного приложения"""
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        from app.database import log_app_db
        entries = log_app_db.get_app_users(app_name)
        return JSONResponse(content={"app": app_name, "entries": entries})
    except Exception as e:
        logger.error("Ошибка в /api/apps/{app_name}/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= МОИ ПРАВА И РОЛИ =============

@app.get("/api/scope-options")
async def get_scope_options(request: Request):
    """Возвращает доступные варианты для data_scope (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        from app.database import department_db
        from app.db import SessionLocal
        from app.models import LogUser
        from sqlalchemy import distinct
        dept_names = department_db.get_all_names()
        db = SessionLocal()
        try:
            cities = [
                r[0] for r in
                db.query(distinct(LogUser.city))
                .filter(LogUser.city.isnot(None), LogUser.city != '')
                .order_by(LogUser.city)
                .all()
            ]
            log_users_rows = (
                db.query(LogUser.username, LogUser.last_name, LogUser.first_name, LogUser.middle_name)
                .order_by(LogUser.username)
                .all()
            )
            users_list = []
            for uname, last_name, first_name, middle_name in log_users_rows:
                parts = [p for p in [last_name, first_name, middle_name] if p]
                display_name = ' '.join(parts) if parts else uname
                users_list.append({'username': uname, 'display_name': display_name})
        finally:
            db.close()
        return JSONResponse({'departments': dept_names, 'cities': cities, 'users': users_list})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/me/permissions")
async def get_my_permissions(request: Request):
    """Возвращает права доступа текущего пользователя"""
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=403, content={"error": "Не авторизован"})
    from app.database import account_db
    perms = account_db.get_permissions(user['username'])
    return JSONResponse({"permissions": perms})


@app.get("/api/roles")
async def get_roles(request: Request):
    """Список всех шаблонов ролей (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    from app.database import role_db
    return JSONResponse({"roles": role_db.get_all()})


@app.post("/api/roles/create")
async def create_role(request: Request):
    """Создаёт новый шаблон роли (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        permissions = data.get('permissions', {})
        if not name:
            return JSONResponse(status_code=400, content={"error": "Название роли обязательно"})
        from app.database import role_db
        success = role_db.create(name, description, permissions)
        if success:
            return JSONResponse({"success": True, "message": f"Роль '{name}' создана"})
        return JSONResponse(status_code=409, content={"error": f"Роль '{name}' уже существует"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.put("/api/roles/{role_name}")
async def update_role(role_name: str, request: Request):
    """Обновляет шаблон роли (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        description = data.get('description')
        permissions = data.get('permissions')
        from app.database import role_db
        role_db.update(role_name, description=description, permissions=permissions)
        return JSONResponse({"success": True, "message": "Роль обновлена"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.delete("/api/roles/{role_name}")
async def delete_role(role_name: str, request: Request):
    """Удаляет шаблон роли (только admin, встроенные нельзя удалить)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    from app.database import role_db
    success = role_db.delete(role_name)
    if success:
        return JSONResponse({"success": True, "message": f"Роль '{role_name}' удалена"})
    return JSONResponse(status_code=400, content={"error": "Роль не найдена или является встроенной"})


# ============= УПРАВЛЕНИЕ АККАУНТАМИ =============

@app.get("/api/accounts")
async def get_accounts(request: Request):
    """Список всех системных аккаунтов (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        from app.database import account_db
        accounts = account_db.get_all()
        return JSONResponse(content={"accounts": accounts})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/accounts/create")
async def create_account(request: Request):
    """Создаёт новый аккаунт (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        role = data.get('role', 'viewer')

        if not username or not password or not name:
            return JSONResponse(status_code=400, content={"error": "Логин, пароль и имя обязательны"})
        if role not in ('admin', 'viewer'):
            return JSONResponse(status_code=400, content={"error": "Неверная роль"})
        if len(password) < 6:
            return JSONResponse(status_code=400, content={"error": "Пароль должен быть не менее 6 символов"})

        from app.database import account_db
        success = account_db.create(username, password, name, role)
        if success:
            return JSONResponse({"success": True, "message": f"Аккаунт '{username}' создан"})
        return JSONResponse(status_code=409, content={"error": f"Логин '{username}' уже занят"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.put("/api/accounts/{username}")
async def update_account(username: str, request: Request):
    """Обновляет имя и/или роль аккаунта (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        name = (data.get('name') or '').strip()
        role = data.get('role')

        if role and role not in ('admin', 'viewer'):
            return JSONResponse(status_code=400, content={"error": "Неверная роль"})

        from app.database import account_db
        # Нельзя снять с себя роль admin, если ты последний admin
        if role == 'viewer' and username == user['username']:
            return JSONResponse(status_code=400, content={"error": "Нельзя изменить собственную роль"})
        if role == 'viewer':
            admins = account_db.count_admins()
            target = account_db.get(username)
            if target and target['role'] == 'admin' and admins <= 1:
                return JSONResponse(status_code=400, content={"error": "Невозможно убрать роль у последнего администратора"})

        success = account_db.update(username, name=name, role=role)
        if success:
            return JSONResponse({"success": True, "message": "Аккаунт обновлён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.put("/api/accounts/{username}/password")
async def update_account_password(username: str, request: Request):
    """Обновляет пароль аккаунта (admin — любой, остальные — только свой)"""
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    if user['role'] != 'admin' and user['username'] != username:
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        password = data.get('password', '').strip()
        if not password or len(password) < 6:
            return JSONResponse(status_code=400, content={"error": "Пароль должен быть не менее 6 символов"})

        from app.database import account_db, session_db
        success = account_db.update_password(username, password)
        if success:
            session_db.delete_sessions_by_username(username)
            logger.info("AUDIT | user=%s | change_password | target=%s", user['username'], username)
            return JSONResponse({"success": True, "message": "Пароль изменён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.delete("/api/accounts/{username}")
async def delete_account(username: str, request: Request):
    """Удаляет аккаунт (только admin, нельзя удалить себя)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    if username == user['username']:
        return JSONResponse(status_code=400, content={"error": "Нельзя удалить собственный аккаунт"})
    try:
        from app.database import account_db
        admins = account_db.count_admins()
        target = account_db.get(username)
        if target and target['role'] == 'admin' and admins <= 1:
            return JSONResponse(status_code=400, content={"error": "Невозможно удалить последнего администратора"})

        success = account_db.delete(username)
        if success:
            logger.info("AUDIT | user=%s | delete_account | target=%s", user['username'], username)
            return JSONResponse({"success": True, "message": f"Аккаунт '{username}' удалён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/accounts/{username}/permissions")
async def get_account_permissions(username: str, request: Request):
    """Возвращает права доступа аккаунта (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        from app.database import account_db
        perms = account_db.get_permissions(username)
        return JSONResponse({"username": username, "permissions": perms})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.put("/api/accounts/{username}/permissions")
async def set_account_permissions(username: str, request: Request):
    """Сохраняет права доступа аккаунта (только admin)"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещён"})
    try:
        data = await request.json()
        permissions = data.get('permissions', {})
        from app.database import account_db
        account_db.set_permissions(username, permissions)
        return JSONResponse({"success": True, "message": "Права доступа сохранены"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= ОБСЛУЖИВАНИЕ БАЗЫ ДАННЫХ =============

@app.get("/api/db/stats")
async def get_db_stats(request: Request):
    """Статистика базы данных"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import SessionLocal, engine
        from app.models import (
            User as UserModel, Session as SessionModel, Department as DeptModel,
            GlobalAllowedApp, GlobalBlockedApp, DepartmentAllowedApp, DepartmentBlockedApp,
            LogUser, LogApp, LogAppPath, Computer, UserComputer
        )
        from sqlalchemy import func as sqlfunc, text as sqltext

        db = SessionLocal()
        try:
            db_size = db.execute(sqltext("SELECT pg_database_size(current_database())")).scalar()
            table_models = {
                'users': UserModel,
                'sessions': SessionModel,
                'departments': DeptModel,
                'global_allowed_apps': GlobalAllowedApp,
                'global_blocked_apps': GlobalBlockedApp,
                'department_allowed_apps': DepartmentAllowedApp,
                'department_blocked_apps': DepartmentBlockedApp,
                'log_users': LogUser,
                'log_apps': LogApp,
                'log_app_paths': LogAppPath,
                'computers': Computer,
                'user_computers': UserComputer,
            }
            table_stats = {}
            for t, model in table_models.items():
                try:
                    table_stats[t] = db.query(sqlfunc.count()).select_from(model).scalar()
                except Exception:
                    table_stats[t] = -1
        finally:
            db.close()

        return JSONResponse({
            "engine": "postgresql",
            "db_size": db_size,
            "tables": table_stats,
        })
    except Exception as e:
        logger.error("Ошибка в /api/db/stats: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/db/vacuum")
async def vacuum_db(request: Request):
    """VACUUM ANALYZE — оптимизация базы данных PostgreSQL"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import engine
        from sqlalchemy import text as sqltext

        loop = asyncio.get_running_loop()

        def run_vacuum():
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                conn.execute(sqltext("VACUUM ANALYZE"))

        await loop.run_in_executor(None, run_vacuum)
        return JSONResponse({"success": True, "message": "VACUUM ANALYZE выполнен"})
    except Exception as e:
        logger.error("Ошибка в /api/db/vacuum: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.get("/api/db/backup")
async def backup_db(request: Request):
    """Запускает pg_dump на сервере и возвращает SQL-дамп файлом"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        import subprocess
        import os
        import urllib.parse
        from fastapi.responses import Response as FastAPIResponse

        db_url = config.DATABASE_URL.replace('postgresql+psycopg2://', 'postgresql://')
        parsed = urllib.parse.urlparse(db_url)

        pg_dump_candidates = [
            '/opt/homebrew/opt/postgresql@15/bin/pg_dump',
            '/usr/local/bin/pg_dump',
            'pg_dump',
        ]
        pg_dump_bin = next((p for p in pg_dump_candidates if os.path.isfile(p)), 'pg_dump')

        env = os.environ.copy()
        env['PGPASSWORD'] = parsed.password or ''

        loop = asyncio.get_running_loop()

        def run_dump():
            result = subprocess.run(
                [
                    pg_dump_bin,
                    '-h', parsed.hostname or 'localhost',
                    '-p', str(parsed.port or 5432),
                    '-U', parsed.username or 'postgres',
                    parsed.path.lstrip('/'),
                ],
                capture_output=True,
                env=env,
                timeout=300,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
            return result.stdout

        data = await loop.run_in_executor(None, run_dump)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'log_analyzer_backup_{timestamp}.sql'
        return FastAPIResponse(
            content=data,
            media_type='application/octet-stream',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error("Ошибка в /api/db/backup: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/db/integrity-check")
async def integrity_check_db(request: Request):
    """Проверка доступности базы данных PostgreSQL"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import SessionLocal
        from sqlalchemy import text as sqltext

        loop = asyncio.get_running_loop()

        def run_check():
            db = SessionLocal()
            try:
                db.execute(sqltext("SELECT 1"))
                return True
            finally:
                db.close()

        ok = await loop.run_in_executor(None, run_check)
        return JSONResponse({"success": True, "ok": ok, "results": ["ok"] if ok else ["error"]})
    except Exception as e:
        logger.error("Ошибка в /api/db/integrity-check: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@app.post("/api/db/clear-logs")
async def clear_logs_db(request: Request):
    """Очистка лог-данных"""
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from datetime import timedelta
        from app.db import SessionLocal
        from app.models import LogAppPath, LogApp, UserComputer, LogUser, Computer, Setting

        data = await request.json() if request.headers.get('content-type', '').startswith('application/json') else {}
        older_than_days = data.get('older_than_days')

        if older_than_days is None and not data.get('confirm_delete_all'):
            return JSONResponse(status_code=400, content={
                "error": "Для полной очистки передайте confirm_delete_all: true"
            })

        loop = asyncio.get_running_loop()

        def run_clear():
            db = SessionLocal()
            deleted = {}
            try:
                if older_than_days is not None:
                    cutoff = (datetime.now() - timedelta(days=int(older_than_days))).strftime('%Y-%m-%d')
                    old_user_ids = db.query(LogUser.id).filter(LogUser.last_seen < cutoff).subquery()
                    deleted['log_app_paths'] = db.query(LogAppPath).filter(
                        LogAppPath.user_id.in_(old_user_ids)
                    ).delete(synchronize_session=False)
                    deleted['log_apps'] = db.query(LogApp).filter(
                        LogApp.user_id.in_(old_user_ids)
                    ).delete(synchronize_session=False)
                    deleted['log_users'] = db.query(LogUser).filter(
                        LogUser.last_seen < cutoff
                    ).delete(synchronize_session=False)
                    remaining_user_ids = db.query(LogUser.id).subquery()
                    deleted['user_computers'] = db.query(UserComputer).filter(
                        UserComputer.user_id.notin_(remaining_user_ids)
                    ).delete(synchronize_session=False)
                else:
                    deleted['log_app_paths'] = db.query(LogAppPath).delete(synchronize_session=False)
                    deleted['log_apps'] = db.query(LogApp).delete(synchronize_session=False)
                    deleted['user_computers'] = db.query(UserComputer).delete(synchronize_session=False)
                    deleted['log_users'] = db.query(LogUser).delete(synchronize_session=False)
                    deleted['computers'] = db.query(Computer).delete(synchronize_session=False)
                    deleted['settings'] = db.query(Setting).filter(
                        Setting.key.like('last_processed_%')
                    ).delete(synchronize_session=False)
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            return deleted

        deleted = await loop.run_in_executor(None, run_clear)
        return JSONResponse({"success": True, "deleted": deleted})
    except Exception as e:
        logger.error("Ошибка в /api/db/clear-logs: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= SPA CATCH-ALL =============

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Отдаёт React SPA для всех не-API маршрутов"""
    index = config.STATIC_DIR / "dist" / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return HTMLResponse(
        content="<h1>Frontend not built</h1><p>Run: cd frontend && npm install && npm run build</p>",
        status_code=503
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info"
    )
