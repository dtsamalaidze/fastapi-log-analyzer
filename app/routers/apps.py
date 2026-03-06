# -*- coding: utf-8 -*-
# app/routers/apps.py
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth import global_apps_manager
from app.deps import get_current_user, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/global/allowed")
async def get_global_allowed(request: Request):
    require_auth(request)
    try:
        apps = global_apps_manager.get_allowed_apps()
        return JSONResponse({"apps": apps, "count": len(apps)})
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/global/allowed/add")
async def add_global_allowed(request: Request):
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = global_apps_manager.set_allowed_app(app_name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_global_allowed | app=%s", user['username'], app_name)
        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_allowed_apps(),
            "message": "Приложение добавлено в глобально разрешенные" if success else "Приложение уже в списке",
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/global/allowed/remove")
async def remove_global_allowed(request: Request):
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
            "message": "Приложение удалено из глобально разрешенных" if success else "Приложение не найдено",
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/allowed/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/global/blocked")
async def get_global_blocked(request: Request):
    require_auth(request)
    try:
        apps = global_apps_manager.get_blocked_apps()
        return JSONResponse({"apps": apps, "count": len(apps)})
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/global/blocked/add")
async def add_global_blocked(request: Request):
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = global_apps_manager.set_blocked_app(app_name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_global_blocked | app=%s", user['username'], app_name)
        return JSONResponse({
            "success": success,
            "apps": global_apps_manager.get_blocked_apps(),
            "message": "Приложение добавлено в глобально заблокированные" if success else "Приложение уже в списке",
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/global/blocked/remove")
async def remove_global_blocked(request: Request):
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
            "message": "Приложение удалено из глобально заблокированных" if success else "Приложение не найдено",
        })
    except Exception as e:
        logger.error("Ошибка в /api/global/blocked/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/apps/{app_name}/users")
async def get_app_users(app_name: str, request: Request):
    require_auth(request)
    try:
        from app.database import log_app_db
        entries = log_app_db.get_app_users(app_name)
        return JSONResponse(content={"app": app_name, "entries": entries})
    except Exception as e:
        logger.error("Ошибка в /api/apps/%s/users: %s", app_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
