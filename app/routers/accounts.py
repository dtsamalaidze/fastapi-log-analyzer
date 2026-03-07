# -*- coding: utf-8 -*-
# app/routers/accounts.py
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import distinct

from app.deps import require_auth, require_admin
from app.database import account_db, role_db, department_db
from app.db import SessionLocal
from app.models import LogUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/me/permissions")
async def get_my_permissions(request: Request):
    user = require_auth(request)
    perms = account_db.get_permissions(user['username'])
    return JSONResponse({"permissions": perms})


@router.get("/api/scope-options")
async def get_scope_options(request: Request):
    """Returns available data_scope options (admin only)."""
    require_admin(request)
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/scope-options: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/roles")
async def get_roles(request: Request):
    require_admin(request)
    return JSONResponse({"roles": role_db.get_all()})


@router.post("/api/roles/create")
async def create_role(request: Request):
    try:
        require_admin(request)
        data = await request.json()
        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        permissions = data.get('permissions', {})
        if not name:
            return JSONResponse(status_code=400, content={"error": "Название роли обязательно"})
        success = role_db.create(name, description, permissions)
        if success:
            return JSONResponse({"success": True, "message": f"Роль '{name}' создана"})
        return JSONResponse(status_code=409, content={"error": f"Роль '{name}' уже существует"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/roles/create: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.put("/api/roles/{role_name}")
async def update_role(role_name: str, request: Request):
    try:
        require_admin(request)
        data = await request.json()
        role_db.update(role_name, description=data.get('description'), permissions=data.get('permissions'))
        return JSONResponse({"success": True, "message": "Роль обновлена"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/roles/%s: %s", role_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.delete("/api/roles/{role_name}")
async def delete_role(role_name: str, request: Request):
    require_admin(request)
    success = role_db.delete(role_name)
    if success:
        return JSONResponse({"success": True, "message": f"Роль '{role_name}' удалена"})
    return JSONResponse(status_code=400, content={"error": "Роль не найдена или является встроенной"})


@router.get("/api/accounts")
async def get_accounts(request: Request):
    try:
        require_admin(request)
        return JSONResponse(content={"accounts": account_db.get_all()})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/accounts/create")
async def create_account(request: Request):
    try:
        require_admin(request)
        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        role = data.get('role', 'viewer')
        if not username or not password or not name:
            return JSONResponse(status_code=400, content={"error": "Логин, пароль и имя обязательны"})
        if not role_db.get(role):
            return JSONResponse(status_code=400, content={"error": "Неверная роль"})
        if len(password) < 8:
            return JSONResponse(status_code=400, content={"error": "Пароль должен быть не менее 8 символов"})
        success = account_db.create(username, password, name, role)
        if success:
            return JSONResponse({"success": True, "message": f"Аккаунт '{username}' создан"})
        return JSONResponse(status_code=409, content={"error": f"Логин '{username}' уже занят"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/create: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.put("/api/accounts/{username}")
async def update_account(username: str, request: Request):
    try:
        user = require_admin(request)
        data = await request.json()
        name = (data.get('name') or '').strip()
        role = data.get('role')
        if role and not role_db.get(role):
            return JSONResponse(status_code=400, content={"error": "Неверная роль"})
        if role and role != 'admin' and username == user['username']:
            return JSONResponse(status_code=400, content={"error": "Нельзя изменить собственную роль"})
        if role and role != 'admin':
            target = account_db.get(username)
            if target and target['role'] == 'admin' and account_db.count_admins() <= 1:
                return JSONResponse(status_code=400, content={"error": "Невозможно убрать роль у последнего администратора"})
        success = account_db.update(username, name=name, role=role)
        if success:
            return JSONResponse({"success": True, "message": "Аккаунт обновлён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/%s: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.put("/api/accounts/{username}/password")
async def update_account_password(username: str, request: Request):
    try:
        user = require_auth(request)
        if user['role'] != 'admin' and user['username'] != username:
            raise HTTPException(status_code=403, detail="Доступ запрещён")
        data = await request.json()
        password = data.get('password', '').strip()
        if not password or len(password) < 8:
            return JSONResponse(status_code=400, content={"error": "Пароль должен быть не менее 8 символов"})
        success = account_db.update_password_and_invalidate_sessions(username, password)
        if success:
            logger.info("AUDIT | user=%s | change_password | target=%s", user['username'], username)
            return JSONResponse({"success": True, "message": "Пароль изменён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/%s/password: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.delete("/api/accounts/{username}")
async def delete_account(username: str, request: Request):
    try:
        user = require_admin(request)
        if username == user['username']:
            return JSONResponse(status_code=400, content={"error": "Нельзя удалить собственный аккаунт"})
        target = account_db.get(username)
        if target and target['role'] == 'admin' and account_db.count_admins() <= 1:
            return JSONResponse(status_code=400, content={"error": "Невозможно удалить последнего администратора"})
        success = account_db.delete(username)
        if success:
            logger.info("AUDIT | user=%s | delete_account | target=%s", user['username'], username)
            return JSONResponse({"success": True, "message": f"Аккаунт '{username}' удалён"})
        return JSONResponse(status_code=404, content={"error": "Аккаунт не найден"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/%s delete: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/accounts/{username}/permissions")
async def get_account_permissions(username: str, request: Request):
    try:
        require_admin(request)
        perms = account_db.get_permissions(username)
        return JSONResponse({"username": username, "permissions": perms})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/%s/permissions GET: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.put("/api/accounts/{username}/permissions")
async def set_account_permissions(username: str, request: Request):
    try:
        require_admin(request)
        data = await request.json()
        account_db.set_permissions(username, data.get('permissions', {}))
        return JSONResponse({"success": True, "message": "Права доступа сохранены"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/accounts/%s/permissions PUT: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
