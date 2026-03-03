# -*- coding: utf-8 -*-
# app/log_analyzer.py
import re
import os
import glob
import subprocess
from collections import OrderedDict, Counter
from typing import List, Dict, Tuple, Optional
from pathlib import Path
from datetime import datetime

from app.database import (
    log_user_db, log_app_db, global_apps_db,
    department_apps_db, department_db, settings_db
)
from app.db import SessionLocal
from app.models import LogUser, LogApp, Department
from sqlalchemy import func

LAST_PROCESSED_MTIME_KEY = 'logs.last_processed_mtime'


class LogAnalyzer:
    """Класс для анализа лог-файлов"""

    def __init__(self, log_folder: str):
        self.log_folder = log_folder
        self.global_allowed = []
        self.global_blocked = []

    def refresh_global_lists(self):
        """Обновляет глобальные списки из БД"""
        self.global_allowed = [app.lower() for app in global_apps_db.get_allowed_all()]
        self.global_blocked = [app.lower() for app in global_apps_db.get_blocked_all()]
        print(
            f"📋 Глобальные списки обновлены: разрешено {len(self.global_allowed)}, заблокировано {len(self.global_blocked)}")

    def find_all_log_files(self) -> List[str]:
        """Находит все лог-файлы всех пользователей рекурсивно"""
        if not os.path.exists(self.log_folder):
            print(f"⚠️ Папка не найдена: {self.log_folder}")
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
            print(f"❌ Ошибка при парсинге {os.path.basename(filename)}: {e}")

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
            print("📁 Нет лог-файлов для обработки")
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
            print("📁 Нет новых лог-файлов для обработки")
            return {
                'processed': 0,
                'candidates': 0,
                'incremental': not force_full,
                'new_last_mtime': last_mtime
            }

        print(
            f"\n📁 Обработка {len(candidates)} лог-файлов (всего найдено: {len(all_files)}). Режим: {'полный' if force_full else 'инкрементальный'}, last_mtime={last_mtime}")

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
                print(f"❌ Ошибка обработки файла {os.path.basename(log_file)}: {e}")

        # Обновляем маркер обработки только если был прогресс
        if processed_count > 0:
            settings_db.set_int(LAST_PROCESSED_MTIME_KEY, int(max_mtime))
            # Обновляем глобальные списки после обработки новых логов
            self.refresh_global_lists()

        print(f"✅ Обработано файлов: {processed_count}. new_last_mtime={max_mtime}")
        return {
            'processed': processed_count,
            'candidates': len(candidates),
            'incremental': not force_full,
            'new_last_mtime': int(max_mtime)
        }

    def get_app_status_for_user(self, app_name: str, user_department_id: Optional[int]) -> str:
        """
        Определяет статус приложения для пользователя с учетом приоритетов:
        1. Правила отдела (заблокированные) — наивысший приоритет
        2. Правила отдела (разрешенные) — перекрывают глобальные запреты
        3. Глобально заблокированные
        4. Глобально разрешенные
        5. Нейтральные (по умолчанию)
        """
        app_name_lower = app_name.lower()

        # 1–2. Если у пользователя есть отдел, правила отдела имеют высший приоритет
        if user_department_id:
            dept_blocked = [a.lower() for a in department_apps_db.get_blocked_by_department(user_department_id)]
            dept_allowed = [a.lower() for a in department_apps_db.get_allowed_by_department(user_department_id)]

            if app_name_lower in dept_blocked:
                return 'blocked'

            if app_name_lower in dept_allowed:
                return 'allowed'

        # 3. Глобально заблокированные (только если нет правила отдела)
        if app_name_lower in self.global_blocked:
            return 'blocked'

        # 4. Глобально разрешенные
        if app_name_lower in self.global_allowed:
            return 'allowed'

        # 5. По умолчанию — нейтральный
        return 'neutral'

    def get_all_users_data(self) -> List[Dict]:
        """Получает данные по всем пользователям с учетом правил отделов"""

        users_data = []

        db = SessionLocal()
        try:
            log_users = (
                db.query(LogUser, Department)
                .outerjoin(Department, LogUser.department_id == Department.id)
                .order_by(LogUser.username)
                .all()
            )

            for log_user, dept in log_users:
                user_id = log_user.id
                username = log_user.username
                department_id = log_user.department_id
                department_name = dept.name if dept else 'Не указан'

                apps = log_app_db.get_user_apps(user_id)

                apps_list = []
                allowed_count = 0
                blocked_count = 0
                neutral_count = 0

                for app in apps:
                    status = self.get_app_status_for_user(app['name'], department_id)

                    if status == 'allowed':
                        allowed_count += 1
                    elif status == 'blocked':
                        blocked_count += 1
                    else:
                        neutral_count += 1

                    apps_list.append({
                        'name': app['name'],
                        'first_launch': app['first_launch'],
                        'last_seen': app.get('last_seen'),
                        'launch_count': app['launch_count'],
                        'status': status
                    })

                apps_list.sort(key=lambda x: x['first_launch'])

                first_activity = None
                if log_user.first_seen:
                    ts = str(log_user.first_seen)
                    first_activity = ts.split()[1] if ' ' in ts else None

                # Count distinct log dates from first_launch
                log_files_count = (
                    db.query(func.count(func.distinct(func.substring(LogApp.first_launch, 1, 10))))
                    .filter(LogApp.user_id == user_id, LogApp.first_launch != '')
                    .scalar()
                ) or 1

                computers = log_user_db.get_computers(username)
                computers_str = ', '.join(computers) if computers else 'Не указан'

                users_data.append({
                    'username': username,
                    'last_name': log_user.last_name,
                    'first_name': log_user.first_name,
                    'middle_name': log_user.middle_name,
                    'city': log_user.city,
                    'address': log_user.address,
                    'telegram': log_user.telegram,
                    'department_id': department_id,
                    'department': department_name,
                    'computers': computers_str,
                    'log_date': datetime.now().strftime('%Y-%m-%d'),
                    'first_activity': first_activity,
                    'apps': apps_list,
                    'total_apps': len(apps_list),
                    'total_launches': sum(app['launch_count'] for app in apps_list),
                    'allowed_count': allowed_count,
                    'blocked_count': blocked_count,
                    'neutral_count': neutral_count,
                    'log_files_count': log_files_count
                })
        finally:
            db.close()

        print(f"📊 get_all_users_data: загружено {len(users_data)} пользователей")

        # Для отладки выведем статистику по первому пользователю
        if users_data and len(users_data) > 0:
            first_user = users_data[0]
            print(f"👤 {first_user['username']}: всего {first_user['total_apps']} приложений, "
                  f"✅ {first_user['allowed_count']}, ❌ {first_user['blocked_count']}, ⚪ {first_user['neutral_count']}")

        return users_data

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
        print(f"🔍 Определение IP для {len(computers)} компьютеров...")
        resolved = 0
        for name in computers:
            ip = self._nslookup(name)
            log_user_db.update_computer_ip(name, ip)
            if ip:
                resolved += 1
                print(f"   ✅ {name} → {ip}")
            else:
                print(f"   ❓ {name} → не определён")
        print(f"🔍 Готово: определено {resolved} из {len(computers)}")
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
        if not users_data:
            return {
                'total_users': 0,
                'total_launches': 0,
                'total_unique_apps': 0,
                'avg_launches_per_user': 0,
                'total_log_files': len(self.find_all_log_files()),
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
        total_log_files = len(self.find_all_log_files())
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
        for user in users_data:
            for app in user['apps']:
                all_apps_counter[app['name']] += app['launch_count']

        top_apps = []
        for app_name, count in all_apps_counter.most_common(10):
            users_with_app = sum(1 for user in users_data
                                 if any(a['name'] == app_name for a in user['apps']))
            top_apps.append({
                'name': app_name,
                'count': count,
                'users': users_with_app
            })

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


print("✅ LogAnalyzer module initialized with department-specific rules")