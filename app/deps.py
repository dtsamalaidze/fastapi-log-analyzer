# -*- coding: utf-8 -*-
# app/deps.py
# FastAPI dependency functions shared across routers.
from fastapi import HTTPException, Request

from app.auth import auth_manager


def get_current_user(request: Request):
    return auth_manager.get_current_user(request)


def require_auth(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


def require_admin(request: Request) -> dict:
    user = get_current_user(request)
    if not user or user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    return user


def get_user_data_scope(request: Request) -> dict:
    """Returns data_scope for the current user. Admins get no restrictions."""
    user = get_current_user(request)
    if not user or user['role'] == 'admin':
        return {'departments': [], 'cities': [], 'users': []}
    from app.database import account_db
    perms = account_db.get_permissions(user['username'])
    return perms.get('data_scope', {'departments': [], 'cities': [], 'users': []})


def apply_data_scope(users_data: list, data_scope: dict) -> list:
    """Filters users by data_scope. Empty lists = no restriction (OR between types)."""
    depts = set(data_scope.get('departments', []))
    cities = set(data_scope.get('cities', []))
    users_set = set(data_scope.get('users', []))
    if not depts and not cities and not users_set:
        return users_data
    result = []
    for u in users_data:
        if depts and (u.get('department') or '') in depts:
            result.append(u)
        elif cities and (u.get('city') or '') in cities:
            result.append(u)
        elif users_set and u['username'] in users_set:
            result.append(u)
    return result
