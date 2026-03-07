import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, MapPin, Copy, Check, ChevronDown } from 'lucide-react'
import { api } from '../services/api'
import type { UserData } from '../types'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import CityMultiSelect from '../components/ui/CityMultiSelect'
import { filterApps, userFio, exportCsv, type FilterProps } from './reportUtils'
import { UserDetailPanel } from './UsersReport'

export default function DepartmentsReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null)
  const [cityFilter, setCityFilter] = useState<Set<string>>(new Set())
  const [hasTelegramOnly, setHasTelegramOnly] = useState(false)
  const [copiedTg, setCopiedTg] = useState<string | null>(null)

  const { data: depts = [], isLoading: loadingDepts } = useQuery({
    queryKey: ['reports/departments'],
    queryFn: api.getDepartmentsReport,
    staleTime: 60_000,
  })
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['reports/users'],
    queryFn: api.getUsersReport,
    staleTime: 60_000,   // shared cache with UsersReport
  })

  const isLoading = loadingDepts || loadingUsers
  const hasFilters = dateFrom !== null || dateTo !== null || statusFilters.size > 0

  const deptNames = useMemo(() => depts.map(d => d.name).sort(), [depts])
  const cities = useMemo(() => {
    const set = new Set(users.map(u => u.city ?? '').filter(Boolean))
    return Array.from(set).sort()
  }, [users])

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
      const key = u.department || 'Не указан'
      if (!map[key]) map[key] = []
      map[key].push(u)
    }
    return map
  }, [users])

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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 px-4 py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-slate-400 shrink-0">Отделы:</span>
          <button
            onClick={() => setSelected(new Set())}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selected.size === 0 ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
            }`}
          >
            Все
          </button>
          {deptNames.map(name => (
            <button
              key={name}
              onClick={() => toggleDept(name)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selected.has(name) ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
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

        {cities.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-gray-100 dark:border-slate-700">
            <CityMultiSelect cities={cities} selected={cityFilter} onChange={setCityFilter} />
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
                onClick={() => { setCityFilter(new Set()); setHasTelegramOnly(false) }}
                className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 underline"
              >
                Сбросить
              </button>
            )}
          </div>
        )}
      </div>

      {activeDepts.length === 0 && <p className="text-center text-gray-400 dark:text-slate-500 py-10">Нет данных</p>}

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
          <div key={dept.name} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
            <button
              onClick={() => toggleExpand(dept.name)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              <span className="font-semibold text-gray-900 dark:text-white flex-1">{dept.name}</span>
              <div className="flex items-center gap-5 text-sm">
                <span className="text-gray-500 dark:text-slate-400">
                  <span className="font-medium text-gray-900 dark:text-white">{displayUsers}</span> польз.
                </span>
                <span className="text-gray-500 dark:text-slate-400">
                  <span className="font-medium text-gray-900 dark:text-white">{displayLaunches.toLocaleString()}</span> зап.
                </span>
                <span className="text-gray-500 dark:text-slate-400">
                  <span className="font-medium text-gray-900 dark:text-white">{displayApps}</span> прил.
                </span>
                <span className="hidden sm:block text-gray-400 dark:text-slate-500 text-xs">~{avgLaunches} зап./польз.</span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 dark:border-slate-700 overflow-x-auto">
                {deptUsers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">
                    {hasLocalFilters ? 'Нет пользователей по выбранным фильтрам' : 'Нет пользователей'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Пользователь</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Город</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Telegram</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Запусков</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-emerald-600 dark:text-emerald-400">Разреш.</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-red-500 dark:text-red-400">Заблок.</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 dark:text-slate-500">Нейтр.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
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
                            <tr key={u.username} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer" onClick={() => setSelectedUser(u)}>
                              <td className="px-5 py-2.5">
                                <span className="font-medium text-gray-900 dark:text-white">{fio ?? u.username}</span>
                                {fio && <span className="block text-xs text-gray-400 dark:text-slate-500">{u.username}</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {u.city
                                  ? <span className="flex items-center gap-1 text-gray-600 dark:text-slate-300 whitespace-nowrap text-xs"><MapPin className="w-3 h-3 text-gray-400 dark:text-slate-500 shrink-0" />{u.city}</span>
                                  : <span className="text-gray-300 dark:text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
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
                                    {copiedTg === u.telegram
                                      ? <Check className="w-3 h-3 shrink-0" />
                                      : <Copy className="w-3 h-3 shrink-0" />}
                                    {u.telegram}
                                  </button>
                                ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-700 dark:text-slate-300">{launches}</td>
                              <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400 font-medium">{allowed}</td>
                              <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400 font-medium">{blocked}</td>
                              <td className="px-4 py-2.5 text-right text-gray-400 dark:text-slate-500">{neutral}</td>
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
