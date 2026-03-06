# -*- coding: utf-8 -*-
# app/auth.py
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from fastapi import Request
from app.database import (
    user_db, session_db, department_db, global_apps_db,
    department_apps_db, log_user_db
)
from app.config import SESSION_MAX_AGE

logger = logging.getLogger(__name__)


class AuthManager:
    """Менеджер аутентификации"""

    def authenticate(self, username: str, password: str) -> Optional[str]:
        """Аутентификация + создание сессии в одной транзакции."""
        from app.db import SessionLocal
        from app.database import UserDB, SessionDB
        db = SessionLocal()
        try:
            user = UserDB(db).authenticate(username, password)
            if not user:
                db.commit()
                return None
            token = secrets.token_hex(32)
            expires_at = datetime.now() + timedelta(seconds=SESSION_MAX_AGE)
            SessionDB(db).create_session(token, username, expires_at)
            db.commit()
            return token
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def verify_session(self, token: str) -> Optional[str]:
        """Проверяет валидность сессии и продлевает TTL — всё в одной транзакции."""
        from app.db import SessionLocal
        from app.database import SessionDB
        db = SessionLocal()
        try:
            result = SessionDB(db).verify_and_refresh(token, SESSION_MAX_AGE)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def logout(self, token: str):
        """Завершает сессию"""
        session_db.delete_session(token)

    def get_current_user(self, request: Request) -> Optional[Dict]:
        """Получает текущего пользователя из запроса"""
        token = request.cookies.get('session_token')
        if token:
            username = self.verify_session(token)
            if username:
                return user_db.get_user(username)
        return None


class GlobalAppsManager:
    """Менеджер глобальных списков приложений"""

    def get_allowed_apps(self) -> List[str]:
        """Возвращает список глобально разрешенных приложений"""
        return global_apps_db.get_allowed_all()

    def add_allowed_app(self, app_name: str, username: str = None) -> bool:
        """Добавляет приложение в глобально разрешенные"""
        return global_apps_db.add_allowed(app_name, username)

    def remove_allowed_app(self, app_name: str) -> bool:
        """Удаляет приложение из глобально разрешенных"""
        return global_apps_db.remove_allowed(app_name)

    def is_allowed(self, app_name: str) -> bool:
        """Проверяет, есть ли приложение в глобально разрешенных"""
        return global_apps_db.is_allowed(app_name)

    def get_blocked_apps(self) -> List[str]:
        """Возвращает список глобально заблокированных приложений"""
        return global_apps_db.get_blocked_all()

    def add_blocked_app(self, app_name: str, username: str = None) -> bool:
        """Добавляет приложение в глобально заблокированные"""
        return global_apps_db.add_blocked(app_name, username)

    def remove_blocked_app(self, app_name: str) -> bool:
        """Удаляет приложение из глобально заблокированных"""
        return global_apps_db.remove_blocked(app_name)

    def is_blocked(self, app_name: str) -> bool:
        """Проверяет, есть ли приложение в глобально заблокированных"""
        return global_apps_db.is_blocked(app_name)

    def get_app_status(self, app_name: str) -> str:
        """Получает глобальный статус приложения"""
        if self.is_allowed(app_name):
            return 'allowed'
        if self.is_blocked(app_name):
            return 'blocked'
        return 'neutral'

    def set_allowed_app(self, app_name: str, username: str = None) -> bool:
        """Атомарно переводит приложение в глобально разрешённые."""
        return global_apps_db.set_allowed(app_name, username)

    def set_blocked_app(self, app_name: str, username: str = None) -> bool:
        """Атомарно переводит приложение в глобально заблокированные."""
        return global_apps_db.set_blocked(app_name, username)


class DepartmentAppsManager:
    """Менеджер списков приложений по отделам"""

    def get_departments(self) -> List[Dict]:
        """Получает список всех отделов с информацией"""
        return department_db.get_all()

    def get_department_allowed(self, department_name: str) -> List[str]:
        """Получает разрешенные приложения для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.get_allowed_by_department(dept_id)
        return []

    def get_department_blocked(self, department_name: str) -> List[str]:
        """Получает заблокированные приложения для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.get_blocked_by_department(dept_id)
        return []

    def add_department_allowed(self, department_name: str, app_name: str, username: str = None) -> bool:
        """Добавляет разрешенное приложение для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.add_allowed(dept_id, app_name, username)
        return False

    def remove_department_allowed(self, department_name: str, app_name: str) -> bool:
        """Удаляет разрешенное приложение для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.remove_allowed(dept_id, app_name)
        return False

    def add_department_blocked(self, department_name: str, app_name: str, username: str = None) -> bool:
        """Добавляет заблокированное приложение для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.add_blocked(dept_id, app_name, username)
        return False

    def remove_department_blocked(self, department_name: str, app_name: str) -> bool:
        """Удаляет заблокированное приложение для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.remove_blocked(dept_id, app_name)
        return False

    def get_department_app_status(self, department_name: str, app_name: str) -> str:
        """Получает статус приложения для отдела"""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            if app_name in department_apps_db.get_allowed_by_department(dept_id):
                return 'allowed'
            if app_name in department_apps_db.get_blocked_by_department(dept_id):
                return 'blocked'
        return 'neutral'

    def set_department_allowed(self, department_name: str, app_name: str, username: str = None) -> bool:
        """Атомарно переводит приложение в разрешённые для отдела."""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.set_allowed(dept_id, app_name, username)
        return False

    def set_department_blocked(self, department_name: str, app_name: str, username: str = None) -> bool:
        """Атомарно переводит приложение в заблокированные для отдела."""
        dept_id = department_db.get_id_by_name(department_name)
        if dept_id:
            return department_apps_db.set_blocked(dept_id, app_name, username)
        return False


class DepartmentManager:
    """Менеджер отделов"""

    def get_all_departments(self) -> List[str]:
        """Возвращает список всех отделов"""
        return department_db.get_all_names()

    def get_departments_with_stats(self) -> List[Dict]:
        """Возвращает список отделов со статистикой"""
        return department_db.get_all()

    def add_department(self, name: str, username: str = None) -> bool:
        """Добавляет новый отдел"""
        return department_db.add(name, username)

    def remove_department(self, name: str) -> bool:
        """Удаляет отдел"""
        return department_db.remove(name)

    def get_user_department(self, username: str) -> Optional[Dict]:
        """Получает отдел пользователя"""
        return log_user_db.get_department(username)

    def set_user_department(self, username: str, department_name: str) -> bool:
        """Устанавливает отдел пользователя"""
        return log_user_db.set_department(username, department_name)


# ===== СОЗДАЕМ ГЛОБАЛЬНЫЕ ЭКЗЕМПЛЯРЫ =====
auth_manager = AuthManager()
global_apps_manager = GlobalAppsManager()
department_apps_manager = DepartmentAppsManager()
department_manager = DepartmentManager()

logger.info("Auth module initialized")
