# -*- coding: utf-8 -*-
# app/routers/users.py
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.deps import require_auth, apply_data_scope, get_user_data_scope
from app.state import analyzer, report_cache

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/users")
async def get_users(
    request: Request,
    page: Optional[int] = Query(None, ge=1),
    limit: Optional[int] = Query(None, ge=1, le=500),
    search: Optional[str] = Query(None),
    sort_key: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None),
):
    """Users list with optional DB-level pagination, search and sort: ?page=1&limit=50&search=ivan&sort_key=total_launches&sort_dir=desc."""
    try:
        require_auth(request)
        if page is not None and limit is not None:
            scope = get_user_data_scope(request)
            result = analyzer.get_users_page(
                page, limit, scope,
                search=search or '',
                sort_key=sort_key or 'username',
                sort_dir=sort_dir or 'asc',
            )
            return JSONResponse(content={"items": result["items"], "total": result["total"], "page": page, "limit": limit})
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        return JSONResponse(content=users_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/stats")
async def get_stats(request: Request):
    try:
        require_auth(request)
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        return JSONResponse(content=analyzer.get_global_stats(users_data))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/stats: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/users/profiles/batch")
async def set_user_profiles_batch(request: Request):
    """Updates profiles for multiple users in one request (admin or edit_profile)."""
    try:
        user = require_auth(request)
        if user['role'] != 'admin':
            from app.database import account_db as _acct_db
            perms = _acct_db.get_permissions(user['username']) or {}
            if not perms.get('users', {}).get('edit_profile'):
                raise HTTPException(status_code=403, detail="Доступ запрещён")
        profiles = await request.json()
        if not isinstance(profiles, list) or len(profiles) > 500:
            return JSONResponse(status_code=400, content={"error": "Ожидается массив до 500 элементов"})
        from app.database import log_user_db
        results = log_user_db.set_profiles_batch(profiles)
        analyzer.invalidate_users_cache()
        return JSONResponse({"results": results})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/users/profiles/batch: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/users/{username}/profile")
async def set_user_profile(username: str, request: Request):
    """Saves a user's profile (name, city, address, telegram)."""
    try:
        user = require_auth(request)
        if user['role'] != 'admin':
            from app.database import account_db as _acct_db
            perms = _acct_db.get_permissions(user['username']) or {}
            if not perms.get('users', {}).get('edit_profile'):
                raise HTTPException(status_code=403, detail="Доступ запрещён")
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
        if success:
            report_cache.invalidate()
            analyzer.invalidate_users_cache()
        return JSONResponse({"success": success})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/users/%s/profile: %s", username, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
