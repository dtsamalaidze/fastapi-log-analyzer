# -*- coding: utf-8 -*-
# app/s3_sync.py
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

from app import config


class S3Syncer:
    """Синхронизация папки logs/ из Yandex Object Storage (S3-совместимое API)."""

    def __init__(self):
        self._s3 = None
        self.last_sync: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.total_downloaded: int = 0

    # ------------------------------------------------------------------
    # Внутренние методы
    # ------------------------------------------------------------------

    def _get_s3(self):
        if self._s3 is None:
            self._s3 = boto3.client(
                's3',
                endpoint_url=config.S3_ENDPOINT,
                aws_access_key_id=config.S3_ACCESS_KEY,
                aws_secret_access_key=config.S3_SECRET_KEY,
            )
        return self._s3

    def _key_to_local(self, key: str) -> Optional[Path]:
        """
        Преобразует S3-ключ в локальный путь внутри LOG_FOLDER.
        Возвращает None если ключ не соответствует префиксу или небезопасен.
        """
        prefix = config.S3_PREFIX.strip('/')
        if prefix:
            if not key.startswith(prefix + '/'):
                return None
            rel = key[len(prefix) + 1:]
        else:
            rel = key

        if not rel:
            return None  # это сама «папка»-префикс

        local = (Path(config.LOG_FOLDER) / rel).resolve()
        logs_root = Path(config.LOG_FOLDER).resolve()

        try:
            local.relative_to(logs_root)  # защита от path traversal
        except ValueError:
            return None

        return local

    # ------------------------------------------------------------------
    # Публичные методы
    # ------------------------------------------------------------------

    def sync(self) -> Dict:
        """
        Скачивает из бакета файлы, которых нет локально или которые изменились
        (сравнивается размер). Возвращает словарь с итогами.
        """
        if not BOTO3_AVAILABLE:
            return {'ok': False, 'error': 'boto3 не установлен (pip install boto3)', 'downloaded': 0}

        if not config.S3_ENABLED:
            return {'ok': False, 'error': 'S3 не настроен (задайте S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET)', 'downloaded': 0}

        s3 = self._get_s3()
        downloaded = skipped = errors = 0
        prefix = config.S3_PREFIX.strip('/') + '/' if config.S3_PREFIX.strip('/') else ''

        try:
            paginator = s3.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=config.S3_BUCKET, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key: str = obj['Key']
                    remote_size: int = obj['Size']

                    local_path = self._key_to_local(key)
                    if local_path is None:
                        continue

                    # Пропускаем файл если он уже есть и размер совпадает
                    if local_path.exists() and local_path.stat().st_size == remote_size:
                        skipped += 1
                        continue

                    try:
                        local_path.parent.mkdir(parents=True, exist_ok=True)
                        s3.download_file(config.S3_BUCKET, key, str(local_path))
                        downloaded += 1
                    except (BotoCoreError, ClientError, OSError) as e:
                        print(f"❌ S3 download {key}: {e}")
                        errors += 1

            self.last_sync = datetime.now()
            self.last_error = None
            self.total_downloaded += downloaded

            print(f"✅ S3 sync: скачано {downloaded}, пропущено {skipped}, ошибок {errors}")
            return {
                'ok': True,
                'downloaded': downloaded,
                'skipped': skipped,
                'errors': errors,
                'synced_at': self.last_sync.isoformat(),
            }

        except (BotoCoreError, ClientError) as e:
            self.last_error = str(e)
            print(f"❌ S3 sync failed: {e}")
            return {'ok': False, 'error': str(e), 'downloaded': 0}

    def status(self) -> Dict:
        return {
            'enabled': config.S3_ENABLED,
            'boto3_installed': BOTO3_AVAILABLE,
            'bucket': config.S3_BUCKET or None,
            'prefix': config.S3_PREFIX or None,
            'endpoint': config.S3_ENDPOINT,
            'sync_interval_sec': config.S3_SYNC_INTERVAL,
            'last_sync': self.last_sync.isoformat() if self.last_sync else None,
            'last_error': self.last_error,
            'total_downloaded': self.total_downloaded,
        }


# Глобальный экземпляр
s3_syncer = S3Syncer()