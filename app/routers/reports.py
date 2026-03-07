# -*- coding: utf-8 -*-
# app/routers/reports.py
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, case, distinct, select

from app.db import SessionLocal
from app.deps import require_auth, apply_data_scope, get_user_data_scope
from app.models import (
    LogApp, LogUser, UserComputer, Computer, Department,
    DepartmentAllowedApp, DepartmentBlockedApp,
    GlobalAllowedApp, GlobalBlockedApp,
)
from app.state import analyzer, report_cache

logger = logging.getLogger(__name__)
router = APIRouter()

# Status aggregate expressions — built once at import time.
# Each evaluates to 1 or 0 per (LogUser, LogApp) row for use inside SUM().
# Precedence: dept_blocked > dept_allowed > global_blocked > global_allowed > neutral.
# Caller must have joined LogUser and LogApp before using these.
_dept_blocked = (
    select(DepartmentBlockedApp.id)
    .where(
        DepartmentBlockedApp.department_id == LogUser.department_id,
        func.lower(DepartmentBlockedApp.app_name) == func.lower(LogApp.name),
    )
    .correlate(LogUser, LogApp)
    .exists()
)
_dept_allowed = (
    select(DepartmentAllowedApp.id)
    .where(
        DepartmentAllowedApp.department_id == LogUser.department_id,
        func.lower(DepartmentAllowedApp.app_name) == func.lower(LogApp.name),
    )
    .correlate(LogUser, LogApp)
    .exists()
)
_global_blocked = (
    select(GlobalBlockedApp.id)
    .where(func.lower(GlobalBlockedApp.app_name) == func.lower(LogApp.name))
    .correlate(LogApp)
    .exists()
)
_global_allowed = (
    select(GlobalAllowedApp.id)
    .where(func.lower(GlobalAllowedApp.app_name) == func.lower(LogApp.name))
    .correlate(LogApp)
    .exists()
)

_ALLOWED_C = case(
    (_dept_blocked, 0), (_dept_allowed, 1),
    (_global_blocked, 0), (_global_allowed, 1),
    else_=0,
)
_BLOCKED_C = case(
    (_dept_blocked, 1), (_dept_allowed, 0),
    (_global_blocked, 1), (_global_allowed, 0),
    else_=0,
)
_NEUTRAL_C = case(
    (_dept_blocked, 0), (_dept_allowed, 0),
    (_global_blocked, 0), (_global_allowed, 0),
    else_=1,
)

@router.get("/api/reports/users")
async def get_users_report(
    request: Request,
    page: Optional[int] = Query(None, ge=1),
    limit: Optional[int] = Query(None, ge=1, le=500),
):
    """User report with optional DB-level pagination: ?page=1&limit=50."""
    try:
        require_auth(request)
        if page is not None and limit is not None:
            scope = get_user_data_scope(request)
            result = analyzer.get_users_page(page, limit, scope)
            return JSONResponse(content={"items": result["items"], "total": result["total"], "page": page, "limit": limit})
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, get_user_data_scope(request))
        return JSONResponse(content=users_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/reports/users: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})

@router.get("/api/reports/apps")
async def get_apps_report(request: Request):
    try:
        require_auth(request)
        scope = get_user_data_scope(request)
        cached = report_cache.get("apps", scope)
        if cached is not None:
            return JSONResponse(content=cached)

        db = SessionLocal()
        try:
            scope_filter = analyzer._build_scope_filter(db, scope)

            # Subquery: distinct computers per app (same scope filter)
            comp_sq_q = (
                select(
                    LogApp.name.label('app_name'),
                    func.count(distinct(UserComputer.computer_id)).label('cnt'),
                )
                .join(LogUser, LogApp.user_id == LogUser.id)
                .outerjoin(UserComputer, LogUser.id == UserComputer.user_id)
            )
            if scope_filter is not None:
                comp_sq_q = comp_sq_q.where(scope_filter)
            comp_sq = comp_sq_q.group_by(LogApp.name).subquery()

            # Main aggregation joined with computers subquery — single DB round-trip
            base_q = (
                db.query(
                    LogApp.name,
                    func.sum(LogApp.launch_count).label('total_launches'),
                    func.count(distinct(LogApp.user_id)).label('users_count'),
                    func.min(LogApp.first_launch).label('first_seen'),
                    func.max(LogApp.last_seen).label('last_seen'),
                    func.sum(_ALLOWED_C).label('allowed_count'),
                    func.sum(_BLOCKED_C).label('blocked_count'),
                    func.sum(_NEUTRAL_C).label('neutral_count'),
                    func.coalesce(func.max(comp_sq.c.cnt), 0).label('computers_count'),
                )
                .join(LogUser, LogApp.user_id == LogUser.id)
                .outerjoin(comp_sq, LogApp.name == comp_sq.c.app_name)
            )
            if scope_filter is not None:
                base_q = base_q.filter(scope_filter)
            rows = base_q.group_by(LogApp.name).all()
        finally:
            db.close()

        global_allowed_set = set(analyzer.global_allowed)
        global_blocked_set = set(analyzer.global_blocked)

        def _global_status(name: str) -> str:
            n = name.lower()
            if n in global_blocked_set:
                return 'blocked'
            if n in global_allowed_set:
                return 'allowed'
            return 'neutral'

        result = [
            {
                'name': row.name,
                'global_status': _global_status(row.name),
                'total_launches': row.total_launches or 0,
                'users_count': row.users_count,
                'computers_count': row.computers_count,
                'first_seen': row.first_seen.strftime('%Y-%m-%d %H:%M:%S') if row.first_seen else None,
                'last_seen': row.last_seen.strftime('%Y-%m-%d %H:%M:%S') if row.last_seen else None,
                'status_counts': {
                    'allowed': row.allowed_count or 0,
                    'blocked': row.blocked_count or 0,
                    'neutral': row.neutral_count or 0,
                },
            }
            for row in rows
        ]
        report_cache.set("apps", scope, result)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/reports/apps: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})

@router.get("/api/reports/computers")
async def get_computers_report(request: Request):
    try:
        require_auth(request)
        scope = get_user_data_scope(request)
        cached = report_cache.get("computers", scope)
        if cached is not None:
            return JSONResponse(content=cached)

        db = SessionLocal()
        try:
            scope_filter = analyzer._build_scope_filter(db, scope)

            q = (
                db.query(
                    Computer.name,
                    Computer.ip_address,
                    func.count(distinct(LogUser.id)).label('users_count'),
                    func.sum(LogApp.launch_count).label('total_launches'),
                    func.count(distinct(LogApp.name)).label('apps_count'),
                    func.max(UserComputer.last_seen).label('last_seen'),
                    func.sum(_ALLOWED_C).label('allowed_count'),
                    func.sum(_BLOCKED_C).label('blocked_count'),
                    func.sum(_NEUTRAL_C).label('neutral_count'),
                )
                .join(UserComputer, Computer.id == UserComputer.computer_id)
                .join(LogUser, UserComputer.user_id == LogUser.id)
                .join(LogApp, LogUser.id == LogApp.user_id)
            )
            if scope_filter is not None:
                q = q.filter(scope_filter)
            rows = q.group_by(Computer.id, Computer.name, Computer.ip_address).all()
        finally:
            db.close()

        result = [
            {
                'name': row.name,
                'ip_address': row.ip_address or None,
                'users_count': row.users_count,
                'total_launches': row.total_launches or 0,
                'apps_count': row.apps_count,
                'last_seen': row.last_seen.strftime('%Y-%m-%d %H:%M:%S') if row.last_seen else None,
                'status_counts': {
                    'allowed': row.allowed_count or 0,
                    'blocked': row.blocked_count or 0,
                    'neutral': row.neutral_count or 0,
                },
            }
            for row in rows
        ]
        report_cache.set("computers", scope, result)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/reports/computers: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})

@router.get("/api/reports/departments")
async def get_departments_report(request: Request):
    try:
        require_auth(request)
        scope = get_user_data_scope(request)
        cached = report_cache.get("departments", scope)
        if cached is not None:
            return JSONResponse(content=cached)

        db = SessionLocal()
        try:
            scope_filter = analyzer._build_scope_filter(db, scope)

            q = (
                db.query(
                    func.coalesce(Department.name, 'Не указан').label('dept_name'),
                    func.count(distinct(LogUser.id)).label('users_count'),
                    func.sum(LogApp.launch_count).label('total_launches'),
                    func.count(distinct(LogApp.name)).label('apps_count'),
                    func.count(distinct(UserComputer.computer_id)).label('computers_count'),
                    func.sum(_ALLOWED_C).label('allowed_count'),
                    func.sum(_BLOCKED_C).label('blocked_count'),
                    func.sum(_NEUTRAL_C).label('neutral_count'),
                )
                .outerjoin(Department, LogUser.department_id == Department.id)
                .join(LogApp, LogUser.id == LogApp.user_id)
                .outerjoin(UserComputer, LogUser.id == UserComputer.user_id)
            )
            if scope_filter is not None:
                q = q.filter(scope_filter)
            rows = q.group_by(LogUser.department_id, Department.name).all()
        finally:
            db.close()

        result = [
            {
                'name': row.dept_name,
                'users_count': row.users_count,
                'total_launches': row.total_launches or 0,
                'apps_count': row.apps_count,
                'computers_count': row.computers_count,
                'status_counts': {
                    'allowed': row.allowed_count or 0,
                    'blocked': row.blocked_count or 0,
                    'neutral': row.neutral_count or 0,
                },
                'avg_launches_per_user': (row.total_launches or 0) // row.users_count if row.users_count else 0,
            }
            for row in rows
        ]
        report_cache.set("departments", scope, result)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Ошибка в /api/reports/departments: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
