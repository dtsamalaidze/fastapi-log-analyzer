# -*- coding: utf-8 -*-
# app/routers/departments.py
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.auth import department_apps_manager, department_manager
from app.deps import require_auth, require_admin

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/departments")
async def get_departments(request: Request):
    require_auth(request)
    try:
        return JSONResponse({"departments": department_manager.get_departments_with_stats()})
    except Exception as e:
        logger.error("Ошибка в /api/departments: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/add")
async def add_department(request: Request):
    try:
        user = require_admin(request)
        data = await request.json()
        name = (data.get('name') or '').strip()
        if not name:
            return JSONResponse(status_code=400, content={"error": "Не указано название отдела"})
        success = department_manager.add_department(name, user['username'])
        if success:
            logger.info("AUDIT | user=%s | add_department | name=%s", user['username'], name)
        return JSONResponse({
            "success": success,
            "message": "Отдел добавлен" if success else "Отдел уже существует",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/add: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/remove")
async def remove_department(request: Request):
    try:
        user = require_admin(request)
        data = await request.json()
        name = (data.get('name') or '').strip()
        if not name:
            return JSONResponse(status_code=400, content={"error": "Не указано название отдела"})
        success = department_manager.remove_department(name)
        if success:
            logger.info("AUDIT | user=%s | remove_department | name=%s", user['username'], name)
        return JSONResponse({
            "success": success,
            "message": "Отдел удален" if success else "Отдел не найден",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/remove: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/set-user")
async def set_user_department(request: Request):
    require_admin(request)
    try:
        data = await request.json()
        username = data.get('username')
        department = data.get('department')
        if not username:
            return JSONResponse(status_code=400, content={"error": "Не указан пользователь"})
        success = department_manager.set_user_department(username, department)
        return JSONResponse({
            "success": success,
            "message": f"Отдел пользователя {username} изменен на {department}" if success else "Ошибка при изменении отдела",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/set-user: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/departments/{department_name}/apps")
async def get_department_apps(department_name: str, request: Request):
    require_auth(request)
    try:
        allowed = department_apps_manager.get_department_allowed(department_name)
        blocked = department_apps_manager.get_department_blocked(department_name)
        return JSONResponse({
            "department": department_name,
            "allowed": allowed,
            "blocked": blocked,
            "allowed_count": len(allowed),
            "blocked_count": len(blocked),
        })
    except Exception as e:
        logger.error("Ошибка в /api/departments/%s/apps: %s", department_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/{department_name}/apps/allowed/add")
async def add_department_allowed(department_name: str, request: Request):
    try:
        user = require_admin(request)
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = department_apps_manager.set_department_allowed(department_name, app_name, user['username'])
        return JSONResponse({
            "success": success,
            "message": f"Приложение добавлено в разрешенные для отдела {department_name}" if success else "Приложение уже в списке",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/%s/apps/allowed/add: %s", department_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/{department_name}/apps/allowed/remove")
async def remove_department_allowed(department_name: str, request: Request):
    try:
        require_admin(request)
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = department_apps_manager.remove_department_allowed(department_name, app_name)
        return JSONResponse({
            "success": success,
            "message": f"Приложение удалено из разрешенных для отдела {department_name}" if success else "Приложение не найдено",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/%s/apps/allowed/remove: %s", department_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/{department_name}/apps/blocked/add")
async def add_department_blocked(department_name: str, request: Request):
    try:
        user = require_admin(request)
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = department_apps_manager.set_department_blocked(department_name, app_name, user['username'])
        return JSONResponse({
            "success": success,
            "message": f"Приложение добавлено в заблокированные для отдела {department_name}" if success else "Приложение уже в списке",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/%s/apps/blocked/add: %s", department_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/departments/{department_name}/apps/blocked/remove")
async def remove_department_blocked(department_name: str, request: Request):
    try:
        require_admin(request)
        data = await request.json()
        app_name = (data.get('app_name') or '').strip()
        if not app_name:
            return JSONResponse(status_code=400, content={"error": "Не указано имя приложения"})
        success = department_apps_manager.remove_department_blocked(department_name, app_name)
        return JSONResponse({
            "success": success,
            "message": f"Приложение удалено из заблокированных для отдела {department_name}" if success else "Приложение не найдено",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/departments/%s/apps/blocked/remove: %s", department_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
