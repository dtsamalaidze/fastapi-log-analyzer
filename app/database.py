# -*- coding: utf-8 -*-
# app/database.py
import hashlib
import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    User, Session as SessionModel, UserPermission, SystemRole,
    Department, GlobalAllowedApp, GlobalBlockedApp,
    DepartmentAllowedApp, DepartmentBlockedApp,
    LogUser, LogApp, LogAppPath, Computer, UserComputer, Setting
)
from app.db import SessionLocal, init_db


DEFAULT_ADMIN_PERMISSIONS: Dict = {
    "users": {"view": True, "edit_profile": True},
    "departments": {"view": True, "edit": True},
    "apps_global": {"view": True, "edit": True},
    "apps_department": {"view": True, "edit": True},
    "reports": {"view": True},
    "logs": {"process": True},
    "accounts": {"manage": True},
    "database": {"view": True, "manage": True},
    "pages": {"users": True, "reports": True, "apps": True, "departments": True, "database": True},
    "report_types": {"users": True, "apps": True, "computers": True, "departments": True},
    "data_scope": {"departments": [], "cities": [], "users": []},
}

DEFAULT_VIEWER_PERMISSIONS: Dict = {
    "users": {"view": True, "edit_profile": False},
    "departments": {"view": True, "edit": False},
    "apps_global": {"view": True, "edit": False},
    "apps_department": {"view": True, "edit": False},
    "reports": {"view": True},
    "logs": {"process": False},
    "accounts": {"manage": False},
    "database": {"view": False, "manage": False},
    "pages": {"users": True, "reports": True, "apps": False, "departments": False, "database": False},
    "report_types": {"users": True, "apps": True, "computers": True, "departments": True},
    "data_scope": {"departments": [], "cities": [], "users": []},
}


def hash_password(password: str) -> str:
    """Хеширует пароль с солью через PBKDF2-SHA256"""
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000)
    return f"pbkdf2:{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Проверяет пароль против сохранённого хеша (или plain-text при миграции)"""
    if not stored.startswith('pbkdf2:'):
        return password == stored
    try:
        _, salt, dk_hex = stored.split(':')
        dk = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000)
        return dk.hex() == dk_hex
    except ValueError:
        return False


# ============================================================
# DB CLASSES — each accepts a SQLAlchemy Session
# ============================================================

class UserDB:
    """Работа с пользователями системы"""

    def __init__(self, db: Session):
        self.db = db

    def authenticate(self, username: str, password: str) -> Optional[Dict]:
        user = self.db.query(User).filter(User.username == username).first()
        if user and verify_password(password, user.password):
            if not user.password.startswith('pbkdf2:'):
                user.password = hash_password(password)
                self.db.flush()
            return {'username': user.username, 'name': user.name, 'role': user.role}
        return None

    def get_user(self, username: str) -> Optional[Dict]:
        user = self.db.query(User).filter(User.username == username).first()
        if user:
            return {'username': user.username, 'name': user.name, 'role': user.role}
        return None


class SessionDB:
    """Работа с сессиями"""

    def __init__(self, db: Session):
        self.db = db

    def create_session(self, token: str, username: str, expires_at: datetime) -> bool:
        sess = SessionModel(token=token, username=username, expires_at=expires_at)
        self.db.add(sess)
        self.db.flush()
        return True

    def get_session(self, token: str) -> Optional[Dict]:
        sess = self.db.query(SessionModel).filter(SessionModel.token == token).first()
        if sess:
            return {'username': sess.username, 'expires_at': sess.expires_at}
        return None

    def delete_session(self, token: str) -> bool:
        deleted = self.db.query(SessionModel).filter(SessionModel.token == token).delete()
        return deleted > 0


class DepartmentDB:
    """Работа с отделами"""

    def __init__(self, db: Session):
        self.db = db

    def get_all(self) -> List[Dict]:
        rows = (
            self.db.query(
                Department.id,
                Department.name,
                Department.created_by,
                Department.created_at,
                func.count(DepartmentAllowedApp.id.distinct()).label('allowed_count'),
                func.count(DepartmentBlockedApp.id.distinct()).label('blocked_count'),
                func.count(LogUser.id.distinct()).label('users_count'),
            )
            .outerjoin(DepartmentAllowedApp, Department.id == DepartmentAllowedApp.department_id)
            .outerjoin(DepartmentBlockedApp, Department.id == DepartmentBlockedApp.department_id)
            .outerjoin(LogUser, Department.id == LogUser.department_id)
            .group_by(Department.id)
            .order_by(Department.name)
            .all()
        )
        return [
            {
                'id': r.id,
                'name': r.name,
                'created_by': r.created_by,
                'created_at': str(r.created_at) if r.created_at else None,
                'allowed_count': r.allowed_count,
                'blocked_count': r.blocked_count,
                'users_count': r.users_count,
            }
            for r in rows
        ]

    def get_all_names(self) -> List[str]:
        rows = self.db.query(Department.name).order_by(Department.name).all()
        return [r[0] for r in rows]

    def add(self, name: str, created_by: str = None) -> bool:
        try:
            dept = Department(name=name, created_by=created_by)
            self.db.add(dept)
            self.db.flush()
            return True
        except Exception:
            self.db.rollback()
            return False

    def remove(self, name: str) -> bool:
        deleted = self.db.query(Department).filter(Department.name == name).delete()
        return deleted > 0

    def get_id_by_name(self, name: str) -> Optional[int]:
        row = self.db.query(Department.id).filter(Department.name == name).first()
        return row[0] if row else None

    def get_name_by_id(self, dept_id: int) -> Optional[str]:
        row = self.db.query(Department.name).filter(Department.id == dept_id).first()
        return row[0] if row else None


class GlobalAppsDB:
    """Работа с глобальными списками приложений"""

    def __init__(self, db: Session):
        self.db = db

    def get_allowed_all(self) -> List[str]:
        rows = self.db.query(GlobalAllowedApp.app_name).order_by(GlobalAllowedApp.app_name).all()
        return [r[0] for r in rows]

    def add_allowed(self, app_name: str, added_by: str = None) -> bool:
        try:
            stmt = pg_insert(GlobalAllowedApp).values(app_name=app_name, added_by=added_by)
            stmt = stmt.on_conflict_do_nothing(index_elements=['app_name'])
            result = self.db.execute(stmt)
            self.db.flush()
            return result.rowcount > 0
        except Exception:
            self.db.rollback()
            return False

    def remove_allowed(self, app_name: str) -> bool:
        deleted = self.db.query(GlobalAllowedApp).filter(GlobalAllowedApp.app_name == app_name).delete()
        return deleted > 0

    def is_allowed(self, app_name: str) -> bool:
        return self.db.query(GlobalAllowedApp).filter(
            func.lower(GlobalAllowedApp.app_name) == func.lower(app_name)
        ).first() is not None

    def get_blocked_all(self) -> List[str]:
        rows = self.db.query(GlobalBlockedApp.app_name).order_by(GlobalBlockedApp.app_name).all()
        return [r[0] for r in rows]

    def add_blocked(self, app_name: str, added_by: str = None) -> bool:
        try:
            stmt = pg_insert(GlobalBlockedApp).values(app_name=app_name, added_by=added_by)
            stmt = stmt.on_conflict_do_nothing(index_elements=['app_name'])
            result = self.db.execute(stmt)
            self.db.flush()
            return result.rowcount > 0
        except Exception:
            self.db.rollback()
            return False

    def remove_blocked(self, app_name: str) -> bool:
        deleted = self.db.query(GlobalBlockedApp).filter(GlobalBlockedApp.app_name == app_name).delete()
        return deleted > 0

    def is_blocked(self, app_name: str) -> bool:
        return self.db.query(GlobalBlockedApp).filter(
            func.lower(GlobalBlockedApp.app_name) == func.lower(app_name)
        ).first() is not None


class DepartmentAppsDB:
    """Работа со списками приложений по отделам"""

    def __init__(self, db: Session):
        self.db = db

    def get_allowed_by_department(self, department_id: int) -> List[str]:
        rows = (
            self.db.query(DepartmentAllowedApp.app_name)
            .filter(DepartmentAllowedApp.department_id == department_id)
            .order_by(DepartmentAllowedApp.app_name)
            .all()
        )
        return [r[0] for r in rows]

    def add_allowed(self, department_id: int, app_name: str, added_by: str = None) -> bool:
        try:
            stmt = pg_insert(DepartmentAllowedApp).values(
                department_id=department_id, app_name=app_name, added_by=added_by
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=['department_id', 'app_name'])
            result = self.db.execute(stmt)
            self.db.flush()
            return result.rowcount > 0
        except Exception:
            self.db.rollback()
            return False

    def remove_allowed(self, department_id: int, app_name: str) -> bool:
        deleted = (
            self.db.query(DepartmentAllowedApp)
            .filter(
                DepartmentAllowedApp.department_id == department_id,
                DepartmentAllowedApp.app_name == app_name
            )
            .delete()
        )
        return deleted > 0

    def get_blocked_by_department(self, department_id: int) -> List[str]:
        rows = (
            self.db.query(DepartmentBlockedApp.app_name)
            .filter(DepartmentBlockedApp.department_id == department_id)
            .order_by(DepartmentBlockedApp.app_name)
            .all()
        )
        return [r[0] for r in rows]

    def add_blocked(self, department_id: int, app_name: str, added_by: str = None) -> bool:
        try:
            stmt = pg_insert(DepartmentBlockedApp).values(
                department_id=department_id, app_name=app_name, added_by=added_by
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=['department_id', 'app_name'])
            result = self.db.execute(stmt)
            self.db.flush()
            return result.rowcount > 0
        except Exception:
            self.db.rollback()
            return False

    def remove_blocked(self, department_id: int, app_name: str) -> bool:
        deleted = (
            self.db.query(DepartmentBlockedApp)
            .filter(
                DepartmentBlockedApp.department_id == department_id,
                DepartmentBlockedApp.app_name == app_name
            )
            .delete()
        )
        return deleted > 0


class LogUserDB:
    """Работа с пользователями из лог-файлов"""

    def __init__(self, db: Session):
        self.db = db

    def get_or_create(self, username: str) -> int:
        user = self.db.query(LogUser).filter(LogUser.username == username).first()
        if user:
            user.last_seen = func.now()
            self.db.flush()
            return user.id
        else:
            user = LogUser(username=username, first_seen=func.now(), last_seen=func.now())
            self.db.add(user)
            self.db.flush()
            return user.id

    def set_department(self, username: str, department_name: str) -> bool:
        dept_db = DepartmentDB(self.db)
        dept_id = dept_db.get_id_by_name(department_name) if department_name else None
        updated = (
            self.db.query(LogUser)
            .filter(LogUser.username == username)
            .update({'department_id': dept_id})
        )
        return updated > 0

    def set_profile(self, username: str, last_name: str, first_name: str, middle_name: str,
                    city: str, address: str, telegram: str) -> bool:
        updated = (
            self.db.query(LogUser)
            .filter(LogUser.username == username)
            .update({
                'last_name': last_name or None,
                'first_name': first_name or None,
                'middle_name': middle_name or None,
                'city': city or None,
                'address': address or None,
                'telegram': telegram or None,
            })
        )
        return updated > 0

    def get_department(self, username: str) -> Optional[Dict]:
        row = (
            self.db.query(LogUser, Department)
            .outerjoin(Department, LogUser.department_id == Department.id)
            .filter(LogUser.username == username)
            .first()
        )
        if row:
            dept = row[1]
            return {'id': dept.id, 'name': dept.name} if dept else None
        return None

    def add_computer(self, username: str, computer_name: str) -> bool:
        try:
            user = self.db.query(LogUser).filter(LogUser.username == username).first()
            if not user:
                return False

            computer = self.db.query(Computer).filter(Computer.name == computer_name).first()
            if not computer:
                computer = Computer(name=computer_name)
                self.db.add(computer)
                self.db.flush()

            stmt = pg_insert(UserComputer).values(
                user_id=user.id,
                computer_id=computer.id,
                first_seen=func.now(),
                last_seen=func.now(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=['user_id', 'computer_id'],
                set_={'last_seen': func.now()}
            )
            self.db.execute(stmt)
            self.db.flush()
            return True
        except Exception as e:
            print(f"❌ Ошибка добавления компьютера {computer_name} для {username}: {e}")
            return False

    def get_computers(self, username: str) -> List[str]:
        rows = (
            self.db.query(Computer.name)
            .join(UserComputer, Computer.id == UserComputer.computer_id)
            .join(LogUser, LogUser.id == UserComputer.user_id)
            .filter(LogUser.username == username)
            .order_by(UserComputer.last_seen.desc())
            .all()
        )
        return [r[0] for r in rows]

    def update_computer_ip(self, computer_name: str, ip_address: str) -> None:
        self.db.query(Computer).filter(Computer.name == computer_name).update({'ip_address': ip_address})
        self.db.flush()

    def get_unresolved_computers(self) -> List[str]:
        rows = (
            self.db.query(Computer.name)
            .filter(Computer.ip_address.is_(None))
            .order_by(Computer.name)
            .all()
        )
        return [r[0] for r in rows]

    def get_computer_ip(self, computer_name: str) -> Optional[str]:
        row = self.db.query(Computer.ip_address).filter(Computer.name == computer_name).first()
        return row[0] if row else None

    def get_all_computers_with_ips(self) -> List[Dict]:
        rows = self.db.query(Computer.name, Computer.ip_address).order_by(Computer.name).all()
        return [{'name': r[0], 'ip_address': r[1]} for r in rows]

    def get_computer_users(self, computer_name: str) -> List[Dict]:
        rows = (
            self.db.query(
                LogUser.username, LogUser.last_name, LogUser.first_name,
                LogUser.middle_name, Department.name.label('department')
            )
            .join(UserComputer, UserComputer.user_id == LogUser.id)
            .join(Computer, Computer.id == UserComputer.computer_id)
            .outerjoin(Department, Department.id == LogUser.department_id)
            .filter(Computer.name == computer_name)
            .order_by(LogUser.username)
            .all()
        )
        return [
            {
                'username': r.username,
                'last_name': r.last_name,
                'first_name': r.first_name,
                'middle_name': r.middle_name,
                'department': r.department,
            }
            for r in rows
        ]


class LogAppDB:
    """Работа с приложениями из лог-файлов"""

    def __init__(self, db: Session):
        self.db = db

    def add_or_update(self, user_id: int, app_name: str, first_launch: str,
                      launch_count: int = 1, log_date: str = ''):
        try:
            last_seen_val = log_date if log_date else first_launch
            stmt = pg_insert(LogApp).values(
                user_id=user_id,
                name=app_name,
                first_launch=first_launch,
                launch_count=launch_count,
                last_seen=last_seen_val,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=['name', 'user_id'],
                set_={
                    'launch_count': LogApp.launch_count + stmt.excluded.launch_count,
                    'last_seen': stmt.excluded.last_seen,
                }
            )
            self.db.execute(stmt)
            self.db.flush()
        except Exception as e:
            print(f"❌ Ошибка добавления приложения {app_name}: {e}")

    def get_user_apps(self, user_id: int) -> List[Dict]:
        rows = (
            self.db.query(LogApp.name, LogApp.first_launch, LogApp.launch_count, LogApp.last_seen)
            .filter(LogApp.user_id == user_id)
            .order_by(LogApp.first_launch)
            .all()
        )
        return [
            {
                'name': r[0],
                'first_launch': r[1],
                'launch_count': r[2],
                'last_seen': r[3],
            }
            for r in rows
        ]

    def clear_all(self):
        self.db.query(LogAppPath).delete(synchronize_session=False)
        self.db.query(LogApp).delete(synchronize_session=False)
        self.db.flush()
        print("🗑️  log_apps и log_app_paths очищены для полной переобработки")

    def add_or_update_path(self, user_id: int, app_name: str, computer_name: str,
                           full_path: Optional[str], launch_count: int = 1):
        try:
            stmt = pg_insert(LogAppPath).values(
                user_id=user_id,
                app_name=app_name,
                computer_name=computer_name or '',
                full_path=full_path,
                launch_count=launch_count,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=['user_id', 'app_name', 'computer_name'],
                set_={
                    'launch_count': LogAppPath.launch_count + stmt.excluded.launch_count,
                    'full_path': func.coalesce(LogAppPath.full_path, stmt.excluded.full_path),
                }
            )
            self.db.execute(stmt)
            self.db.flush()
        except Exception as e:
            print(f"❌ Ошибка добавления пути приложения {app_name}: {e}")

    def get_app_users(self, app_name: str) -> List[Dict]:
        rows = (
            self.db.query(
                LogUser.username, LogUser.last_name, LogUser.first_name, LogUser.middle_name,
                LogAppPath.computer_name, LogAppPath.full_path, LogAppPath.launch_count
            )
            .join(LogUser, LogUser.id == LogAppPath.user_id)
            .filter(func.lower(LogAppPath.app_name) == func.lower(app_name))
            .order_by(LogUser.username, LogAppPath.computer_name)
            .all()
        )
        return [
            {
                'username': r.username,
                'last_name': r.last_name,
                'first_name': r.first_name,
                'middle_name': r.middle_name,
                'computer': r.computer_name or '',
                'full_path': r.full_path or '',
                'launch_count': r.launch_count,
            }
            for r in rows
        ]


class SettingsDB:
    """Хранилище простых настроек (k/v)"""

    def __init__(self, db: Session):
        self.db = db

    def get(self, key: str) -> Optional[str]:
        row = self.db.query(Setting.value).filter(Setting.key == key).first()
        return row[0] if row else None

    def set(self, key: str, value: str) -> None:
        stmt = pg_insert(Setting).values(key=key, value=value, updated_at=func.now())
        stmt = stmt.on_conflict_do_update(
            index_elements=['key'],
            set_={'value': stmt.excluded.value, 'updated_at': func.now()}
        )
        self.db.execute(stmt)
        self.db.flush()

    def get_int(self, key: str) -> Optional[int]:
        val = self.get(key)
        try:
            return int(val) if val is not None else None
        except ValueError:
            return None

    def set_int(self, key: str, value: int) -> None:
        self.set(key, str(value))


class RolesDB:
    """Управление шаблонами ролей (наборы прав)"""

    def __init__(self, db: Session):
        self.db = db

    def get_all(self) -> List[Dict]:
        rows = (
            self.db.query(SystemRole)
            .order_by(SystemRole.is_builtin.desc(), SystemRole.name)
            .all()
        )
        return [
            {
                'name': r.name,
                'description': r.description,
                'permissions': r.permissions if isinstance(r.permissions, dict) else {},
                'is_builtin': r.is_builtin,
                'created_at': str(r.created_at) if r.created_at else None,
            }
            for r in rows
        ]

    def get(self, name: str) -> Optional[Dict]:
        r = self.db.query(SystemRole).filter(SystemRole.name == name).first()
        if r:
            return {
                'name': r.name,
                'description': r.description,
                'permissions': r.permissions if isinstance(r.permissions, dict) else {},
                'is_builtin': r.is_builtin,
                'created_at': str(r.created_at) if r.created_at else None,
            }
        return None

    def create(self, name: str, description: str, permissions: Dict) -> bool:
        try:
            role = SystemRole(name=name, description=description, permissions=permissions, is_builtin=False)
            self.db.add(role)
            self.db.flush()
            return True
        except Exception:
            self.db.rollback()
            return False

    def update(self, name: str, description: Optional[str], permissions: Optional[Dict]) -> bool:
        updates = {}
        if description is not None:
            updates['description'] = description
        if permissions is not None:
            updates['permissions'] = permissions
        if not updates:
            return False
        updated = self.db.query(SystemRole).filter(SystemRole.name == name).update(updates)
        return updated > 0

    def delete(self, name: str) -> bool:
        deleted = (
            self.db.query(SystemRole)
            .filter(SystemRole.name == name, SystemRole.is_builtin == False)
            .delete()
        )
        return deleted > 0


class AccountDB:
    """Управление системными аккаунтами и их правами доступа"""

    def __init__(self, db: Session):
        self.db = db

    def get_all(self) -> List[Dict]:
        rows = (
            self.db.query(User, UserPermission)
            .outerjoin(UserPermission, User.username == UserPermission.username)
            .order_by(User.role.desc(), User.username)
            .all()
        )
        return [
            {
                'username': u.username,
                'name': u.name,
                'role': u.role,
                'created_at': str(u.created_at) if u.created_at else None,
                'permissions': (p.permissions if isinstance(p.permissions, dict) else {}) if p else {},
            }
            for u, p in rows
        ]

    def get(self, username: str) -> Optional[Dict]:
        row = (
            self.db.query(User, UserPermission)
            .outerjoin(UserPermission, User.username == UserPermission.username)
            .filter(User.username == username)
            .first()
        )
        if row:
            u, p = row
            return {
                'username': u.username,
                'name': u.name,
                'role': u.role,
                'created_at': str(u.created_at) if u.created_at else None,
                'permissions': (p.permissions if isinstance(p.permissions, dict) else {}) if p else {},
            }
        return None

    def create(self, username: str, password: str, name: str, role: str) -> bool:
        try:
            user = User(username=username, password=hash_password(password), name=name, role=role)
            self.db.add(user)
            self.db.flush()
            defaults = DEFAULT_ADMIN_PERMISSIONS if role == 'admin' else DEFAULT_VIEWER_PERMISSIONS
            perm = UserPermission(username=username, permissions=defaults)
            self.db.add(perm)
            self.db.flush()
            return True
        except Exception:
            self.db.rollback()
            return False

    def update(self, username: str, name: Optional[str] = None, role: Optional[str] = None) -> bool:
        updates = {}
        if name is not None:
            updates['name'] = name
        if role is not None:
            updates['role'] = role
        if not updates:
            return False
        updated = self.db.query(User).filter(User.username == username).update(updates)
        return updated > 0

    def update_password(self, username: str, password: str) -> bool:
        updated = (
            self.db.query(User)
            .filter(User.username == username)
            .update({'password': hash_password(password)})
        )
        return updated > 0

    def delete(self, username: str) -> bool:
        deleted = self.db.query(User).filter(User.username == username).delete()
        return deleted > 0

    def count_admins(self) -> int:
        return self.db.query(func.count(User.id)).filter(User.role == 'admin').scalar()

    def get_permissions(self, username: str) -> Dict:
        perm = self.db.query(UserPermission).filter(UserPermission.username == username).first()
        if perm:
            return perm.permissions if isinstance(perm.permissions, dict) else {}
        user = self.db.query(User).filter(User.username == username).first()
        if user:
            return DEFAULT_ADMIN_PERMISSIONS if user.role == 'admin' else DEFAULT_VIEWER_PERMISSIONS
        return {}

    def set_permissions(self, username: str, permissions: Dict) -> bool:
        stmt = pg_insert(UserPermission).values(
            username=username,
            permissions=permissions,
            updated_at=func.now(),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=['username'],
            set_={'permissions': stmt.excluded.permissions, 'updated_at': func.now()}
        )
        self.db.execute(stmt)
        self.db.flush()
        return True


class DatabaseManager:
    """Bootstrap object: initialises schema and seeds default data.

    __init__ is intentionally a no-op so the module can be imported even
    before PostgreSQL is available.  Call bootstrap() from the FastAPI
    lifespan after init_db() to create tables and seed default data.
    """

    def __init__(self):
        pass  # DB connection deferred to bootstrap() / lifespan

    def bootstrap(self):
        """Create tables and seed default data. Called once from lifespan."""
        init_db()
        self._seed_defaults()

    def _seed_defaults(self):
        db = SessionLocal()
        try:
            self._seed_users(db)
            self._seed_roles(db)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"⚠️  Ошибка при инициализации данных: {e}")
        finally:
            db.close()

    def _seed_users(self, db: Session):
        default_users = [
            ('admin', 'admin123', 'Администратор', 'admin'),
            ('viewer', 'viewer123', 'Просмотрщик', 'viewer'),
        ]
        for username, password, name, role in default_users:
            stmt = pg_insert(User).values(
                username=username, password=hash_password(password), name=name, role=role
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=['username'])
            db.execute(stmt)

        # Ensure user_permissions exist for all users
        users = db.query(User).all()
        for u in users:
            stmt = pg_insert(UserPermission).values(
                username=u.username,
                permissions=DEFAULT_ADMIN_PERMISSIONS if u.role == 'admin' else DEFAULT_VIEWER_PERMISSIONS,
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=['username'])
            db.execute(stmt)

    def _seed_roles(self, db: Session):
        builtin = [
            ('Администратор', 'Полный доступ ко всем функциям', DEFAULT_ADMIN_PERMISSIONS, True),
            ('Просмотрщик', 'Только просмотр данных', DEFAULT_VIEWER_PERMISSIONS, True),
        ]
        for name, desc, perms, is_builtin in builtin:
            stmt = pg_insert(SystemRole).values(
                name=name, description=desc, permissions=perms, is_builtin=is_builtin
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=['name'])
            db.execute(stmt)


# ============================================================
# SESSION-SCOPED PROXY — backward-compatible singletons
# ============================================================

class _SessionScopedProxy:
    """
    Each method call opens a fresh SQLAlchemy session, commits on success,
    rolls back on exception, and always closes the session.
    This preserves the existing calling convention in auth.py and main.py.
    """

    def __init__(self, cls):
        self._cls = cls

    def __getattr__(self, name: str):
        def wrapper(*args, **kwargs):
            db = SessionLocal()
            try:
                result = getattr(self._cls(db), name)(*args, **kwargs)
                db.commit()
                return result
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        return wrapper


# ===== SINGLETON INSTANCES (backward-compatible) =====
db_manager = DatabaseManager()

user_db = _SessionScopedProxy(UserDB)
session_db = _SessionScopedProxy(SessionDB)
department_db = _SessionScopedProxy(DepartmentDB)
global_apps_db = _SessionScopedProxy(GlobalAppsDB)
department_apps_db = _SessionScopedProxy(DepartmentAppsDB)
log_user_db = _SessionScopedProxy(LogUserDB)
log_app_db = _SessionScopedProxy(LogAppDB)
settings_db = _SessionScopedProxy(SettingsDB)
account_db = _SessionScopedProxy(AccountDB)
role_db = _SessionScopedProxy(RolesDB)

print("✅ Database module loaded (PostgreSQL/SQLAlchemy). Call db_manager.bootstrap() to initialise.")
