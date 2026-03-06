# -*- coding: utf-8 -*-
# app/routers/auth.py
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import config
from app.auth import auth_manager
from app.database import user_db
from app.deps import get_current_user
from app.rate_limiter import check_rate_limit, check_user_lockout, record_failed_login, reset_user_lockout

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/auth/login")
async def api_login(request: Request):
    """JSON authentication for React SPA."""
    try:
        ip = request.client.host if request.client else 'unknown'
        if not check_rate_limit(ip):
            return JSONResponse(
                status_code=429,
                content={"error": "Слишком много попыток входа. Подождите минуту."},
            )
        data = await request.json()
        username = data.get('username', '')
        password = data.get('password', '')
        if not check_user_lockout(username):
            return JSONResponse(
                status_code=429,
                content={"error": "Аккаунт временно заблокирован. Попробуйте позже."},
            )
        token = auth_manager.authenticate(username, password)
        if token:
            reset_user_lockout(username)
            user = user_db.get_user(username)
            response = JSONResponse({
                "success": True,
                "user": {"username": user['username'], "role": user['role']} if user else None,
            })
            response.set_cookie(
                key="session_token",
                value=token,
                max_age=config.SESSION_MAX_AGE,
                httponly=True,
                secure=config.COOKIE_SECURE,
                samesite="lax",
                path="/",
            )
            return response
        record_failed_login(username)
        return JSONResponse(status_code=401, content={"error": "Неверное имя пользователя или пароль"})
    except Exception as e:
        logger.error("Ошибка в /api/auth/login: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/auth/logout")
async def api_logout(request: Request):
    """JSON logout for React SPA."""
    token = request.cookies.get('session_token')
    if token:
        auth_manager.logout(token)
    response = JSONResponse({"success": True})
    response.delete_cookie("session_token", path="/")
    return response


@router.get("/api/auth-check")
async def auth_check(request: Request):
    user = get_current_user(request)
    return JSONResponse({"authenticated": user is not None, "user": user})
