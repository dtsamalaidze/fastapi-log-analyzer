# -*- coding: utf-8 -*-
# app/rate_limiter.py
import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_rate_lock = threading.Lock()

_login_attempts: dict[str, list[datetime]] = defaultdict(list)
_LOGIN_MAX_ATTEMPTS = 10
_LOGIN_WINDOW_SEC = 60
_last_cleanup = datetime.now()
_CLEANUP_INTERVAL_SEC = 300


def _maybe_cleanup_attempts(now: datetime) -> None:
    """Sweep stale IPs from _login_attempts every CLEANUP_INTERVAL_SEC seconds."""
    global _last_cleanup
    if (now - _last_cleanup).total_seconds() < _CLEANUP_INTERVAL_SEC:
        return
    _last_cleanup = now
    cutoff = now - timedelta(seconds=_LOGIN_WINDOW_SEC)
    stale = [ip for ip, ts_list in _login_attempts.items() if not any(t > cutoff for t in ts_list)]
    for ip in stale:
        del _login_attempts[ip]

_user_fail_count: dict[str, int] = defaultdict(int)
_user_locked_until: dict[str, datetime] = {}
_USER_MAX_FAILS = 5
_USER_LOCK_SEC = 300


def check_rate_limit(ip: str) -> bool:
    """Returns True if the IP has not exceeded the rate limit."""
    with _rate_lock:
        now = datetime.now()
        _maybe_cleanup_attempts(now)
        cutoff = now - timedelta(seconds=_LOGIN_WINDOW_SEC)
        attempts = [t for t in _login_attempts[ip] if t > cutoff]
        if not attempts:
            _login_attempts.pop(ip, None)
        else:
            _login_attempts[ip] = attempts
        if len(_login_attempts.get(ip, [])) >= _LOGIN_MAX_ATTEMPTS:
            return False
        _login_attempts[ip] = _login_attempts.get(ip, []) + [now]
        return True


def check_user_lockout(username: str) -> bool:
    """Returns True if the account is not locked."""
    with _rate_lock:
        locked_until = _user_locked_until.get(username)
        return not (locked_until and datetime.now() < locked_until)


def record_failed_login(username: str) -> None:
    """Records a failed login attempt; locks the account after too many failures."""
    with _rate_lock:
        _user_fail_count[username] += 1
        if _user_fail_count[username] >= _USER_MAX_FAILS:
            _user_locked_until[username] = datetime.now() + timedelta(seconds=_USER_LOCK_SEC)
            _user_fail_count[username] = 0
            logger.warning(
                "Аккаунт %s заблокирован на %d сек после %d неудачных попыток",
                username, _USER_LOCK_SEC, _USER_MAX_FAILS,
            )


def reset_user_lockout(username: str) -> None:
    """Clears the failure counter on successful login."""
    with _rate_lock:
        _user_fail_count.pop(username, None)
        _user_locked_until.pop(username, None)
