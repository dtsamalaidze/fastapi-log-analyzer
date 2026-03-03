import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Users, FileText, Monitor, Layers, Search, Calendar } from 'lucide-react'
import { api } from '../services/api'
import type { UserData, AppEntry, SortDir } from '../types'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import Pagination from '../components/ui/Pagination'

type SortKey = 'username' | 'total_apps' | 'total_launches' | 'allowed_count' | 'blocked_count'
type Period = 'yesterday' | 'week' | 'month' | 'custom' | null
type StatusFilter = 'allowed' | 'neutral' | 'blocked'

function StatCard({ icon: Icon, label, value, colorCls }: { icon: React.ElementType; label: string; value: number; colorCls: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${colorCls}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function SortIcon({ field, current, dir }: { field: string; current: string; dir: SortDir }) {
  if (field !== current) return <span className="text-gray-300 ml-1">↕</span>
  return <span className="text-indigo-600 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
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
    const from = new Date(today)
    from.setDate(from.getDate() - 1)
    const to = new Date(from)
    to.setHours(23, 59, 59, 999)
    return { from, to }
  }

  if (period === 'week') {
    const from = new Date(today)
    from.setDate(from.getDate() - 7)
    return { from, to: new Date() }
  }

  if (period === 'month') {
    const from = new Date(today)
    from.setMonth(from.getMonth() - 1)
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

function displayName(user: UserData): string {
  const parts = [user.last_name, user.first_name, user.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.username
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
      const appDate = new Date(dateStr)
      if (!isNaN(appDate.getTime())) {
        if (dateFrom !== null && appDate < dateFrom) return false
        if (dateTo !== null && appDate > dateTo) return false
      }
    }
    return true
  })
}


const PERIOD_OPTIONS: { id: Exclude<Period, null>; label: string }[] = [
  { id: 'yesterday', label: 'За вчера' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'custom', label: 'Свой период' },
]

const STATUS_OPTIONS: { id: StatusFilter; label: string; active: string; inactive: string }[] = [
  {
    id: 'allowed',
    label: 'Разрешённые',
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive: 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-500',
  },
  {
    id: 'neutral',
    label: 'Нейтральные',
    active: 'bg-gray-500 text-white border-gray-500',
    inactive: 'bg-white text-gray-600 border-gray-300 hover:border-gray-500',
  },
  {
    id: 'blocked',
    label: 'Запрещённые',
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-white text-red-700 border-red-300 hover:border-red-500',
  },
]

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total_launches')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<Period>(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  })

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
  })

  const toggleExpand = (username: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(username) ? next.delete(username) : next.add(username)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const togglePeriod = (p: Exclude<Period, null>) => {
    setPeriod(prev => (prev === p ? null : p))
    setPage(1)
  }

  const toggleStatus = (s: StatusFilter) => {
    setStatusFilters(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
    setPage(1)
  }

  const { from: dateFrom, to: dateTo } = getPeriodDates(period, customFrom, customTo)

  // Сначала вычисляем отфильтрованные показатели для каждого пользователя,
  // затем сортируем по тем же значениям, что отображаются в строках
  const processedUsers = users
    .filter(u => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        u.username.toLowerCase().includes(q) ||
        displayName(u).toLowerCase().includes(q) ||
        (u.department ?? '').toLowerCase().includes(q)
      )
    })
    .map(u => {
      const filteredApps = filterApps(u.apps, dateFrom, dateTo, statusFilters)
      return {
        user: u,
        filteredApps,
        total_apps: filteredApps.length,
        total_launches: filteredApps.reduce((s, a) => s + a.launch_count, 0),
        allowed_count: filteredApps.filter(a => a.status === 'allowed').length,
        blocked_count: filteredApps.filter(a => a.status === 'blocked').length,
      }
    })
    .sort((a, b) => {
      let av: string | number
      let bv: string | number
      if (sortKey === 'username') {
        av = a.user.username
        bv = b.user.username
      } else if (sortKey === 'total_apps') {
        av = a.total_apps
        bv = b.total_apps
      } else if (sortKey === 'total_launches') {
        av = a.total_launches
        bv = b.total_launches
      } else if (sortKey === 'allowed_count') {
        av = a.allowed_count
        bv = b.allowed_count
      } else {
        av = a.blocked_count
        bv = b.blocked_count
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })

  const pagedUsers = processedUsers.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.max(1, Math.ceil(processedUsers.length / pageSize))

  const hasFilters = period !== null || statusFilters.size > 0 || search.length > 0
  const filteredStats = hasFilters ? {
    total_users: processedUsers.filter(p => p.filteredApps.length > 0).length,
    total_launches: processedUsers.reduce((s, p) => s + p.total_launches, 0),
    total_unique_apps: new Set(processedUsers.flatMap(p => p.filteredApps.map(a => a.name.toLowerCase()))).size,
    total_computers: new Set(
      processedUsers
        .filter(p => p.filteredApps.length > 0)
        .flatMap(p => (p.user.computers || '').split(',').map(c => c.trim().toLowerCase()).filter(c => c && c !== 'не указан'))
    ).size,
    total_log_files: processedUsers
      .filter(p => p.filteredApps.length > 0)
      .reduce((s, p) => s + (p.user.log_files_count ?? 0), 0),
  } : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Пользователи</h1>
        <p className="text-gray-500 text-sm mt-1">Анализ активности и статусов приложений</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Пользователей" value={filteredStats?.total_users ?? stats?.total_users ?? users.length} colorCls="bg-indigo-500" />
        <StatCard icon={FileText} label="Лог-файлов" value={filteredStats?.total_log_files ?? stats?.total_log_files ?? 0} colorCls="bg-purple-500" />
        <StatCard icon={Layers} label="Уникальных приложений" value={filteredStats?.total_unique_apps ?? stats?.total_unique_apps ?? 0} colorCls="bg-blue-500" />
        <StatCard icon={Monitor} label="Компьютеров" value={filteredStats?.total_computers ?? stats?.total_computers ?? 0} colorCls="bg-teal-500" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
        {/* Period */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 mt-0.5">
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
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-gray-400 text-sm">—</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-gray-500">Статус</span>
          </div>
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
          {hasFilters && (
            <button
              onClick={() => { setPeriod(null); setCustomFrom(''); setCustomTo(''); setStatusFilters(new Set()) }}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Поиск по пользователю или отделу..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="w-8 px-4 py-3" />
              <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer" onClick={() => handleSort('username')}>
                Пользователь <SortIcon field="username" current={sortKey} dir={sortDir} />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 hidden md:table-cell">Отдел</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer" onClick={() => handleSort('total_apps')}>
                Прил. <SortIcon field="total_apps" current={sortKey} dir={sortDir} />
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer" onClick={() => handleSort('total_launches')}>
                Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} />
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hidden lg:table-cell" onClick={() => handleSort('allowed_count')}>
                Разреш. <SortIcon field="allowed_count" current={sortKey} dir={sortDir} />
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer hidden lg:table-cell" onClick={() => handleSort('blocked_count')}>
                Заблок. <SortIcon field="blocked_count" current={sortKey} dir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pagedUsers.map(({ user, filteredApps }) => (
              <UserRow
                key={user.username}
                user={user}
                expanded={expanded.has(user.username)}
                onToggle={() => toggleExpand(user.username)}
                filteredApps={filteredApps}
              />
            ))}
            {processedUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  Пользователи не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={processedUsers.length}
          onPage={p => { setPage(p); setExpanded(new Set()) }}
          onPageSize={s => { setPageSize(s); setPage(1) }}
        />
      </div>
    </div>
  )
}

function UserRow({
  user,
  expanded,
  onToggle,
  filteredApps,
}: {
  user: UserData
  expanded: boolean
  onToggle: () => void
  filteredApps: AppEntry[]
}) {
  const displayTotalApps = filteredApps.length
  const displayLaunches = filteredApps.reduce((s, a) => s + a.launch_count, 0)
  const displayAllowed = filteredApps.filter(a => a.status === 'allowed').length
  const displayBlocked = filteredApps.filter(a => a.status === 'blocked').length

  const isFiltered = filteredApps.length !== user.apps.length

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-gray-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-4 py-3">
          <span className="font-medium text-gray-900">{displayName(user)}</span>
          {(user.last_name || user.first_name) && (
            <span className="block text-xs text-gray-400">{user.username}</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{user.department ?? '—'}</td>
        <td className="px-4 py-3 text-right text-gray-700">{displayTotalApps}</td>
        <td className="px-4 py-3 text-right text-gray-700">{displayLaunches}</td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <span className="text-emerald-600 font-medium">{displayAllowed}</span>
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <span className="text-red-600 font-medium">{displayBlocked}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-indigo-50/30">
          <td colSpan={7} className="px-8 py-4">
            <div className="text-xs text-gray-500 mb-3 flex items-center gap-3 flex-wrap">
              {(user.last_name || user.first_name) && (
                <>
                  <span>Логин: {user.username}</span>
                  <span>·</span>
                </>
              )}
              <span>Компьютеры: {user.computers || '—'}</span>
              <span>·</span>
              <span>Дата логов: {user.log_date || '—'}</span>
              {isFiltered && (
                <>
                  <span>·</span>
                  <span className="text-indigo-600 font-medium">
                    Показано {filteredApps.length} из {user.apps.length}
                  </span>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredApps.map(app => (
                <div key={app.name} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
                  <span className="text-sm text-gray-800 truncate">{app.name}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400">{app.launch_count}×</span>
                    <Badge status={app.status} />
                  </div>
                </div>
              ))}
              {filteredApps.length === 0 && (
                <p className="text-sm text-gray-400 col-span-full">Нет приложений по заданным фильтрам</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
