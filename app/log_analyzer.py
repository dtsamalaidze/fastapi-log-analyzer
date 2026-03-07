# -*- coding: utf-8 -*-
# app/log_analyzer.py
import re
import os
import glob
import logging
import subprocess
import threading
import time
from collections import OrderedDict, Counter
from typing import List, Dict, Tuple, Optional
from pathlib import Path
from datetime import datetime

from app.database import (
    log_user_db, log_app_db, global_apps_db,
    department_apps_db, department_db, settings_db
)
from app.db import SessionLocal
from app.models import LogUser, LogApp, Department, DepartmentAllowedApp, DepartmentBlockedApp, Computer, UserComputer
from sqlalchemy import func, or_, Date

LAST_PROCESSED_MTIME_KEY = 'logs.last_processed_mtime'


logger = logging.getLogger(__name__)


_USERS_CACHE_TTL = 60  # секунд


class LogAnalyzer:
    """Класс для анализа лог-файлов"""

    def __init__(self, log_folder: str):
        self.log_folder = log_folder
        self.global_allowed = []
        self.global_blocked = []
        self._users_cache: Optional[List[Dict]] = None
        self._users_cache_ts: float = 0.0
        self._cache_lock = threading.Lock()

    def refresh_global_lists(self):
        """Обновляет глобальные списки из БД"""
        self.global_allowed = [app.lower() for app in global_apps_db.get_allowed_all()]
        self.global_blocked = [app.lower() for app in global_apps_db.get_blocked_all()]
        logger.info("Глобальные списки обновлены: разрешено %d, заблокировано %d",
                    len(self.global_allowed), len(self.global_blocked))

    def find_all_log_files(self) -> List[str]:
        """Находит все лог-файлы всех пользователей рекурсивно"""
        if not os.path.exists(self.log_folder):
            logger.warning("Папка не найдена: %s", self.log_folder)
            return []

        log_files = []

        for root, dirs, files in os.walk(self.log_folder):
            for file in files:
                if file.endswith('.log') and '_' in file:
                    full_path = os.path.join(root, file)
                    log_files.append(full_path)

        return sorted(log_files, reverse=True)

    def parse_log_file(self, filename: str) -> Tuple[
        Optional[str], Optional[str], Optional[str], Dict, Counter, Optional[str], Dict]:
        """Парсит лог-файл и возвращает информацию о запусках"""
        first_launch = {}
        launch_count = Counter()
        first_path: Dict[str, Optional[str]] = {}
        username = None
        computer_name = None
        log_date = None
        first_timestamp = None

        try:
            with open(filename, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    if 'Мониторинг запущен' in line and not username:
                        date_match = re.search(r'^(\d{4}-\d{2}-\d{2})', line)
                        if date_match:
                            log_date = date_match.group(1)

                        user_match = re.search(r'Пользователь:\s*(\S+)', line)
                        computer_match = re.search(r'Компьютер:\s*(\S+)', line)

                        if user_match:
                            username = user_match.group(1)
                        if computer_match:
                            computer_name = computer_match.group(1)

                    if 'Запущен:' in line:
                        time_match = re.search(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})', line)
                        computer_in_app = re.search(r'\[([^\]]+)\]', line)
                        if computer_in_app and not computer_name:
                            computer_name = computer_in_app.group(1)

                        app_match = re.search(r'Запущен:\s*([^\s]+(?:\.exe)?)', line)

                        if time_match and app_match:
                            time_str = time_match.group(1).split()[1]
                            full_timestamp = time_match.group(1)
                            app_name = app_match.group(1).rstrip('.')

                            if first_timestamp is None:
                                first_timestamp = full_timestamp

                            if app_name not in first_launch:
                                first_launch[app_name] = time_str

                            # Извлекаем полный путь из первой кавычки после PPID
                            if app_name not in first_path:
                                path_match = re.search(r'"([^"]+\.exe)"', line)
                                first_path[app_name] = path_match.group(1) if path_match else None

                            launch_count[app_name] += 1
        except Exception as e:
            logger.error("Ошибка при парсинге %s: %s", os.path.basename(filename), e, exc_info=True)

        filename_base = os.path.basename(filename)

        if not username:
            user_match = re.search(r'^([^_]+)_', filename_base)
            if user_match:
                username = user_match.group(1)

        if not computer_name:
            parts = filename_base.split('_')
            if len(parts) >= 3:
                computer_name = parts[1]

        # Фолбэк: извлекаем дату из имени файла (user_2026-02-12.log)
        if not log_date:
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', filename_base)
            if date_match:
                log_date = date_match.group(1)

        return log_date, username, computer_name, first_launch, launch_count, first_timestamp, first_path

    def process_log_files(self, force_full: bool = False) -> Dict:
        """Обрабатывает лог-файлы и сохраняет в БД.
        По умолчанию инкрементально: только файлы новее сохраненного mtime.
        Возвращает краткий отчет.
        """
        all_files = self.find_all_log_files()

        if not all_files:
            logger.info("Нет лог-файлов для обработки")
            return {
                'processed': 0,
                'candidates': 0,
                'incremental': not force_full,
                'new_last_mtime': settings_db.get_int(LAST_PROCESSED_MTIME_KEY) or 0
            }

        last_mtime = 0 if force_full else (settings_db.get_int(LAST_PROCESSED_MTIME_KEY) or 0)
        candidates: List[str] = []
        max_mtime = last_mtime

        for path in all_files:
            try:
                mtime = int(os.path.getmtime(path))
            except Exception:
                mtime = 0
            if force_full or mtime > last_mtime:
                candidates.append(path)
                if mtime > max_mtime:
                    max_mtime = mtime

        if not candidates:
            logger.info("Нет новых лог-файлов для обработки")
            return {
                'processed': 0,
                'candidates': 0,
                'incremental': not force_full,
                'new_last_mtime': last_mtime
            }

        logger.info("Обработка %d лог-файлов (всего найдено: %d). Режим: %s, last_mtime=%s",
                    len(candidates), len(all_files), 'полный' if force_full else 'инкрементальный', last_mtime)

        if force_full:
            log_app_db.clear_all()

        processed_count = 0

        for log_file in candidates:
            try:
                log_date, username, computer_name, first_launch, launch_count, first_timestamp, first_path = self.parse_log_file(
                    log_file)

                if username:
                    user_id = log_user_db.get_or_create(username)

                    if computer_name:
                        log_user_db.add_computer(username, computer_name)

                    for app_name, first_time in first_launch.items():
                        full_first_time = f"{log_date} {first_time}" if log_date else first_time
                        log_app_db.add_or_update(user_id, app_name, full_first_time, launch_count[app_name], log_date or '')
                        log_app_db.add_or_update_path(
                            user_id, app_name, computer_name or '',
                            first_path.get(app_name), launch_count[app_name]
                        )

                    processed_count += 1
            except Exception as e:
                logger.error("Ошибка обработки файла %s: %s", os.path.basename(log_file), e, exc_info=True)

        # Обновляем маркер обработки только если был прогресс
        if processed_count > 0:
            settings_db.set_int(LAST_PROCESSED_MTIME_KEY, int(max_mtime))
            self.refresh_global_lists()
            self.invalidate_users_cache()

        logger.info("Обработано файлов: %d. new_last_mtime=%s", processed_count, max_mtime)
        return {
            'processed': processed_count,
            'candidates': len(candidates),
            'incremental': not force_full,
            'new_last_mtime': int(max_mtime)
        }

    def _get_app_status(
        self,
        app_name_lower: str,
        dept_allowed: set,
        dept_blocked: set,
    ) -> str:
        """Определяет статус приложения по заранее загруженным спискам отдела и глобальным."""
        if app_name_lower in dept_blocked:
            return 'blocked'
        if app_name_lower in dept_allowed:
            return 'allowed'
        if app_name_lower in self.global_blocked:
            return 'blocked'
        if app_name_lower in self.global_allowed:
            return 'allowed'
        return 'neutral'

    def invalidate_users_cache(self) -> None:
        """Сбрасывает кэш пользователей (вызывать после изменения данных)."""
        with self._cache_lock:
            self._users_cache = None
            self._users_cache_ts = 0.0

    # ------------------------------------------------------------------ helpers

    def _load_associated_data(self, db, user_ids: List[int], log_users) -> tuple:
        """Загружает приложения, компьютеры и правила отделов для списка user_ids.
        Возвращает (apps_by_user, computers_by_user, log_files_by_user, dept_allowed, dept_blocked).
        """
        apps_by_user: Dict[int, List[Dict]] = {}
        for row in (
            db.query(LogApp.user_id, LogApp.name, LogApp.first_launch, LogApp.launch_count, LogApp.last_seen)
            .filter(LogApp.user_id.in_(user_ids))
            .all()
        ):
            apps_by_user.setdefault(row[0], []).append({
                'name': row[1],
                'first_launch': row[2].strftime('%Y-%m-%d %H:%M:%S') if row[2] else None,
                'launch_count': row[3],
                'last_seen': row[4].strftime('%Y-%m-%d %H:%M:%S') if row[4] else None,
            })

        log_files_by_user: Dict[int, int] = {
            row[0]: row[1]
            for row in (
                db.query(
                    LogApp.user_id,
                    func.count(func.distinct(func.cast(LogApp.first_launch, Date)))
                )
                .filter(LogApp.user_id.in_(user_ids), LogApp.first_launch.isnot(None))
                .group_by(LogApp.user_id)
                .all()
            )
        }

        computers_by_user: Dict[int, List[str]] = {}
        for uid, comp_name in (
            db.query(LogUser.id, Computer.name)
            .join(UserComputer, LogUser.id == UserComputer.user_id)
            .join(Computer, Computer.id == UserComputer.computer_id)
            .filter(LogUser.id.in_(user_ids))
            .order_by(UserComputer.last_seen.desc())
            .all()
        ):
            computers_by_user.setdefault(uid, []).append(comp_name)

        dept_ids = list({u.department_id for u, _ in log_users if u.department_id})
        dept_allowed: Dict[int, set] = {}
        dept_blocked: Dict[int, set] = {}
        if dept_ids:
            for dept_id, app_name in (
                db.query(DepartmentAllowedApp.department_id, DepartmentAllowedApp.app_name)
                .filter(DepartmentAllowedApp.department_id.in_(dept_ids))
                .all()
            ):
                dept_allowed.setdefault(dept_id, set()).add(app_name.lower())
            for dept_id, app_name in (
                db.query(DepartmentBlockedApp.department_id, DepartmentBlockedApp.app_name)
                .filter(DepartmentBlockedApp.department_id.in_(dept_ids))
                .all()
            ):
                dept_blocked.setdefault(dept_id, set()).add(app_name.lower())

        return apps_by_user, computers_by_user, log_files_by_user, dept_allowed, dept_blocked

    def _assemble_user_record(
        self, log_user, dept,
        apps_by_user, computers_by_user, log_files_by_user,
        dept_allowed, dept_blocked,
        today: str,
    ) -> Dict:
        """Собирает словарь пользователя из предзагруженных данных."""
        user_id = log_user.id
        department_id = log_user.department_id
        allowed_set = dept_allowed.get(department_id, set())
        blocked_set = dept_blocked.get(department_id, set())

        apps_list = []
        allowed_count = blocked_count = neutral_count = 0
        for app in sorted(apps_by_user.get(user_id, []), key=lambda x: x['first_launch'] or ''):
            status = self._get_app_status(app['name'].lower(), allowed_set, blocked_set)
            if status == 'allowed':
                allowed_count += 1
            elif status == 'blocked':
                blocked_count += 1
            else:
                neutral_count += 1
            apps_list.append({
                'name': app['name'],
                'first_launch': app['first_launch'],
                'last_seen': app['last_seen'],
                'launch_count': app['launch_count'],
                'status': status,
            })

        first_activity = log_user.first_seen.strftime('%H:%M:%S') if log_user.first_seen else None

        computers = computers_by_user.get(user_id, [])
        return {
            'username': log_user.username,
            'last_name': log_user.last_name,
            'first_name': log_user.first_name,
            'middle_name': log_user.middle_name,
            'city': log_user.city,
            'address': log_user.address,
            'telegram': log_user.telegram,
            'department_id': department_id,
            'department': dept.name if dept else 'Не указан',
            'computers': ', '.join(computers) if computers else 'Не указан',
            'log_date': today,
            'first_activity': first_activity,
            'apps': apps_list,
            'total_apps': len(apps_list),
            'total_launches': sum(a['launch_count'] for a in apps_list),
            'allowed_count': allowed_count,
            'blocked_count': blocked_count,
            'neutral_count': neutral_count,
            'log_files_count': log_files_by_user.get(user_id, 1),
        }

    def _build_scope_filter(self, db, data_scope: dict):
        """Строит SQLAlchemy-фильтр из data_scope. Возвращает None если ограничений нет."""
        depts = data_scope.get('departments', [])
        cities = data_scope.get('cities', [])
        users_list = data_scope.get('users', [])
        if not depts and not cities and not users_list:
            return None
        conditions = []
        if depts:
            dept_ids_sq = db.query(Department.id).filter(Department.name.in_(depts)).subquery()
            conditions.append(LogUser.department_id.in_(dept_ids_sq))
        if cities:
            conditions.append(LogUser.city.in_(cities))
        if users_list:
            conditions.append(LogUser.username.in_(users_list))
        return or_(*conditions)

    # ------------------------------------------------------------------ public

    def get_all_users_data(self) -> List[Dict]:
        """Загружает всех пользователей (батч-запросы, кэш 60 сек).
        Используется отчётами и непагинированными запросами.
        """
        with self._cache_lock:
            if self._users_cache is not None and (time.monotonic() - self._users_cache_ts) < _USERS_CACHE_TTL:
                logger.debug("get_all_users_data: возврат из кэша")
                return self._users_cache

        db = SessionLocal()
        try:
            log_users = (
                db.query(LogUser, Department)
                .outerjoin(Department, LogUser.department_id == Department.id)
                .order_by(LogUser.username)
                .all()
            )
            if not log_users:
                return []
            user_ids = [u.id for u, _ in log_users]
            assoc = self._load_associated_data(db, user_ids, log_users)
        finally:
            db.close()

        today = datetime.now().strftime('%Y-%m-%d')
        users_data = [
            self._assemble_user_record(lu, dept, *assoc, today)
            for lu, dept in log_users
        ]
        logger.debug("get_all_users_data: загружено %d пользователей", len(users_data))
        with self._cache_lock:
            self._users_cache = users_data
            self._users_cache_ts = time.monotonic()
        return users_data

    def get_users_page(self, page: int, limit: int, data_scope: dict, search: str = '') -> Dict:
        """Возвращает одну страницу пользователей с пагинацией на уровне БД.
        Фильтры data_scope и search применяются в SQL (не в Python).
        Возвращает {"items": [...], "total": int}.
        """
        db = SessionLocal()
        try:
            scope_filter = self._build_scope_filter(db, data_scope)

            search_filter = None
            if search:
                s = f'%{search}%'
                dept_ids_sq = db.query(Department.id).filter(Department.name.ilike(s)).subquery()
                search_filter = or_(
                    LogUser.username.ilike(s),
                    LogUser.last_name.ilike(s),
                    LogUser.first_name.ilike(s),
                    LogUser.middle_name.ilike(s),
                    LogUser.department_id.in_(dept_ids_sq),
                )

            active_filters = [f for f in [scope_filter, search_filter] if f is not None]

            count_q = db.query(func.count(LogUser.id))
            page_q = (
                db.query(LogUser, Department)
                .outerjoin(Department, LogUser.department_id == Department.id)
            )
            for f in active_filters:
                count_q = count_q.filter(f)
                page_q = page_q.filter(f)

            total: int = count_q.scalar()

            log_users = (
                page_q
                .order_by(LogUser.username)
                .offset((page - 1) * limit)
                .limit(limit)
                .all()
            )

            if not log_users:
                return {"items": [], "total": total}

            user_ids = [u.id for u, _ in log_users]
            assoc = self._load_associated_data(db, user_ids, log_users)
        finally:
            db.close()

        today = datetime.now().strftime('%Y-%m-%d')
        items = [
            self._assemble_user_record(lu, dept, *assoc, today)
            for lu, dept in log_users
        ]
        return {"items": items, "total": total}

    def _nslookup(self, hostname: str, timeout: int = 3) -> str:
        """Выполняет nslookup и возвращает первый IPv4-адрес или пустую строку."""
        try:
            result = subprocess.run(
                ['nslookup', hostname],
                capture_output=True, text=True, timeout=timeout
            )
            # Ищем строки "Address: x.x.x.x" после строки с именем хоста
            # nslookup выводит: сначала адрес сервера, потом ответ
            found_name = False
            for line in result.stdout.splitlines():
                if 'Name:' in line or 'name =' in line.lower():
                    found_name = True
                if found_name and 'Address:' in line:
                    ip = line.split('Address:')[-1].strip().split()[0]
                    if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', ip):
                        return ip
            # Fallback: любой IPv4 в выводе (кроме строк "#53")
            for line in result.stdout.splitlines():
                if 'Address:' in line and '#' not in line:
                    ip = line.split('Address:')[-1].strip().split()[0]
                    if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', ip):
                        return ip
        except Exception:
            pass
        return ''

    def resolve_computer_ips(self) -> int:
        """Выполняет nslookup для компьютеров без IP. Возвращает количество обновлённых."""
        computers = log_user_db.get_unresolved_computers()
        if not computers:
            return 0
        logger.info("Определение IP для %d компьютеров...", len(computers))
        resolved = 0
        for name in computers:
            ip = self._nslookup(name)
            log_user_db.update_computer_ip(name, ip)
            if ip:
                resolved += 1
                logger.debug("IP resolved: %s → %s", name, ip)
            else:
                logger.debug("IP не определён: %s", name)
        logger.info("IP определено: %d из %d", resolved, len(computers))
        return resolved

    def get_processing_status(self) -> Dict:
        """Статус обработки логов: всего файлов, last_mtime."""
        last_mtime = settings_db.get_int(LAST_PROCESSED_MTIME_KEY) or 0
        return {
            'total_files': len(self.find_all_log_files()),
            'last_processed_mtime': last_mtime,
            'last_processed_iso': datetime.fromtimestamp(last_mtime).isoformat() if last_mtime else None
        }

    def get_global_stats(self, users_data: List[Dict]) -> Dict:
        """Получает глобальную статистику"""
        total_log_files = len(self.find_all_log_files())
        if not users_data:
            return {
                'total_users': 0,
                'total_launches': 0,
                'total_unique_apps': 0,
                'avg_launches_per_user': 0,
                'total_log_files': total_log_files,
                'avg_log_files_per_user': 0,
                'total_computers': 0,
                'top_apps': [],
                'status_stats': {
                    'allowed': 0,
                    'blocked': 0,
                    'neutral': 0
                }
            }

        total_users = len(users_data)
        total_launches = sum(user['total_launches'] for user in users_data)
        total_unique_apps = set()
        all_computers = set()

        # Статистика по статусам
        total_allowed = 0
        total_blocked = 0
        total_neutral = 0

        for user in users_data:
            total_allowed += user['allowed_count']
            total_blocked += user['blocked_count']
            total_neutral += user['neutral_count']

            for app in user['apps']:
                total_unique_apps.add(app['name'])
            if user['computers'] and user['computers'] != 'Не указан':
                for comp in user['computers'].split(', '):
                    all_computers.add(comp)

        all_apps_counter = Counter()
        users_per_app: Counter = Counter()
        for user in users_data:
            for app in user['apps']:
                all_apps_counter[app['name']] += app['launch_count']
                users_per_app[app['name']] += 1

        top_apps = [
            {'name': app_name, 'count': count, 'users': users_per_app[app_name]}
            for app_name, count in all_apps_counter.most_common(10)
        ]

        return {
            'total_users': total_users,
            'total_launches': total_launches,
            'total_log_files': total_log_files,
            'total_unique_apps': len(total_unique_apps),
            'total_computers': len(all_computers),
            'avg_launches_per_user': total_launches // total_users if total_users > 0 else 0,
            'avg_log_files_per_user': round(total_log_files / total_users, 1) if total_users > 0 else 0,
            'top_apps': top_apps,
            'status_stats': {
                'allowed': total_allowed,
                'blocked': total_blocked,
                'neutral': total_neutral
            }
        }


logger.info("LogAnalyzer module initialized with department-specific rules")