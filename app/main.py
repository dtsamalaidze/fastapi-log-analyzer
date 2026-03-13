# -*- coding: utf-8 -*-
# app/main.py
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from app import config
from app.auth import auth_manager, global_apps_manager, department_manager
from app.s3_sync import s3_syncer
from app.state import analyzer, report_cache

logger = logging.getLogger(__name__)


# ============= BACKGROUND TASKS =============

async def _s3_sync_loop():
    """Background task: sync logs/ from S3 every S3_SYNC_INTERVAL seconds."""
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
        logger.info(
            "S3-синхронизация запущена (каждые %d мин, бакет: %s)",
            config.S3_SYNC_INTERVAL // 60, config.S3_BUCKET,
        )
    else:
        logger.warning("S3 не настроен — автосинхронизация отключена.")

    yield

    if s3_task:
        s3_task.cancel()
        try:
            await s3_task
        except asyncio.CancelledError:
            pass


# ============= APP =============

app = FastAPI(title="Log Analyzer", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Validates Origin/Referer on state-changing API requests.

    Rules for non-safe methods on /api/*:
    - Origin or Referer present → must match an allowed origin, else 403.
    - Neither present + session_token cookie → 403 (browser always sends Origin
      for cross-origin; missing Origin with a live session is suspicious).
    - Neither present, no cookie → allow (non-browser client, no CSRF risk).
    """
    _SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

    async def dispatch(self, request: Request, call_next):
        if request.method not in self._SAFE_METHODS and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin") or request.headers.get("referer", "")
            if origin:
                server_origin = f"{request.url.scheme}://{request.url.netloc}"
                allowed = config.CORS_ORIGINS + [server_origin]
                if not any(origin.startswith(o) for o in allowed):
                    logger.warning("CSRF blocked: bad origin=%s path=%s", origin, request.url.path)
                    return StarletteResponse("Forbidden", status_code=403)
            elif request.cookies.get("session_token"):
                logger.warning("CSRF blocked: no origin header, path=%s", request.url.path)
                return StarletteResponse("Forbidden", status_code=403)
        return await call_next(request)


app.add_middleware(CSRFMiddleware)

# Static directories
config.STATIC_DIR.mkdir(exist_ok=True)

_spa_assets = config.STATIC_DIR / "dist" / "assets"
try:
    if _spa_assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_spa_assets)), name="spa-assets")
except Exception as e:
    logger.warning("Ошибка монтирования SPA assets: %s", e)

# ============= INCLUDE ROUTERS =============

from app.routers import auth, users, apps, departments, reports, logs, accounts, database_admin

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(apps.router)
app.include_router(departments.router)
app.include_router(reports.router)
app.include_router(logs.router)
app.include_router(accounts.router)
app.include_router(database_admin.router)


# ============= EXCEPTION HANDLER =============

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Необработанная ошибка: %s", exc, exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервера"})


# ============= HEALTH CHECK =============

@app.get("/health")
async def health_check():
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
        "static_exists": config.STATIC_DIR.exists(),
    }


# ============= SPA CATCH-ALL =============

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    index = config.STATIC_DIR / "dist" / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return HTMLResponse(
        content="<h1>Frontend not built</h1><p>Run: cd frontend && npm install && npm run build</p>",
        status_code=503,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info",
    )
