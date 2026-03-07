import { useState } from 'react'
import { Calendar } from 'lucide-react'
import type { Period, StatusFilter } from '../types'
import { usePermissions } from '../hooks/usePermissions'
import { getPeriodDates } from '../utils/dates'
import UsersReport from '../reports/UsersReport'
import AppsReport from '../reports/AppsReport'
import ComputersReport from '../reports/ComputersReport'
import DepartmentsReport from '../reports/DepartmentsReport'
import type { FilterProps } from '../reports/reportUtils'

type Tab = 'users' | 'apps' | 'computers' | 'departments'

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
    inactive: 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 hover:border-emerald-500',
  },
  {
    id: 'neutral', label: 'Нейтральные',
    active: 'bg-gray-500 text-white border-gray-500',
    inactive: 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-500',
  },
  {
    id: 'blocked', label: 'Запрещённые',
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-white dark:bg-slate-700 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800 hover:border-red-500',
  },
]

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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Отчёты</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-700/50 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600 dark:text-indigo-400'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 space-y-3">
        {/* Period */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <Calendar className="w-4 h-4 text-gray-400 dark:text-slate-500" />
            <span className="text-sm font-medium text-gray-500 dark:text-slate-400">Период</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {PERIOD_OPTIONS.map(p => (
              <button
                key={p.id}
                onClick={() => togglePeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  period === p.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button onClick={resetFilters} className="ml-auto shrink-0 text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 underline">
              Сбросить
            </button>
          )}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2 pl-1">
            <input
              type="date" value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            />
            <span className="text-gray-400 dark:text-slate-500 text-sm">—</span>
            <input
              type="date" value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            />
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-500 dark:text-slate-400 shrink-0">Статус</span>
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
