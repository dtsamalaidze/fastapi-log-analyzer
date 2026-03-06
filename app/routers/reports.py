# -*- coding: utf-8 -*-
# app/routers/reports.py
import logging
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.auth import global_apps_manager, department_manager
from app.deps import require_auth, apply_data_scope, get_user_data_scope
from app.state import analyzer, report_cache

logger = logging.getLogger(__name__)
router = APIRouter()


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

        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, scope)

        allowed_set = set(a.lower() for a in global_apps_manager.get_allowed_apps())
        blocked_set = set(a.lower() for a in global_apps_manager.get_blocked_apps())

        def _global_status(name: str) -> str:
            n = name.lower()
            if n in allowed_set:
                return 'allowed'
            if n in blocked_set:
                return 'blocked'
            return 'neutral'

        apps_stats: dict = {}
        for user in users_data:
            for app in user['apps']:
                if app['name'] not in apps_stats:
                    apps_stats[app['name']] = {
                        'name': app['name'],
                        'total_launches': 0,
                        'users': set(),
                        'computers': set(),
                        'first_seen': app['first_launch'],
                        'last_seen': app['last_seen'],
                        'global_status': _global_status(app['name']),
                        'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0},
                    }
                s = apps_stats[app['name']]
                s['total_launches'] += app['launch_count']
                s['users'].add(user['username'])
                s['status_counts'][app['status']] += 1
                if user['computers'] and user['computers'] != 'Не указан':
                    for comp in user['computers'].split(', '):
                        s['computers'].add(comp)
                if app['first_launch'] and (s['first_seen'] is None or app['first_launch'] < s['first_seen']):
                    s['first_seen'] = app['first_launch']
                if app['last_seen'] and (s['last_seen'] is None or app['last_seen'] > s['last_seen']):
                    s['last_seen'] = app['last_seen']

        result = [
            {
                'name': name,
                'global_status': s['global_status'],
                'total_launches': s['total_launches'],
                'users_count': len(s['users']),
                'computers_count': len(s['computers']),
                'first_seen': s['first_seen'],
                'last_seen': s['last_seen'],
                'status_counts': s['status_counts'],
            }
            for name, s in apps_stats.items()
        ]
        report_cache.set("apps", scope, result)
        return JSONResponse(content=result)
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

        from app.database import log_user_db
        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, scope)
        ip_map = {c['name']: c['ip_address'] for c in log_user_db.get_all_computers_with_ips()}

        computers_stats: dict = {}
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
                            'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0},
                        }
                    computers_stats[comp]['users'].add(user['username'])
                    computers_stats[comp]['total_launches'] += user['total_launches']
                    for app in user['apps']:
                        computers_stats[comp]['apps'].add(app['name'])
                        computers_stats[comp]['status_counts'][app['status']] += 1

        result = [
            {
                'name': name,
                'ip_address': ip_map.get(name) or None,
                'users_count': len(s['users']),
                'total_launches': s['total_launches'],
                'apps_count': len(s['apps']),
                'last_seen': s['last_seen'],
                'status_counts': s['status_counts'],
            }
            for name, s in computers_stats.items()
        ]
        report_cache.set("computers", scope, result)
        return JSONResponse(content=result)
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

        users_data = analyzer.get_all_users_data()
        users_data = apply_data_scope(users_data, scope)
        departments = department_manager.get_departments_with_stats()

        depts_stats: dict = {}
        for dept in departments:
            depts_stats[dept['name']] = {
                'name': dept['name'],
                'users': set(), 'total_launches': 0,
                'apps': set(), 'computers': set(),
                'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0},
            }
        depts_stats['Не указан'] = {
            'name': 'Не указан',
            'users': set(), 'total_launches': 0,
            'apps': set(), 'computers': set(),
            'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0},
        }

        for user in users_data:
            dept_name = user['department'] or 'Не указан'
            if dept_name not in depts_stats:
                depts_stats[dept_name] = {
                    'name': dept_name,
                    'users': set(), 'total_launches': 0,
                    'apps': set(), 'computers': set(),
                    'status_counts': {'allowed': 0, 'blocked': 0, 'neutral': 0},
                }
            s = depts_stats[dept_name]
            s['users'].add(user['username'])
            s['total_launches'] += user['total_launches']
            s['status_counts']['allowed'] += user['allowed_count']
            s['status_counts']['blocked'] += user['blocked_count']
            s['status_counts']['neutral'] += user.get('neutral_count', 0)
            for app in user['apps']:
                s['apps'].add(app['name'])
            if user['computers'] and user['computers'] != 'Не указан':
                for comp in user['computers'].split(', '):
                    s['computers'].add(comp)

        result = [
            {
                'name': dept_name,
                'users_count': len(s['users']),
                'total_launches': s['total_launches'],
                'apps_count': len(s['apps']),
                'computers_count': len(s['computers']),
                'status_counts': s['status_counts'],
                'avg_launches_per_user': s['total_launches'] // len(s['users']) if s['users'] else 0,
            }
            for dept_name, s in depts_stats.items()
            if s['users']
        ]
        report_cache.set("departments", scope, result)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Ошибка в /api/reports/departments: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
