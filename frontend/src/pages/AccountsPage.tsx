import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserCog, Plus, Pencil, Trash2, KeyRound, ShieldCheck, Crown, Eye, Check,
  Tag, Lock, X, ChevronDown, Building2, MapPin, User,
} from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../hooks/useAuth'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import type { SystemAccount, UserPermissions, DataScope, PermissionRole } from '../types'
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_VIEWER_PERMISSIONS } from '../types'

// ─── helpers ───────────────────────────────────────────────────────────────

function mergePerms(base: UserPermissions, partial: Partial<UserPermissions>): UserPermissions {
  return {
    users: { ...base.users, ...(partial.users ?? {}) },
    departments: { ...base.departments, ...(partial.departments ?? {}) },
    apps_global: { ...base.apps_global, ...(partial.apps_global ?? {}) },
    apps_department: { ...base.apps_department, ...(partial.apps_department ?? {}) },
    reports: { ...base.reports, ...(partial.reports ?? {}) },
    logs: { ...base.logs, ...(partial.logs ?? {}) },
    accounts: { ...base.accounts, ...(partial.accounts ?? {}) },
    database: { ...base.database, ...(partial.database ?? {}) },
    pages: { ...base.pages, ...(partial.pages ?? {}) },
    report_types: { ...base.report_types, ...(partial.report_types ?? {}) },
    data_scope: {
      departments: partial.data_scope?.departments ?? base.data_scope.departments,
      cities: partial.data_scope?.cities ?? base.data_scope.cities,
      users: partial.data_scope?.users ?? base.data_scope.users,
    },
  }
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'

// ─── Permission Matrix config ───────────────────────────────────────────────

interface PermRow {
  section: keyof UserPermissions
  label: string
  fields: { key: string; label: string }[]
}

const PERM_ROWS: PermRow[] = [
  {
    section: 'users',
    label: 'Пользователи',
    fields: [
      { key: 'view', label: 'Просмотр списка' },
      { key: 'edit_profile', label: 'Редактирование профиля' },
    ],
  },
  {
    section: 'departments',
    label: 'Отделы',
    fields: [
      { key: 'view', label: 'Просмотр' },
      { key: 'edit', label: 'Управление' },
    ],
  },
  {
    section: 'apps_global',
    label: 'Приложения (глобально)',
    fields: [
      { key: 'view', label: 'Просмотр' },
      { key: 'edit', label: 'Управление списками' },
    ],
  },
  {
    section: 'apps_department',
    label: 'Приложения (по отделам)',
    fields: [
      { key: 'view', label: 'Просмотр' },
      { key: 'edit', label: 'Управление списками' },
    ],
  },
  {
    section: 'reports',
    label: 'Отчёты',
    fields: [{ key: 'view', label: 'Просмотр отчётов' }],
  },
  {
    section: 'logs',
    label: 'Обработка логов',
    fields: [{ key: 'process', label: 'Запуск обработки' }],
  },
  {
    section: 'accounts',
    label: 'Управление аккаунтами',
    fields: [{ key: 'manage', label: 'Полный доступ' }],
  },
  {
    section: 'database',
    label: 'База данных',
    fields: [
      { key: 'view', label: 'Просмотр статистики' },
      { key: 'manage', label: 'Управление (бекап, vacuum, очистка)' },
    ],
  },
  {
    section: 'pages',
    label: 'Видимость страниц',
    fields: [
      { key: 'users', label: 'Пользователи' },
      { key: 'reports', label: 'Отчёты' },
      { key: 'apps', label: 'Приложения' },
      { key: 'departments', label: 'Отделы' },
      { key: 'database', label: 'База данных' },
    ],
  },
  {
    section: 'report_types',
    label: 'Видимость отчётов',
    fields: [
      { key: 'users', label: 'Пользователи' },
      { key: 'apps', label: 'Приложения' },
      { key: 'computers', label: 'Компьютеры' },
      { key: 'departments', label: 'Отделы' },
    ],
  },
]

// ─── DataScopeEditor ─────────────────────────────────────────────────────────

type ScopeDropdownProps = {
  label: string
  icon: React.ReactNode
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
  emptyLabel: string
  searchable?: boolean
}

function ScopeDropdown({ label, icon, options, selected, onChange, emptyLabel, searchable }: ScopeDropdownProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
    if (!open) setSearch('')
  }, [open, searchable])

  function toggle(v: string) {
    const s = new Set(selected)
    s.has(v) ? s.delete(v) : s.add(v)
    onChange(Array.from(s))
  }

  const filtered = searchable && search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const btnLabel = selected.length === 0
    ? emptyLabel
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} выбрано`

  return (
    <div ref={ref} className="relative">
      <div className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 w-full px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          selected.length > 0
            ? 'border-amber-400 bg-amber-50 text-amber-800 font-medium'
            : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
        }`}
      >
        <span className="truncate">{btnLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-64 bg-white border border-gray-200 rounded-xl shadow-lg flex flex-col max-h-64">
          {searchable && (
            <div className="p-2 border-b border-gray-100 shrink-0">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}
          <div className="overflow-y-auto">
            {!search && (
              <div
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm border-b border-gray-100 ${selected.length === 0 ? 'text-indigo-600 font-medium' : 'text-gray-600'}`}
                onClick={() => onChange([])}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${selected.length === 0 ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                  {selected.length === 0 && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </span>
                Все (без ограничений)
              </div>
            )}
            {filtered.map(opt => (
              <div
                key={opt.value}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm text-gray-700"
                onClick={() => toggle(opt.value)}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected.includes(opt.value) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                  {selected.includes(opt.value) && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </span>
                <span className="truncate">{opt.label}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">Ничего не найдено</div>
            )}
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map(v => (
            <span key={v} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
              {options.find(o => o.value === v)?.label ?? v}
              <button type="button" onClick={() => toggle(v)} className="hover:text-amber-600 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DataScopeEditor({ scope, onChange }: { scope: DataScope; onChange: (s: DataScope) => void }) {
  const { data: opts } = useQuery({ queryKey: ['scope-options'], queryFn: api.getScopeOptions })

  const deptOptions = (opts?.departments ?? []).map(d => ({ value: d, label: d }))
  const cityOptions = (opts?.cities ?? []).map(c => ({ value: c, label: c }))
  const userOptions = (opts?.users ?? []).map(u => ({
    value: u.username,
    label: u.display_name !== u.username ? `${u.display_name} (${u.username})` : u.username,
  }))

  const hasRestrictions = scope.departments.length > 0 || scope.cities.length > 0 || scope.users.length > 0

  return (
    <div className={`rounded-xl border p-4 space-y-4 ${hasRestrictions ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          Ограничение видимости данных
        </p>
        {hasRestrictions && (
          <button
            type="button"
            onClick={() => onChange({ departments: [], cities: [], users: [] })}
            className="text-xs text-amber-600 hover:text-amber-800 underline"
          >
            Сбросить всё
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        Если выбраны ограничения — пользователь видит только тех, кто подходит хотя бы под одно условие. Пустые поля = без ограничений.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ScopeDropdown
          label="Отделы"
          icon={<Building2 className="w-3.5 h-3.5" />}
          options={deptOptions}
          selected={scope.departments}
          onChange={v => onChange({ ...scope, departments: v })}
          emptyLabel="Все отделы"
        />
        <ScopeDropdown
          label="Города"
          icon={<MapPin className="w-3.5 h-3.5" />}
          options={cityOptions}
          selected={scope.cities}
          onChange={v => onChange({ ...scope, cities: v })}
          emptyLabel="Все города"
        />
        <ScopeDropdown
          label="Конкретные пользователи"
          icon={<User className="w-3.5 h-3.5" />}
          options={userOptions}
          selected={scope.users}
          onChange={v => onChange({ ...scope, users: v })}
          emptyLabel="Все пользователи"
          searchable
        />
      </div>
    </div>
  )
}

// ─── RoleBadge ──────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return role === 'admin' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
      <Crown className="w-3 h-3" />
      admin
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
      <Eye className="w-3 h-3" />
      viewer
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 mb-1">{children}</label>
}

// ─── Permissions matrix shared component ───────────────────────────────────

function PermMatrix({
  perms,
  onChange,
}: {
  perms: UserPermissions
  onChange: (p: UserPermissions) => void
}) {
  function toggle(section: keyof UserPermissions, key: string) {
    const sec = { ...(perms[section] as Record<string, boolean>) }
    sec[key] = !sec[key]
    onChange({ ...perms, [section]: sec })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-48">Раздел</th>
            <th className="text-left px-4 py-2.5 font-medium text-gray-600">Права</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {PERM_ROWS.map(row => {
            const sec = perms[row.section] as Record<string, boolean>
            const isPageSection = row.section === 'pages' || row.section === 'report_types'
            return (
              <tr key={row.section} className={`hover:bg-gray-50 transition-colors ${isPageSection ? 'bg-blue-50/30' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-700 text-sm">
                  {row.label}
                  {isPageSection && (
                    <span className="ml-1.5 text-xs text-blue-500 font-normal">видимость</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {row.fields.map(field => (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => toggle(row.section, field.key)}
                        className="flex items-center gap-2 group"
                      >
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                            sec?.[field.key]
                              ? 'bg-indigo-600 border-indigo-600'
                              : 'border-gray-300 bg-white group-hover:border-indigo-300'
                          }`}
                        >
                          {sec?.[field.key] && (
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          )}
                        </span>
                        <span className="text-gray-700 text-sm select-none">{field.label}</span>
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Modal: Create account ──────────────────────────────────────────────────

function CreateAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'viewer' })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.createAccount(form),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setForm({ username: '', password: '', name: '', role: 'viewer' })
      setErr('')
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <Modal open={open} title="Создать аккаунт" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <FieldLabel>Логин</FieldLabel>
          <input className={inputCls} value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder="username" />
        </div>
        <div>
          <FieldLabel>Отображаемое имя</FieldLabel>
          <input className={inputCls} value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Иванов Иван" />
        </div>
        <div>
          <FieldLabel>Пароль</FieldLabel>
          <input type="password" className={inputCls} value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Минимум 8 символов" />
        </div>
        <div>
          <FieldLabel>Системная роль</FieldLabel>
          <select className={inputCls} value={form.role}
            onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
            <option value="viewer">viewer — только просмотр</option>
            <option value="admin">admin — полный доступ</option>
          </select>
        </div>
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>Создать</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: Edit account ────────────────────────────────────────────────────

function EditAccountModal({
  open, onClose, account, currentUser,
}: { open: boolean; onClose: () => void; account: SystemAccount; currentUser: string }) {
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [form, setForm] = useState({ name: account.name, role: account.role })
  const [err, setErr] = useState('')
  const isSelf = account.username === currentUser

  const mutation = useMutation({
    mutationFn: () => api.updateAccount(account.username, form),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setErr(''); onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <Modal open={open} title={`Редактировать: ${account.username}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <FieldLabel>Отображаемое имя</FieldLabel>
          <input className={inputCls} value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </div>
        <div>
          <FieldLabel>Системная роль</FieldLabel>
          <select className={inputCls} value={form.role}
            onChange={e => setForm(p => ({ ...p, role: e.target.value as 'admin' | 'viewer' }))}
            disabled={isSelf}>
            <option value="viewer">viewer — только просмотр</option>
            <option value="admin">admin — полный доступ</option>
          </select>
          {isSelf && <p className="text-xs text-gray-400 mt-1">Нельзя изменить собственную роль</p>}
        </div>
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>Сохранить</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: Change password ─────────────────────────────────────────────────

function ChangePasswordModal({ open, onClose, account }: { open: boolean; onClose: () => void; account: SystemAccount }) {
  const { showToast } = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.updateAccountPassword(account.username, password),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setPassword(''); setConfirm(''); setErr(''); onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function submit() {
    setErr('')
    if (password.length < 8) { setErr('Пароль должен быть не менее 8 символов'); return }
    if (password !== confirm) { setErr('Пароли не совпадают'); return }
    mutation.mutate()
  }

  return (
    <Modal open={open} title={`Смена пароля: ${account.username}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <FieldLabel>Новый пароль</FieldLabel>
          <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Повторите пароль</FieldLabel>
          <input type="password" className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} />
        </div>
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} loading={mutation.isPending}>Изменить пароль</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: Permissions ─────────────────────────────────────────────────────

function PermissionsModal({ open, onClose, account }: { open: boolean; onClose: () => void; account: SystemAccount }) {
  const { showToast } = useToast()
  const defaultBase = account.role === 'admin' ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_VIEWER_PERMISSIONS
  const [perms, setPerms] = useState<UserPermissions>(mergePerms(defaultBase, account.permissions))

  const { data: rolesData } = useQuery({ queryKey: ['roles'], queryFn: api.getRoles })
  const roles = rolesData?.roles ?? []

  function applyPreset(role: 'admin' | 'viewer') {
    setPerms(mergePerms(role === 'admin' ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_VIEWER_PERMISSIONS, {}))
  }

  function applyRole(roleName: string) {
    const found = roles.find(r => r.name === roleName)
    if (found) setPerms(mergePerms(defaultBase, found.permissions))
  }

  const mutation = useMutation({
    mutationFn: () => api.setAccountPermissions(account.username, perms),
    onSuccess: (data) => { showToast(data.message, 'success'); onClose() },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <Modal open={open} title={`Права доступа: ${account.username}`} onClose={onClose} wide>
      <div className="space-y-4">
        {/* Presets & roles */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 shrink-0">Шаблон:</span>
          <button className="text-xs px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
            onClick={() => applyPreset('admin')}>Полный доступ</button>
          <button className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            onClick={() => applyPreset('viewer')}>Только просмотр</button>
          {roles.filter(r => !r.is_builtin).map(r => (
            <button key={r.name}
              className="text-xs px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
              onClick={() => applyRole(r.name)}>
              {r.name}
            </button>
          ))}
        </div>

        <PermMatrix perms={perms} onChange={setPerms} />

        <DataScopeEditor
          scope={perms.data_scope}
          onChange={ds => setPerms(p => ({ ...p, data_scope: ds }))}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>Сохранить права</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal: Delete account ──────────────────────────────────────────────────

function DeleteAccountModal({ open, onClose, account }: { open: boolean; onClose: () => void; account: SystemAccount }) {
  const qc = useQueryClient()
  const { showToast } = useToast()

  const mutation = useMutation({
    mutationFn: () => api.deleteAccount(account.username),
    onSuccess: (data) => { showToast(data.message, 'success'); qc.invalidateQueries({ queryKey: ['accounts'] }); onClose() },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <Modal open={open} title="Удалить аккаунт" onClose={onClose}>
      <p className="text-gray-600 mb-6">
        Вы уверены, что хотите удалить аккаунт{' '}
        <span className="font-semibold text-gray-800">{account.username}</span>? Это действие необратимо.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
        <Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending}>Удалить</Button>
      </div>
    </Modal>
  )
}

// ─── Modal: Create / Edit role ──────────────────────────────────────────────

function RoleModal({
  open, onClose, editing,
}: { open: boolean; onClose: () => void; editing: PermissionRole | null }) {
  const qc = useQueryClient()
  const { showToast } = useToast()
  const isEdit = editing !== null
  const defaultBase = DEFAULT_VIEWER_PERMISSIONS

  const [name, setName] = useState(editing?.name ?? '')
  const [desc, setDesc] = useState(editing?.description ?? '')
  const [perms, setPerms] = useState<UserPermissions>(
    isEdit ? mergePerms(defaultBase, editing!.permissions) : { ...DEFAULT_VIEWER_PERMISSIONS }
  )
  const [err, setErr] = useState('')

  const createMutation = useMutation({
    mutationFn: () => api.createRole({ name: name.trim(), description: desc.trim(), permissions: perms }),
    onSuccess: (data) => { showToast(data.message, 'success'); qc.invalidateQueries({ queryKey: ['roles'] }); onClose() },
    onError: (e: Error) => setErr(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () => api.updateRole(editing!.name, { description: desc.trim(), permissions: perms }),
    onSuccess: (data) => { showToast(data.message, 'success'); qc.invalidateQueries({ queryKey: ['roles'] }); onClose() },
    onError: (e: Error) => setErr(e.message),
  })

  function submit() {
    setErr('')
    if (!isEdit && !name.trim()) { setErr('Название обязательно'); return }
    isEdit ? updateMutation.mutate() : createMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Modal open={open} title={isEdit ? `Редактировать роль: ${editing!.name}` : 'Создать роль'} onClose={onClose} wide>
      <div className="space-y-4">
        {!isEdit && (
          <div>
            <FieldLabel>Название роли</FieldLabel>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Например: Оператор" />
          </div>
        )}
        <div>
          <FieldLabel>Описание</FieldLabel>
          <input className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Краткое описание роли" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Матрица прав</p>
          <PermMatrix perms={perms} onChange={setPerms} />
        </div>
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} loading={isPending}>{isEdit ? 'Сохранить' : 'Создать'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Roles tab ──────────────────────────────────────────────────────────────

function RolesTab() {
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [roleModal, setRoleModal] = useState<{ open: boolean; editing: PermissionRole | null }>({ open: false, editing: null })
  const [deleteTarget, setDeleteTarget] = useState<PermissionRole | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: api.getRoles })
  const roles = data?.roles ?? []

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteRole(name),
    onSuccess: (data) => { showToast(data.message, 'success'); qc.invalidateQueries({ queryKey: ['roles'] }); setDeleteTarget(null) },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Шаблоны прав, которые можно применять к аккаунтам</p>
        <Button onClick={() => setRoleModal({ open: true, editing: null })} className="flex items-center gap-2" size="sm">
          <Plus className="w-4 h-4" />
          Создать роль
        </Button>
      </div>

      {isLoading && <div className="text-center py-10 text-gray-400">Загрузка...</div>}

      {!isLoading && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 font-medium text-gray-600">Название</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Описание</th>
                <th className="text-right px-5 py-3 font-medium text-gray-600">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roles.map(role => (
                <tr key={role.name} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {role.is_builtin ? (
                        <Lock className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <Tag className="w-4 h-4 text-purple-500 shrink-0" />
                      )}
                      <span className="font-medium text-gray-800">{role.name}</span>
                      {role.is_builtin && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">встроенная</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{role.description || '—'}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn
                        icon={<Pencil className="w-4 h-4" />}
                        title="Редактировать"
                        onClick={() => setRoleModal({ open: true, editing: role })}
                        colorCls="text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
                      />
                      {!role.is_builtin && (
                        <IconBtn
                          icon={<Trash2 className="w-4 h-4" />}
                          title="Удалить"
                          onClick={() => setDeleteTarget(role)}
                          colorCls="text-red-400 hover:bg-red-50 hover:text-red-600"
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoleModal
        open={roleModal.open}
        onClose={() => setRoleModal({ open: false, editing: null })}
        editing={roleModal.editing}
      />

      {/* Delete role confirm */}
      <Modal open={deleteTarget !== null} title="Удалить роль" onClose={() => setDeleteTarget(null)}>
        <p className="text-gray-600 mb-6">
          Вы уверены, что хотите удалить роль{' '}
          <span className="font-semibold text-gray-800">{deleteTarget?.name}</span>?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Отмена</Button>
          <Button variant="danger"
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.name)}
            loading={deleteMutation.isPending}>
            Удалить
          </Button>
        </div>
      </Modal>
    </div>
  )
}

type ModalType = 'create' | 'edit' | 'password' | 'permissions' | 'delete' | null

// ─── IconBtn ─────────────────────────────────────────────────────────────────

function IconBtn({ icon, title, onClick, colorCls }: {
  icon: React.ReactNode; title: string; onClick: () => void; colorCls: string
}) {
  return (
    <button title={title} onClick={onClick} className={`p-1.5 rounded-lg transition-colors ${colorCls}`}>
      {icon}
    </button>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

type PageTab = 'accounts' | 'roles'

export default function AccountsPage() {
  const { user } = useAuth()
  const [pageTab, setPageTab] = useState<PageTab>('accounts')

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-500">
        У вас нет прав для просмотра этой страницы.
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 rounded-xl">
          <UserCog className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Управление аккаунтами</h1>
          <p className="text-sm text-gray-500">Учётные записи, роли и права доступа</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
        {([
          { key: 'accounts', label: 'Аккаунты', icon: UserCog },
          { key: 'roles', label: 'Роли', icon: Tag },
        ] as { key: PageTab; label: string; icon: React.ElementType }[]).map(t => (
          <button key={t.key} onClick={() => setPageTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              pageTab === t.key ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {pageTab === 'accounts' && <AccountsTabWithCreate currentUser={user?.username ?? ''} />}
      {pageTab === 'roles' && <RolesTab />}
    </div>
  )
}

// AccountsTab wrapper that exposes create button via id
function AccountsTabWithCreate({ currentUser }: { currentUser: string }) {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [selected, setSelected] = useState<SystemAccount | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.getAccounts(),
    staleTime: 5 * 60_000,
  })

  const accounts: SystemAccount[] = data?.accounts ?? []
  const adminCount = accounts.filter(a => a.role === 'admin').length
  const viewerCount = accounts.filter(a => a.role === 'viewer').length

  function open(type: ModalType, account?: SystemAccount) {
    if (account) setSelected(account)
    setActiveModal(type)
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex justify-end mb-4">
        <Button onClick={() => open('create')} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Создать аккаунт
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Всего аккаунтов', value: accounts.length, color: 'bg-indigo-50 text-indigo-700' },
          { label: 'Администраторов', value: adminCount, color: 'bg-purple-50 text-purple-700' },
          { label: 'Наблюдателей', value: viewerCount, color: 'bg-gray-50 text-gray-700' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-4 ${c.color}`}>
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-sm mt-0.5 opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      {isLoading && <div className="flex justify-center py-16 text-gray-400">Загрузка...</div>}
      {isError && <div className="flex justify-center py-16 text-red-500">Ошибка загрузки аккаунтов</div>}

      {!isLoading && !isError && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 font-medium text-gray-600">Логин</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Имя</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Системная роль</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Создан</th>
                <th className="text-right px-5 py-3 font-medium text-gray-600">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">Нет аккаунтов</td></tr>
              )}
              {accounts.map(acc => {
                const isSelf = acc.username === currentUser
                return (
                  <tr key={acc.username} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold uppercase shrink-0">
                          {acc.username[0]}
                        </div>
                        <span className="font-medium text-gray-800">{acc.username}</span>
                        {isSelf && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">вы</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{acc.name}</td>
                    <td className="px-5 py-3.5"><RoleBadge role={acc.role} /></td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">
                      {acc.created_at ? new Date(acc.created_at).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconBtn icon={<Pencil className="w-4 h-4" />} title="Редактировать"
                          onClick={() => open('edit', acc)} colorCls="text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700" />
                        <IconBtn icon={<KeyRound className="w-4 h-4" />} title="Сменить пароль"
                          onClick={() => open('password', acc)} colorCls="text-amber-500 hover:bg-amber-50 hover:text-amber-700" />
                        <IconBtn icon={<ShieldCheck className="w-4 h-4" />} title="Права доступа"
                          onClick={() => open('permissions', acc)} colorCls="text-purple-500 hover:bg-purple-50 hover:text-purple-700" />
                        {!isSelf && (
                          <IconBtn icon={<Trash2 className="w-4 h-4" />} title="Удалить"
                            onClick={() => open('delete', acc)} colorCls="text-red-400 hover:bg-red-50 hover:text-red-600" />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateAccountModal open={activeModal === 'create'} onClose={() => setActiveModal(null)} />
      {selected && (
        <>
          <EditAccountModal key={selected.username} open={activeModal === 'edit'} onClose={() => setActiveModal(null)}
            account={selected} currentUser={currentUser} />
          <ChangePasswordModal key={selected.username} open={activeModal === 'password'} onClose={() => setActiveModal(null)} account={selected} />
          <PermissionsModal key={selected.username} open={activeModal === 'permissions'} onClose={() => setActiveModal(null)} account={selected} />
          <DeleteAccountModal key={selected.username} open={activeModal === 'delete'} onClose={() => setActiveModal(null)} account={selected} />
        </>
      )}
    </>
  )
}
