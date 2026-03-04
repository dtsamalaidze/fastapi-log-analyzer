# -*- coding: utf-8 -*-
# app/db.py
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

from app.config import DATABASE_URL
from app.models import Base


engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables defined in models.py (idempotent)."""
    Base.metadata.create_all(bind=engine)
    _ensure_indexes()


def _ensure_indexes():
    """Create indexes that may be missing on existing DB (idempotent)."""
    statements = [
        "CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)",
        "CREATE INDEX IF NOT EXISTS idx_log_users_city ON log_users(city)",
        "CREATE INDEX IF NOT EXISTS idx_log_users_last_seen ON log_users(last_seen)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
