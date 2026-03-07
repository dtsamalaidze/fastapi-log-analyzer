import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, X, MapPin, XCircle, Monitor, Search, Copy, Check } from 'lucide-react'
import { api } from '../services/api'
import type { UserData, SortDir } from '../types'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import SortIcon from '../components/ui/SortIcon'
import Pagination from '../components/ui/Pagination'
import CityMultiSelect from '../components/ui/CityMultiSelect'
import { getPeriodDates } from '../utils/dates'
import { filterApps, userFio, exportCsv, type FilterProps } from './reportUtils'

// ─── User detail panel ───────────────────────────────────────────────────────

type PanelPeriod = 'yesterday' | 'week' | 'month'

const PANEL_PERIODS: { id: PanelPeriod; label: string }[] = [
  { id: 'yesterday', label: 'За вчера' },
  { id: 'week',      label: 'За неделю' },
  { id: 'month',     label: 'За месяц' },
]

export function UserDetailPanel({ user, onClose }: { user: UserData; onClose: () => void }) {
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
      <div className="relative ml-auto w-[440px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-lg shrink-0">
              {(fio ?? user.username)[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white leading-tight">{fio ?? user.username}</p>
              {fio && <p className="text-xs text-gray-400 dark:text-slate-500">{user.username}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period switcher */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
          {PANEL_PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPanelPeriod(p.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                panelPeriod === p.id
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400'
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
                <span className="text-gray-400 dark:text-slate-500 w-24 shrink-0">ФИО</span>
                <span className="text-gray-900 dark:text-white font-medium">{fio}</span>
              </div>
            )}
            <div className="flex gap-2 text-sm">
              <span className="text-gray-400 dark:text-slate-500 w-24 shrink-0">Пользователь</span>
              <span className="text-gray-700 dark:text-slate-300 font-mono">{user.username}</span>
            </div>
            {user.department && user.department !== 'Не указан' && (
              <div className="flex gap-2 text-sm">
                <span className="text-gray-400 dark:text-slate-500 w-24 shrink-0">Отдел</span>
                <span className="text-gray-700 dark:text-slate-300">{user.department}</span>
              </div>
            )}
            {user.city && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 dark:text-slate-500 w-24 shrink-0">Город</span>
                <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                <span className="text-gray-700 dark:text-slate-300">{user.city}</span>
              </div>
            )}
            {user.computers && user.computers !== 'Не указан' && (
              <div className="flex gap-2 text-sm">
                <span className="text-gray-400 dark:text-slate-500 w-24 shrink-0">Компьютеры</span>
                <div className="flex flex-wrap gap-1">
                  {user.computers.split(', ').map(c => (
                    <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-xs text-gray-600 dark:text-slate-300">
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
              { label: 'Запусков',    value: totalLaunches,      cls: 'text-gray-900 dark:text-white' },
              { label: 'Разрешено',   value: allowedApps.length, cls: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Заблок.',     value: blockedApps.length, cls: 'text-red-600 dark:text-red-400' },
              { label: 'Нейтрально',  value: neutralApps.length, cls: 'text-gray-500 dark:text-slate-400' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 dark:bg-slate-800 rounded-xl p-3 text-center">
                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* No apps message */}
          {periodApps.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-4">
              Нет активности за выбранный период
            </p>
          )}

          {/* Blocked apps */}
          {blockedApps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                Запрещённые
                <span className="ml-auto text-xs font-normal text-gray-400 dark:text-slate-500">{blockedApps.length}</span>
              </h3>
              <div className="space-y-1">
                {blockedApps.map(app => (
                  <div key={app.name} className="flex items-center justify-between px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <span className="text-sm text-gray-800 dark:text-slate-200 truncate">{app.name}</span>
                    <span className="text-xs text-red-500 dark:text-red-400 shrink-0 ml-2">{app.launch_count} зап.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All other apps */}
          {(allowedApps.length > 0 || neutralApps.length > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Все приложения за период
                <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">{allowedApps.length + neutralApps.length}</span>
              </h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {[...allowedApps, ...neutralApps].map(app => (
                  <div key={app.name} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
                    <span className="text-sm text-gray-800 dark:text-slate-200 truncate">{app.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-gray-400 dark:text-slate-500">{app.launch_count} зап.</span>
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

// ─── Users report tab ─────────────────────────────────────────────────────────

export default function UsersReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
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

  const { data = [], isLoading } = useQuery({ queryKey: ['reports/users'], queryFn: api.getUsersReport, staleTime: 60_000 })

  useEffect(() => { setPage(1) }, [search, deptFilter, cityFilter, hasTelegramOnly, dateFrom, dateTo, statusFilters])

  const NO_DEPT = 'Без отдела'
  const isNoDept = (dept: string | null | undefined) => !dept || dept === 'Не указан'

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

  const deptFiltered = deptFilter
    ? searchFiltered.filter(u =>
        deptFilter === NO_DEPT ? isNoDept(u.department) : u.department === deptFilter
      )
    : searchFiltered

  const cityTgFiltered = deptFiltered.filter(u => {
    if (cityFilter.size > 0 && !cityFilter.has(u.city ?? '')) return false
    if (hasTelegramOnly && !u.telegram) return false
    return true
  })

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

  const numCls = 'px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap'
  const txtCls = 'px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap'

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">

        {/* Строка 1: поиск + чипы отделов + счётчик + CSV */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex-wrap">
          <div className="relative flex-none w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="w-full pl-9 pr-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500"
            />
          </div>
          {departments.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setDeptFilter(deptFilter === dept ? null : dept)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    deptFilter === dept
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span className="text-sm text-gray-400 dark:text-slate-500">
              {rows.length !== data.length ? `${rows.length} из ${data.length}` : `${data.length} записей`}
            </span>
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>

        {/* Строка 2: фильтр по городу + telegram */}
        <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50 flex-wrap">
          {cities.length > 0 && (
            <CityMultiSelect cities={cities} selected={cityFilter} onChange={setCityFilter} />
          )}
          <button
            onClick={() => setHasTelegramOnly(!hasTelegramOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              hasTelegramOnly
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400'
            }`}
          >
            Только с Telegram
          </button>
          {hasLocalFilters && (
            <button
              onClick={() => { setCityFilter(new Set()); setHasTelegramOnly(false); setDeptFilter(null) }}
              className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 underline"
            >
              Сбросить
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className={txtCls} onClick={() => handleSort('username')}>
                  Пользователь <SortIcon field="username" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={txtCls} onClick={() => handleSort('department')}>
                  Отдел <SortIcon field="department" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={txtCls} onClick={() => handleSort('city')}>
                  Город <SortIcon field="city" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={txtCls}>Telegram</th>
                <th className={numCls} onClick={() => handleSort('total_launches')}>
                  Запусков <SortIcon field="total_launches" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('allowed_count')}>
                  Разреш. <SortIcon field="allowed_count" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('blocked_count')}>
                  Заблок. <SortIcon field="blocked_count" current={sortKey ?? ''} dir={sortDir} />
                </th>
                <th className={numCls} onClick={() => handleSort('neutral_count')}>
                  Нейтр. <SortIcon field="neutral_count" current={sortKey ?? ''} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
              {pagedRows.map(({ user: u, launches, allowed, blocked, neutral }) => {
                const fio = userFio(u)
                const isSelected = selectedUser?.username === u.username
                return (
                  <tr
                    key={u.username}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
                    onClick={() => setSelectedUser(isSelected ? null : u)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900 dark:text-white">{fio ?? u.username}</span>
                      {fio && <span className="block text-xs text-gray-400 dark:text-slate-500">{u.username}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{u.department ?? '—'}</td>
                    <td className="px-4 py-3">
                      {u.city
                        ? <span className="flex items-center gap-1 text-gray-600 dark:text-slate-300 whitespace-nowrap"><MapPin className="w-3 h-3 text-gray-400 dark:text-slate-500 shrink-0" />{u.city}</span>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.telegram ? (
                        <button
                          onClick={e => copyTelegram(u.telegram!, e)}
                          title="Копировать в буфер"
                          className={`flex items-center gap-1.5 text-xs font-mono rounded px-2 py-0.5 transition-colors whitespace-nowrap ${
                            copiedTg === u.telegram
                              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                              : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                          }`}
                        >
                          {copiedTg === u.telegram ? <Check className="w-3 h-3 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
                          {u.telegram}
                        </button>
                      ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{launches}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">{allowed}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 font-medium">{blocked}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">{neutral}</td>
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
