# -*- coding: utf-8 -*-
# app/state.py
# Shared mutable state: analyzer instance and report cache.
import hashlib
import json
import threading
import time

from app import config
from app.log_analyzer import LogAnalyzer

_REPORT_CACHE_TTL = 60  # seconds


class ReportCache:
    """TTL-cache for aggregated reports, key = (endpoint, hash(scope))."""

    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, tuple[float, object]] = {}

    def _scope_key(self, endpoint: str, scope: dict) -> str:
        h = hashlib.md5(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        return f"{endpoint}:{h}"

    def get(self, endpoint: str, scope: dict):
        key = self._scope_key(endpoint, scope)
        with self._lock:
            entry = self._data.get(key)
            if entry and (time.monotonic() - entry[0]) < _REPORT_CACHE_TTL:
                return entry[1]
        return None

    def set(self, endpoint: str, scope: dict, value) -> None:
        key = self._scope_key(endpoint, scope)
        with self._lock:
            self._data[key] = (time.monotonic(), value)

    def invalidate(self) -> None:
        with self._lock:
            self._data.clear()


analyzer = LogAnalyzer(log_folder=config.LOG_FOLDER)
report_cache = ReportCache()
