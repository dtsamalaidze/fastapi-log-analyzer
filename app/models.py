# -*- coding: utf-8 -*-
# app/models.py
from datetime import datetime
from sqlalchemy import (
    Integer, String, Text, Boolean, DateTime, ForeignKey,
    UniqueConstraint, Index, func
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped, relationship
from typing import Optional


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default='viewer')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    sessions: Mapped[list['Session']] = relationship('Session', back_populates='user', cascade='all, delete-orphan', foreign_keys='Session.username')
    permissions: Mapped[Optional['UserPermission']] = relationship('UserPermission', back_populates='user', cascade='all, delete-orphan', foreign_keys='UserPermission.username')


class Session(Base):
    __tablename__ = 'sessions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(255), ForeignKey('users.username', ondelete='CASCADE'), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    user: Mapped['User'] = relationship('User', back_populates='sessions', foreign_keys=[username])


class UserPermission(Base):
    __tablename__ = 'user_permissions'

    username: Mapped[str] = mapped_column(String(255), ForeignKey('users.username', ondelete='CASCADE'), primary_key=True)
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    user: Mapped['User'] = relationship('User', back_populates='permissions', foreign_keys=[username])


class SystemRole(Base):
    __tablename__ = 'system_roles'

    name: Mapped[str] = mapped_column(String(255), primary_key=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class Department(Base):
    __tablename__ = 'departments'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.username'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    allowed_apps: Mapped[list['DepartmentAllowedApp']] = relationship('DepartmentAllowedApp', back_populates='department', cascade='all, delete-orphan')
    blocked_apps: Mapped[list['DepartmentBlockedApp']] = relationship('DepartmentBlockedApp', back_populates='department', cascade='all, delete-orphan')
    log_users: Mapped[list['LogUser']] = relationship('LogUser', back_populates='department')


class GlobalAllowedApp(Base):
    __tablename__ = 'global_allowed_apps'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_name: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    added_by: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.username'), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class GlobalBlockedApp(Base):
    __tablename__ = 'global_blocked_apps'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_name: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    added_by: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.username'), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class DepartmentAllowedApp(Base):
    __tablename__ = 'department_allowed_apps'
    __table_args__ = (UniqueConstraint('department_id', 'app_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    department_id: Mapped[int] = mapped_column(Integer, ForeignKey('departments.id', ondelete='CASCADE'), nullable=False)
    app_name: Mapped[str] = mapped_column(String(500), nullable=False)
    added_by: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.username'), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    department: Mapped['Department'] = relationship('Department', back_populates='allowed_apps')


class DepartmentBlockedApp(Base):
    __tablename__ = 'department_blocked_apps'
    __table_args__ = (UniqueConstraint('department_id', 'app_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    department_id: Mapped[int] = mapped_column(Integer, ForeignKey('departments.id', ondelete='CASCADE'), nullable=False)
    app_name: Mapped[str] = mapped_column(String(500), nullable=False)
    added_by: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.username'), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    department: Mapped['Department'] = relationship('Department', back_populates='blocked_apps')


class LogUser(Base):
    __tablename__ = 'log_users'
    __table_args__ = (
        Index('idx_log_users_username', 'username'),
        Index('idx_log_users_department', 'department_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey('departments.id'), nullable=True)
    first_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    first_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    middle_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    department: Mapped[Optional['Department']] = relationship('Department', back_populates='log_users')
    apps: Mapped[list['LogApp']] = relationship('LogApp', back_populates='user', cascade='all, delete-orphan')
    app_paths: Mapped[list['LogAppPath']] = relationship('LogAppPath', back_populates='user', cascade='all, delete-orphan')
    computers: Mapped[list['UserComputer']] = relationship('UserComputer', back_populates='user', cascade='all, delete-orphan')


class LogApp(Base):
    __tablename__ = 'log_apps'
    __table_args__ = (
        UniqueConstraint('name', 'user_id'),
        Index('idx_log_apps_user', 'user_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey('log_users.id', ondelete='CASCADE'), nullable=False)
    first_launch: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    launch_count: Mapped[int] = mapped_column(Integer, default=1)
    last_seen: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped['LogUser'] = relationship('LogUser', back_populates='apps')


class LogAppPath(Base):
    __tablename__ = 'log_app_paths'
    __table_args__ = (
        UniqueConstraint('user_id', 'app_name', 'computer_name'),
        Index('idx_app_paths_app', 'app_name'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey('log_users.id', ondelete='CASCADE'), nullable=False)
    app_name: Mapped[str] = mapped_column(String(500), nullable=False)
    computer_name: Mapped[str] = mapped_column(String(255), nullable=False, default='')
    full_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    launch_count: Mapped[int] = mapped_column(Integer, default=1)

    user: Mapped['LogUser'] = relationship('LogUser', back_populates='app_paths')


class Computer(Base):
    __tablename__ = 'computers'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    user_computers: Mapped[list['UserComputer']] = relationship('UserComputer', back_populates='computer', cascade='all, delete-orphan')


class UserComputer(Base):
    __tablename__ = 'user_computers'
    __table_args__ = (
        UniqueConstraint('user_id', 'computer_id'),
    )

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey('log_users.id', ondelete='CASCADE'), primary_key=True)
    computer_id: Mapped[int] = mapped_column(Integer, ForeignKey('computers.id', ondelete='CASCADE'), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    user: Mapped['LogUser'] = relationship('LogUser', back_populates='computers')
    computer: Mapped['Computer'] = relationship('Computer', back_populates='user_computers')


class Setting(Base):
    __tablename__ = 'settings'

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
