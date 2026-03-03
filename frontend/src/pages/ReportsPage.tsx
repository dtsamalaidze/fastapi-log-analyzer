import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, X, MapPin, XCircle, Monitor, Search, Wifi, Users, ChevronDown, Calendar, Copy, Check } from 'lucide-react'
import { api } from '../services/api'
import type { UserData, AppEntry, AppReport, ComputerReport, ComputerUserEntry, DepartmentReport, SortDir } from '../types'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import AppUsersPanel from '../components/ui/AppUsersPanel'
import Pagination from '../components/ui/Pagination'
import { usePermissions } from '../hooks/usePermissions'

// ─── Filter types ────────────────────────────────────────────────────────────

type Tab = 'users' | 'apps' | 'computers' | 'departments'
type Period = 'yesterday' | 'week' | 'month' | 'custom' | null
type StatusFilter = 'allowed' | 'neutral' | 'blocked'

interface FilterProps {
  dateFrom: Date | null
  dateTo: Date | null
  statusFilters: Set<StatusFilter>
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function SortIcon({ field, current, dir }: { field: string; current: string | null; dir: SortDir }) {
  if (field !== current) return <span className="text-gray-300 ml-1">↕</span>
  return <span className="text-indigo-600 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

function useSortedData<T extends object>(data: T[]) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted: T[] = sortKey
    ? [...data].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey]
        const bv = (b as Record<string, unknown>)[sortKey]
        const cmp =
          typeof av === 'string' && typeof bv === 'string'
            ? av.localeCompare(bv)
            : (av as number) - (bv as number)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  return { sorted, sortKey, sortDir, handleSort }
}

function exportCsv(headers: string[], rows: (string | number)[][], filename: string) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function getPeriodDates(
  period: Period,
  customFrom: string,
  customTo: string,
): { from: Date | null; to: Date | null } {
  if (!period) return { from: null, to: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (period === 'yesterday') {
    const from = new Date(today); from.setDate(from.getDate() - 1)
    const to = new Date(from); to.setHours(23, 59, 59, 999)
    return { from, to }
  }
  if (period === 'week') {
    const from = new Date(today); from.setDate(from.getDate() - 7)
    return { from, to: new Date() }
  }
  if (period === 'month') {
    const from = new Date(today); from.setMonth(from.getMonth() - 1)
    return { from, to: new Date() }
  }
  if (period === 'custom') {
    return {
      from: customFrom ? new Date(customFrom) : null,
      to: customTo ? new Date(customTo + 'T23:59:59') : null,
    }
  }
  return { from: null, to: null }
}

function filterApps(
  apps: AppEntry[],
  dateFrom: Date | null,
  dateTo: Date | null,
  statusFilters: Set<StatusFilter>,
): AppEntry[] {
  return apps.filter(app => {
    if (statusFilters.size > 0 && !statusFilters.has(app.status)) return false
    if (dateFrom !== null || dateTo !== null) {
      const dateStr = app.last_seen ?? app.first_launch
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) {
        if (dateFrom !== null && d < dateFrom) return false
        if (dateTo !== null && d > dateTo) return false
      }
    }
    return true
  })
}

function matchesPeriod(dateStr: string | null | undefined, dateFrom: Date | null, dateTo: Date | null): boolean {
  if (dateFrom === null && dateTo === null) return true
  if (!dateStr) return true
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return true
  if (dateFrom !== null && d < dateFrom) return false
  if (dateTo !== null && d > dateTo) return false
  return true
}

function userFio(u: UserData): string | null {
  const parts = [u.last_name, u.first_name, u.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { id: Exclude<Period, null>; label: string }[] = [
  { id: 'yesterday', label: 'За вчера' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'custom', label: 'Свой период' },
]

const STATUS_OPTIONS: { id: StatusFilter; label: string; active: string; inactive: string }[] = [
  {
    id: 'allowed', label: 'Разрешённые',
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive: 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-500',
  },
  {
    id: 'neutral', label: 'Нейтральные',
    active: 'bg-gray-500 text-white border-gray-500',
    inactive: 'bg-white text-gray-600 border-gray-300 hover:border-gray-500',
  },
  {
    id: 'blocked', label: 'Запрещённые',
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-white text-red-700 border-red-300 hover:border-red-500',
  },
]

// ─── City multi-select dropdown ──────────────────────────────────────────────

function CityMultiSelect({
  cities,
  selected,
  onChange,
}: {
  cities: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (city: string) => {
    const next = new Set(selected)
    next.has(city) ? next.delete(city) : next.add(city)
    onChange(next)
  }

  const label =
    selected.size === 0
      ? 'Все города'
      : selected.size === 1
      ? Array.from(selected)[0]
      : `${selected.size} города выбрано`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
          selected.size > 0
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300 hover:text-indigo-600'
        }`}
      >
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[200px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => onChange(new Set())}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
              selected.size === 0 ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
            }`}>
              {selected.size === 0 && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className={selected.size === 0 ? 'font-semibold text-indigo-600' : 'text-gray-700'}>Все города</span>
          </button>
          <div className="border-t border-gray-100 my-1" />
          {cities.map(city => {
            const checked = selected.has(city)
            return (
              <button
                key={city}
                onClick={() => toggle(city)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                }`}>
                  {checked && <Check className="w-3 h-3 text-white" />}
                </span>
                {city}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const perms = usePermissions()
  const [tab, setTab] = useState<Tab>('users')
  const [period, setPeriod] = useState<Period>(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set())

  const allTabs: { key: Tab; label: string }[] = [
    { key: 'users', label: 'Пользователи' },
    { key: 'apps', label: 'Приложения' },
    { key: 'computers', label: 'Компьютеры' },
    { key: 'departments', label: 'Отделы' },
  ]

  const tabs = allTabs.filter(t => perms.report_types[t.key as keyof typeof perms.report_types] !== false)

  const togglePeriod = (p: Exclude<Period, null>) => setPeriod(prev => prev === p ? null : p)
  const toggleStatus = (s: StatusFilter) => {
    setStatusFilters(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }
  const resetFilters = () => { setPeriod(null); setCustomFrom(''); setCustomTo(''); setStatusFilters(new Set()) }

  const { from: dateFrom, to: dateTo } = getPeriodDates(period, customFrom, customTo)
  const hasFilters = period !== null || statusFilters.size > 0
  const filterProps: FilterProps = { dateFrom, dateTo, statusFilters }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Отчёты</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
        {/* Period */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-500">Период</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {PERIOD_OPTIONS.map(p => (
              <button
                key={p.id}
                onClick={() => togglePeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  period === p.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button onClick={resetFilters} className="ml-auto shrink-0 text-xs text-gray-400 hover:text-gray-600 underline">
              Сбросить
            </button>
          )}
        </div>

        {/* Custom date range — separate row to avoid reflow */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 pl-1">
            <input
              type="date" value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date" value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-500 shrink-0">Статус</span>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => toggleStatus(s.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  statusFilters.has(s.id) ? s.active : s.inactive
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'users' && <UsersReport {...filterProps} />}
      {tab === 'apps' && <AppsReport {...filterProps} />}
      {tab === 'computers' && <ComputersReport {...filterProps} />}
      {tab === 'departments' && <DepartmentsReport {...filterProps} />}
    </div>
  )
}

// ─── User detail panel ───────────────────────────────────────────────────────

type PanelPeriod = 'yesterday' | 'week' | 'month'

const PANEL_PERIODS: { id: PanelPeriod; label: string }[] = [
  { id: 'yesterday', label: 'За вчера' },
  { id: 'week',      label: 'За неделю' },
  { id: 'month',     label: 'За месяц' },
]

function UserDetailPanel({ user, onClose }: { user: UserData; onClose: () => void }) {
  const [panelPeriod, setPanelPeriod] = useState<PanelPeriod>('yesterday')
  const fio = userFio(user)

  const { from: dateFrom, to: dateTo } = getPeriodDates(panelPeriod, '', '')
  const periodApps = filterApps(user.apps, dateFrom, dateTo, new Set())

  const totalLaunches = periodApps.reduce((s, a) => s + a.launch_count, 0)
  const blockedApps  = periodApps.filter(a => a.status === 'blocked')
  const allowedApps  = periodApps.filter(a => a.status === 'allowed')
  const neutralApps  = periodApps.filter(a => a.status === 'neutral')

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative ml-auto w-[440px] bg-white shadow-2xl flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg shrink-0">
              {(fio ?? user.username)[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900 leading-tight">{fio ?? user.username}</p>
              {fio && <p className="text-xs text-gray-400">{user.username}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/70 text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period switcher */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
          {PANEL_PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPanelPeriod(p.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                panelPeriod === p.id
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* User info */}
          <div className="space-y-2">
            {fio && (
              <div className="flex gap-2 text-sm">
                <span className="text-gray-400 w-24 shrink-0">ФИО</span>
                <span className="text-gray-900 font-medium">{fio}</span>
              </div>
            )}
            <div className="flex gap-2 text-sm">
              <span className="text-gray-400 w-24 shrink-0">Пользователь</span>
              <span className="text-gray-700 font-mono">{user.username}</span>
            </div>
            {user.department && user.department !== 'Не указан' && (
              <div className="flex gap-2 text-sm">
                <span className="text-gray-400 w-24 shrink-0">Отдел</span>
                <span className="text-gray-700">{user.department}</span>
              </div>
            )}
            {user.city && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 w-24 shrink-0">Город</span>
                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-700">{user.city}</span>
              </div>
            )}
            {user.computers && user.computers !== 'Не указан' && (
              <div className="flex gap-2 text-sm">
                <span className="text-gray-400 w-24 shrink-0">Компьютеры</span>
                <div className="flex flex-wrap gap-1">
                  {user.computers.split(', ').map(c => (
                    <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                      <Monitor className="w-3 h-3" />{c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stats for period */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Запусков',    value: totalLaunches,      cls: 'text-gray-900' },
              { label: 'Разрешено',   value: allowedApps.length, cls: 'text-emerald-600' },
              { label: 'Заблок.',     value: blockedApps.length, cls: 'text-red-600' },
              { label: 'Нейтрально',  value: neutralApps.length, cls: 'text-gray-500' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* No apps message */}
          {periodApps.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              Нет активности за выбранный период
            </p>
          )}

          {/* Blocked apps */}
          {blockedApps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                Запрещённые
                <span className="ml-auto text-xs font-normal text-gray-400">{blockedApps.length}</span>
              </h3>
              <div className="space-y-1">
                {blockedApps.map(app => (
                  <div key={app.name} className="flex items-center justify-between px-3 py-2 bg-red-50 rounded-lg">
                    <span className="text-sm text-gray-800 truncate">{app.name}</span>
                    <span className="text-xs text-red-500 shrink-0 ml-2">{app.launch_count} зап.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All other apps */}
          {(allowedApps.length > 0 || neutralApps.length > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Все приложения за период
                <span className="ml-2 text-xs font-normal text-gray-400">{allowedApps.length + neutralApps.length}</span>
              </h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {[...allowedApps, ...neutralApps].map(app => (
                  <div key={app.name} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-800 truncate">{app.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-gray-400">{app.launch_count} зап.</span>
                      <Badge status={app.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Users report ─────────────────────────────────────────────────────────────

function UsersReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [cityFilter, setCityFilter] = useState<Set<string>>(new Set())
  const [hasTelegramOnly, setHasTelegramOnly] = useState(false)
  const [copiedTg, setCopiedTg] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const { data = [], isLoading } = useQuery({ queryKey: ['reports/users'], queryFn: api.getUsersReport })

  // Sentinel-значение для чипа «без отдела»
  const NO_DEPT = 'Без отдела'
  const isNoDept = (dept: string | null | undefined) =>
    !dept || dept === 'Не указан'

  const departments = useMemo(() => {
    const named = new Set<string>()
    let hasNoDept = false
    for (const u of data) {
      if (isNoDept(u.department)) hasNoDept = true
      else named.add(u.department!)
    }
    const result = Array.from(named).sort()
    if (hasNoDept) result.push(NO_DEPT)
    return result
  }, [data])

  const cities = useMemo(() => {
    const set = new Set(data.map(u => u.city ?? '').filter(Boolean))
    return Array.from(set).sort()
  }, [data])

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const copyTelegram = (tg: string, e: { stopPropagation(): void }) => {
    e.stopPropagation()
    navigator.clipboard.writeText(tg)
    setCopiedTg(tg)
    setTimeout(() => setCopiedTg(null), 2000)
  }

  const q = search.trim().toLowerCase()

  // 1. Filter by search (text only — username and FIO)
  const searchFiltered = q
    ? data.filter(u => {
        const fio = userFio(u) ?? ''
        return (
          u.username.toLowerCase().includes(q) ||
          fio.toLowerCase().includes(q) ||
          (u.department ?? '').toLowerCase().includes(q)
        )
      })
    : data

  // 2. Filter by department chip
  const deptFiltered = deptFilter
    ? searchFiltered.filter(u =>
        deptFilter === NO_DEPT ? isNoDept(u.department) : u.department === deptFilter
      )
    : searchFiltered

  // 3. Filter by city and telegram
  const cityTgFiltered = deptFiltered.filter(u => {
    if (cityFilter.size > 0 && !cityFilter.has(u.city ?? '')) return false
    if (hasTelegramOnly && !u.telegram) return false
    return true
  })

  // 3. Compute per-user filtered stats
  const baseRows = cityTgFiltered.map(u => {
    const fApps = filterApps(u.apps, dateFrom, dateTo, statusFilters)
    return {
      user: u,
      launches: fApps.reduce((s, a) => s + a.launch_count, 0),
      allowed: fApps.filter(a => a.status === 'allowed').length,
      blocked: fApps.filter(a => a.status === 'blocked').length,
      neutral: fApps.filter(a => a.status === 'neutral').length,
    }
  })

  // 4. Sort
  const rows = sortKey
    ? [...baseRows].sort((a, b) => {
        let av: string | number
        let bv: string | number
        if (sortKey === 'username') {
          av = a.user.username; bv = b.user.username
        } else if (sortKey === 'department') {
          av = a.user.department ?? ''; bv = b.user.department ?? ''
        } else if (sortKey === 'city') {
          av = a.user.city ?? ''; bv = b.user.city ?? ''
        } else if (sortKey === 'total_launches') {
          av = a.launches; bv = b.launches
        } else if (sortKey === 'allowed_count') {
          av = a.allowed; bv = b.allowed
        } else if (sortKey === 'blocked_count') {
          av = a.blocked; bv = b.blocked
        } else {
          av = a.neutral; bv = b.neutral
        }
        const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : baseRows

  const handleExport = () => {
    const headers = ['Пользователь', 'ФИО', 'Отдел', 'Город', 'Telegram', 'Запусков', 'Разрешено', 'Заблокировано', 'Нейтрально']
    const csvRows = rows.map(r => [
      r.user.username, userFio(r.user) ?? '', r.user.department ?? '—',
      r.user.city ?? '—', r.user.telegram ?? '—',
      r.launches, r.allowed, r.blocked, r.neutral,
    ])
    exportCsv(headers, csvRows, 'report_users.csv')
  }

  const hasLocalFilters = cityFilter.size > 0 || hasTelegramOnly || deptFilter !== null
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize)

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>

  const numCls = 'px-4 py-3 text-right font-medium text-gray-600 cursor-pointer whitespace-nowrap'
  const txtCls = 'px-4 py-3 text-left font-medium text-gray-600 cursor-pointer whitespace-nowrap'

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

        {/* Строка 1: поиск + чипы отделов + счётчик + CSV */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-wrap">
          <div className="relative flex-none w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {departments.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setDeptFilter(deptFilter === dept ? null : dept)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    deptFilter === dept ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span className="text-sm text-gray-400">
              {rows.length !== data.length ? `${rows.length} из ${data.length}` : `${data.length} записей`}
            </span>
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>

        {/* Строка 2: фильтр по городу + telegram */}
        <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
          {cities.length > 0 && (
            <CityMultiSelect cities={cities} selected={cityFilter} onChange={setCityFilter} />
          )}
          <button
            onClick={() => setHasTelegramOnly(!hasTelegramOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              hasTelegramOnly
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            Только с Telegram
          </button>
          {hasLocalFilters && (
            <button
              onClick={() => { setCityFilter(new Set()); setHasTelegramOnly(false); setDeptFilter(null) }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Сбросить
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className={txtCls} onClick={() => handleSort('username')}>
                  Пользователь <SortIcon field="username" current={sortKey} dir={sortDir} />
                </th>
                <th className={txtCls} onClick={() => handleSort('department')}>
                  Отдел <SortIcon field="department" current={sortKey} dir={sortDir} />
                </th>
                <th className={txtCls} onClick={() => handleSort('city')}>
                  Город <SortIcon field="city" current={sortKey} dir={sortDir} />
                </th>
                <th className={txtCls}>Telegram</th>
                <th className={numCls} onClick={() => handleSort('total_launches')}>
                  Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('allowed_count')}>
                  Разреш. <SortIcon field="allowed_count" current={sortKey} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('blocked_count')}>
                  Заблок. <SortIcon field="blocked_count" current={sortKey} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('neutral_count')}>
                  Нейтр. <SortIcon field="neutral_count" current={sortKey} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagedRows.map(({ user: u, launches, allowed, blocked, neutral }) => {
                const fio = userFio(u)
                const isSelected = selectedUser?.username === u.username
                return (
                  <tr
                    key={u.username}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    onClick={() => setSelectedUser(isSelected ? null : u)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{fio ?? u.username}</span>
                      {fio && <span className="block text-xs text-gray-400">{u.username}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.department ?? '—'}</td>
                    <td className="px-4 py-3">
                      {u.city
                        ? <span className="flex items-center gap-1 text-gray-600 whitespace-nowrap"><MapPin className="w-3 h-3 text-gray-400 shrink-0" />{u.city}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.telegram ? (
                        <button
                          onClick={e => copyTelegram(u.telegram!, e)}
                          title="Копировать в буфер"
                          className={`flex items-center gap-1.5 text-xs font-mono rounded px-2 py-0.5 transition-colors whitespace-nowrap ${
                            copiedTg === u.telegram
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {copiedTg === u.telegram
                            ? <Check className="w-3 h-3 shrink-0" />
                            : <Copy className="w-3 h-3 shrink-0" />}
                          {u.telegram}
                        </button>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{launches}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 font-medium">{allowed}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-medium">{blocked}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{neutral}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={rows.length}
          onPage={setPage}
          onPageSize={s => { setPageSize(s); setPage(1) }}
        />
      </div>

      {selectedUser && (
        <UserDetailPanel user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </>
  )
}

// ─── Apps report ──────────────────────────────────────────────────────────────

function AppsReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selectedApp, setSelectedApp] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data = [], isLoading } = useQuery({ queryKey: ['reports/apps'], queryFn: api.getAppsReport })
  const { sorted, sortKey, sortDir, handleSort } = useSortedData<AppReport>(data)

  const filtered = sorted.filter(a => {
    if (statusFilters.size > 0 && !statusFilters.has(a.global_status)) return false
    if (!matchesPeriod(a.last_seen, dateFrom, dateTo)) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedApps = filtered.slice((page - 1) * pageSize, page * pageSize)

  const handleExport = () => {
    const headers = ['Приложение', 'Статус', 'Запусков', 'Пользователей', 'Компьютеров', 'Разреш.', 'Заблок.']
    const rows = filtered.map(a => [a.name, a.global_status, a.total_launches, a.users_count, a.computers_count, a.status_counts.allowed, a.status_counts.blocked])
    exportCsv(headers, rows, 'report_apps.csv')
  }

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">
            {filtered.length !== data.length ? `${filtered.length} из ${data.length} приложений` : `${data.length} приложений`}
          </span>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="min-w-[200px]" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-24" />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => handleSort('name')}>
                  Приложение <SortIcon field="name" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => handleSort('global_status')}>
                  Статус <SortIcon field="global_status" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => handleSort('total_launches')}>
                  Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => handleSort('users_count')}>
                  Польз. <SortIcon field="users_count" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => handleSort('computers_count')}>
                  Компьют. <SortIcon field="computers_count" current={sortKey} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                    Нет приложений за выбранный период
                  </td>
                </tr>
              ) : pagedApps.map(a => (
                <tr
                  key={a.name}
                  className={`cursor-pointer transition-colors ${selectedApp === a.name ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                  onClick={() => setSelectedApp(a.name === selectedApp ? null : a.name)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 truncate" title={a.name}>{a.name}</td>
                  <td className="px-4 py-3"><Badge status={a.global_status} /></td>
                  <td className="px-4 py-3 text-right text-gray-700">{a.total_launches}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{a.users_count}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{a.computers_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
          onPageSize={s => { setPageSize(s); setPage(1) }}
        />
      </div>

      {selectedApp && (
        <AppUsersPanel appName={selectedApp} onClose={() => setSelectedApp(null)} />
      )}
    </>
  )
}

// ─── Computer detail panel ───────────────────────────────────────────────────

function computerFio(u: ComputerUserEntry): string | null {
  const parts = [u.last_name, u.first_name, u.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function ComputerDetailPanel({ computerName, onClose }: { computerName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['computer-users', computerName],
    queryFn: () => api.getComputerUsers(computerName),
  })
  const users: ComputerUserEntry[] = data?.users ?? []
  const ip = data?.ip_address

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative ml-auto w-[400px] bg-white shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 leading-tight font-mono">{computerName}</p>
              {!isLoading && (
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Wifi className="w-3 h-3" />{ip || 'IP не определён'}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/70 text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
          {!isLoading && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                Пользователи
                <span className="ml-auto text-xs font-normal text-gray-400">{users.length}</span>
              </h3>
              {users.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Нет данных о пользователях</p>
              ) : (
                <div className="space-y-2">
                  {users.map((u, i) => {
                    const fio = computerFio(u)
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-sm font-bold shrink-0">
                          {(fio ?? u.username)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{fio ?? u.username}</p>
                          <p className="text-xs text-gray-400 truncate">{fio ? u.username : (u.department ?? '—')}</p>
                        </div>
                        {fio && u.department && (
                          <span className="ml-auto text-xs text-gray-400 shrink-0">{u.department}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Computers report ─────────────────────────────────────────────────────────

function ComputersReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selectedComputer, setSelectedComputer] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data = [], isLoading } = useQuery({ queryKey: ['reports/computers'], queryFn: api.getComputersReport })
  const { sorted, sortKey, sortDir, handleSort } = useSortedData<ComputerReport>(data)

  const filtered = sorted.filter(c => {
    if (!matchesPeriod(c.last_seen, dateFrom, dateTo)) return false
    if (statusFilters.size > 0) {
      const hasMatch = Array.from(statusFilters).some(s => (c.status_counts[s] ?? 0) > 0)
      if (!hasMatch) return false
    }
    return true
  })

  const handleExport = () => {
    const headers = ['Компьютер', 'IP', 'Пользователей', 'Запусков', 'Приложений', 'Разреш.', 'Заблок.']
    const rows = filtered.map(c => [c.name, c.ip_address ?? '', c.users_count, c.total_launches, c.apps_count, c.status_counts.allowed, c.status_counts.blocked])
    exportCsv(headers, rows, 'report_computers.csv')
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedComputers = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>

  const txtCls = 'px-4 py-3 text-left font-medium text-gray-600 cursor-pointer whitespace-nowrap'
  const numCls = 'px-4 py-3 text-right font-medium text-gray-600 cursor-pointer whitespace-nowrap'

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">
            {filtered.length !== data.length ? `${filtered.length} из ${data.length} компьютеров` : `${data.length} компьютеров`}
          </span>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className={txtCls} onClick={() => handleSort('name')}>Компьютер <SortIcon field="name" current={sortKey} dir={sortDir} /></th>
                <th className={txtCls} onClick={() => handleSort('ip_address')}>IP-адрес <SortIcon field="ip_address" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('users_count')}>Польз. <SortIcon field="users_count" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('total_launches')}>Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('apps_count')}>Прил. <SortIcon field="apps_count" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('blocked_count')}>Заблок. <SortIcon field="blocked_count" current={sortKey} dir={sortDir} /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagedComputers.map(c => {
                const isSelected = selectedComputer === c.name
                return (
                  <tr
                    key={c.name}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    onClick={() => setSelectedComputer(isSelected ? null : c.name)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 font-mono">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.ip_address || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.users_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.total_launches}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.apps_count}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-medium">{c.status_counts.blocked}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
          onPageSize={s => { setPageSize(s); setPage(1) }}
        />
      </div>

      {selectedComputer && (
        <ComputerDetailPanel computerName={selectedComputer} onClose={() => setSelectedComputer(null)} />
      )}
    </>
  )
}

// ─── Departments report ───────────────────────────────────────────────────────

function DepartmentsReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null)
  const [cityFilter, setCityFilter] = useState<Set<string>>(new Set())
  const [hasTelegramOnly, setHasTelegramOnly] = useState(false)
  const [copiedTg, setCopiedTg] = useState<string | null>(null)

  const { data: depts = [], isLoading: loadingDepts } = useQuery({
    queryKey: ['reports/departments'],
    queryFn: api.getDepartmentsReport,
  })
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['reports/users'],
    queryFn: api.getUsersReport,
  })

  const isLoading = loadingDepts || loadingUsers
  const hasFilters = dateFrom !== null || dateTo !== null || statusFilters.size > 0

  const deptNames = useMemo(() => depts.map(d => d.name).sort(), [depts])
  const cities = useMemo(() => {
    const set = new Set(users.map(u => u.city ?? '').filter(Boolean))
    return Array.from(set).sort()
  }, [users])

  // Сбрасываем выбранные отделы, которых уже нет в данных (после изменения данных)
  useEffect(() => {
    if (selected.size === 0) return
    const validNames = new Set(depts.map(d => d.name))
    const hasStale = [...selected].some(s => !validNames.has(s))
    if (hasStale) {
      setSelected(prev => new Set([...prev].filter(s => validNames.has(s))))
    }
  }, [depts])

  const activeDepts = useMemo(
    () => (selected.size === 0 ? depts : depts.filter(d => selected.has(d.name))),
    [depts, selected],
  )

  const usersByDept = useMemo(() => {
    const map: Record<string, UserData[]> = {}
    for (const u of users) {
      // || вместо ?? — обрабатывает и null, и пустую строку как 'Не указан'
      const key = u.department || 'Не указан'
      if (!map[key]) map[key] = []
      map[key].push(u)
    }
    return map
  }, [users])

  // Per-department filtered stats (computed when filters are active)
  const filteredDeptStats = useMemo(() => {
    if (!hasFilters) return null
    const result: Record<string, { usersCount: number; launches: number; appsCount: number }> = {}
    for (const dept of depts) {
      const deptUsers = usersByDept[dept.name] ?? []
      let usersCount = 0, launches = 0
      const apps = new Set<string>()
      for (const u of deptUsers) {
        const fApps = filterApps(u.apps, dateFrom, dateTo, statusFilters)
        if (fApps.length > 0) usersCount++
        for (const a of fApps) {
          launches += a.launch_count
          apps.add(a.name.toLowerCase())
        }
      }
      result[dept.name] = { usersCount, launches, appsCount: apps.size }
    }
    return result
  }, [hasFilters, depts, usersByDept, dateFrom, dateTo, statusFilters])

  const toggleDept = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const copyTelegram = (tg: string, e: { stopPropagation(): void }) => {
    e.stopPropagation()
    navigator.clipboard.writeText(tg)
    setCopiedTg(tg)
    setTimeout(() => setCopiedTg(null), 2000)
  }

  // Filter users by city/telegram within each department
  const filterDeptUsers = (deptUsers: UserData[]) =>
    deptUsers.filter(u => {
      if (cityFilter.size > 0 && !cityFilter.has(u.city ?? '')) return false
      if (hasTelegramOnly && !u.telegram) return false
      return true
    })

  const hasLocalFilters = cityFilter.size > 0 || hasTelegramOnly

  const handleExport = () => {
    const headers = ['Отдел', 'ФИО', 'Пользователь', 'Город', 'Telegram', 'Запусков', 'Разреш.', 'Заблок.', 'Нейтр.']
    const rows: (string | number)[][] = []
    for (const dept of activeDepts) {
      for (const u of filterDeptUsers(usersByDept[dept.name] ?? [])) {
        const fApps = filterApps(u.apps, dateFrom, dateTo, statusFilters)
        const launches = fApps.reduce((s, a) => s + a.launch_count, 0)
        const allowed = fApps.filter(a => a.status === 'allowed').length
        const blocked = fApps.filter(a => a.status === 'blocked').length
        const neutral = fApps.filter(a => a.status === 'neutral').length
        rows.push([dept.name, userFio(u) ?? '', u.username, u.city ?? '—', u.telegram ?? '—', launches, allowed, blocked, neutral])
      }
    }
    exportCsv(headers, rows, 'report_departments.csv')
  }

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>

  return (
    <div className="space-y-4">
      {/* Строка 1: чипы отделов + CSV */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500 shrink-0">Отделы:</span>
          <button
            onClick={() => setSelected(new Set())}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selected.size === 0 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Все
          </button>
          {deptNames.map(name => (
            <button
              key={name}
              onClick={() => toggleDept(name)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selected.has(name) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {name}
            </button>
          ))}
          <div className="ml-auto shrink-0">
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>

        {/* Строка 2: фильтр по городу + telegram */}
        {(cities.length > 0) && (
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-gray-100">
            <CityMultiSelect cities={cities} selected={cityFilter} onChange={setCityFilter} />
            <button
              onClick={() => setHasTelegramOnly(!hasTelegramOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                hasTelegramOnly
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              Только с Telegram
            </button>
            {hasLocalFilters && (
              <button
                onClick={() => { setCityFilter(new Set()); setHasTelegramOnly(false) }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Сбросить
              </button>
            )}
          </div>
        )}
      </div>

      {activeDepts.length === 0 && <p className="text-center text-gray-400 py-10">Нет данных</p>}

      {activeDepts.map(dept => {
        const allDeptUsers = usersByDept[dept.name] ?? []
        const deptUsers = filterDeptUsers(allDeptUsers)
        const isOpen = expanded.has(dept.name)
        const fs = filteredDeptStats?.[dept.name]
        const displayUsers = fs?.usersCount ?? dept.users_count
        const displayLaunches = fs?.launches ?? dept.total_launches
        const displayApps = fs?.appsCount ?? dept.apps_count
        const avgLaunches = displayUsers > 0 ? Math.round(displayLaunches / displayUsers) : 0

        return (
          <div key={dept.name} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              onClick={() => toggleExpand(dept.name)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
            >
              <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              <span className="font-semibold text-gray-900 flex-1">{dept.name}</span>
              <div className="flex items-center gap-5 text-sm">
                <span className="text-gray-500">
                  <span className="font-medium text-gray-900">{displayUsers}</span> польз.
                </span>
                <span className="text-gray-500">
                  <span className="font-medium text-gray-900">{displayLaunches.toLocaleString()}</span> зап.
                </span>
                <span className="text-gray-500">
                  <span className="font-medium text-gray-900">{displayApps}</span> прил.
                </span>
                <span className="hidden sm:block text-gray-400 text-xs">~{avgLaunches} зап./польз.</span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 overflow-x-auto">
                {deptUsers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">
                    {hasLocalFilters ? 'Нет пользователей по выбранным фильтрам' : 'Нет пользователей'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Пользователь</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Город</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Telegram</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Запусков</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-emerald-600">Разреш.</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-red-500">Заблок.</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400">Нейтр.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {deptUsers
                        .slice()
                        .sort((a, b) => (userFio(a) ?? a.username).localeCompare(userFio(b) ?? b.username))
                        .map(u => {
                          const fio = userFio(u)
                          const fApps = filterApps(u.apps, dateFrom, dateTo, statusFilters)
                          const launches = fApps.reduce((s, a) => s + a.launch_count, 0)
                          const allowed = fApps.filter(a => a.status === 'allowed').length
                          const blocked = fApps.filter(a => a.status === 'blocked').length
                          const neutral = fApps.filter(a => a.status === 'neutral').length
                          return (
                            <tr key={u.username} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedUser(u)}>
                              <td className="px-5 py-2.5">
                                <span className="font-medium text-gray-900">{fio ?? u.username}</span>
                                {fio && <span className="block text-xs text-gray-400">{u.username}</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {u.city
                                  ? <span className="flex items-center gap-1 text-gray-600 whitespace-nowrap text-xs"><MapPin className="w-3 h-3 text-gray-400 shrink-0" />{u.city}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {u.telegram ? (
                                  <button
                                    onClick={e => copyTelegram(u.telegram!, e)}
                                    title="Копировать в буфер"
                                    className={`flex items-center gap-1.5 text-xs font-mono rounded px-2 py-0.5 transition-colors whitespace-nowrap ${
                                      copiedTg === u.telegram
                                        ? 'bg-emerald-50 text-emerald-600'
                                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                                    }`}
                                  >
                                    {copiedTg === u.telegram
                                      ? <Check className="w-3 h-3 shrink-0" />
                                      : <Copy className="w-3 h-3 shrink-0" />}
                                    {u.telegram}
                                  </button>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-700">{launches}</td>
                              <td className="px-4 py-2.5 text-right text-emerald-600 font-medium">{allowed}</td>
                              <td className="px-4 py-2.5 text-right text-red-600 font-medium">{blocked}</td>
                              <td className="px-4 py-2.5 text-right text-gray-400">{neutral}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}

      {selectedUser && (
        <UserDetailPanel user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  )
}
