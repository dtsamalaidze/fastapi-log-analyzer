# -*- coding: utf-8 -*-
# app/routers/database_admin.py
import asyncio
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/computers/{computer_name}/users")
async def get_computer_users(computer_name: str, request: Request):
    if not get_current_user(request):
        return JSONResponse(status_code=401, content={"error": "Не авторизован"})
    try:
        from app.database import log_user_db
        users = log_user_db.get_computer_users(computer_name)
        ip = log_user_db.get_computer_ip(computer_name)
        return JSONResponse(content={"name": computer_name, "ip_address": ip or None, "users": users})
    except Exception as e:
        logger.error("Ошибка в /api/computers/%s/users: %s", computer_name, e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/db/stats")
async def get_db_stats(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import SessionLocal
        from app.models import (
            User as UserModel, Session as SessionModel, Department as DeptModel,
            GlobalAllowedApp, GlobalBlockedApp, DepartmentAllowedApp, DepartmentBlockedApp,
            LogUser, LogApp, LogAppPath, Computer, UserComputer,
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
        return JSONResponse({"engine": "postgresql", "db_size": db_size, "tables": table_stats})
    except Exception as e:
        logger.error("Ошибка в /api/db/stats: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/db/vacuum")
async def vacuum_db(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import engine
        from sqlalchemy import text as sqltext

        def run_vacuum():
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                conn.execute(sqltext("VACUUM ANALYZE"))

        await asyncio.get_running_loop().run_in_executor(None, run_vacuum)
        return JSONResponse({"success": True, "message": "VACUUM ANALYZE выполнен"})
    except Exception as e:
        logger.error("Ошибка в /api/db/vacuum: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/db/backup")
async def backup_db(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        import subprocess
        import os
        import urllib.parse
        from fastapi.responses import Response as FastAPIResponse
        from app import config

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

        data = await asyncio.get_running_loop().run_in_executor(None, run_dump)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return FastAPIResponse(
            content=data,
            media_type='application/octet-stream',
            headers={'Content-Disposition': f'attachment; filename="log_analyzer_backup_{timestamp}.sql"'},
        )
    except Exception as e:
        logger.error("Ошибка в /api/db/backup: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/db/integrity-check")
async def integrity_check_db(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import SessionLocal
        from sqlalchemy import text as sqltext

        def run_check():
            db = SessionLocal()
            try:
                db.execute(sqltext("SELECT 1"))
                return True
            finally:
                db.close()

        ok = await asyncio.get_running_loop().run_in_executor(None, run_check)
        return JSONResponse({"success": True, "ok": ok, "results": ["ok"] if ok else ["error"]})
    except Exception as e:
        logger.error("Ошибка в /api/db/integrity-check: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.post("/api/db/clear-logs")
async def clear_logs_db(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    try:
        from app.db import SessionLocal
        from app.models import LogAppPath, LogApp, UserComputer, LogUser, Computer, Setting

        data = await request.json() if request.headers.get('content-type', '').startswith('application/json') else {}
        older_than_days = data.get('older_than_days')

        if older_than_days is None and not data.get('confirm_delete_all'):
            return JSONResponse(status_code=400, content={"error": "Для полной очистки передайте confirm_delete_all: true"})

        if older_than_days is not None:
            try:
                older_than_days = int(older_than_days)
                if older_than_days <= 0:
                    raise ValueError
            except (ValueError, TypeError):
                return JSONResponse(status_code=400, content={"error": "older_than_days должен быть положительным целым числом"})

        def run_clear():
            db = SessionLocal()
            deleted = {}
            try:
                if older_than_days is not None:
                    cutoff = datetime.now() - timedelta(days=older_than_days)
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

        deleted = await asyncio.get_running_loop().run_in_executor(None, run_clear)
        return JSONResponse({"success": True, "deleted": deleted})
    except Exception as e:
        logger.error("Ошибка в /api/db/clear-logs: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
