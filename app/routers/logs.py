# -*- coding: utf-8 -*-
# app/routers/logs.py
import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.deps import get_current_user, require_auth
from app.s3_sync import s3_syncer
from app.state import analyzer, report_cache

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/logs/process")
async def process_logs(request: Request):
    """Triggers log processing. Pass {'force_full': true} for full reprocess."""
    try:
        user = get_current_user(request)
        if not user or user['role'] != 'admin':
            return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
        data = await request.json() if request.headers.get('content-type', '').startswith('application/json') else {}
        force_full = bool(data.get('force_full', False))
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: analyzer.process_log_files(force_full=force_full))
        await loop.run_in_executor(None, analyzer.resolve_computer_ips)
        report_cache.invalidate()
        return JSONResponse(content={"success": True, "result": result})
    except Exception as e:
        logger.error("Ошибка в /api/logs/process: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/logs/status")
async def logs_status(request: Request):
    require_auth(request)
    try:
        return JSONResponse(content=analyzer.get_processing_status())
    except Exception as e:
        logger.error("Ошибка в /api/logs/status: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


@router.get("/api/s3/status")
async def s3_status(request: Request):
    require_auth(request)
    return JSONResponse(s3_syncer.status())


@router.post("/api/s3/sync")
async def s3_sync_now(request: Request):
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        return JSONResponse(status_code=403, content={"error": "Доступ запрещен"})
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, s3_syncer.sync)
        return JSONResponse(result)
    except Exception as e:
        logger.error("Ошибка в /api/s3/sync: %s", e, exc_info=True)
        return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})
