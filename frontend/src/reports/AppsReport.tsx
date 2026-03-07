import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api } from '../services/api'
import type { AppReport } from '../types'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import SortIcon from '../components/ui/SortIcon'
import Pagination from '../components/ui/Pagination'
import AppUsersPanel from '../components/ui/AppUsersPanel'
import { useSortedData } from '../hooks/useSortedData'
import { matchesPeriod, exportCsv, type FilterProps } from './reportUtils'

export default function AppsReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selectedApp, setSelectedApp] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data = [], isLoading } = useQuery({ queryKey: ['reports/apps'], queryFn: api.getAppsReport, staleTime: 60_000 })
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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700">
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
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
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap" onClick={() => handleSort('name')}>
                  Приложение <SortIcon field="name" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap" onClick={() => handleSort('global_status')}>
                  Статус <SortIcon field="global_status" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap" onClick={() => handleSort('total_launches')}>
                  Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap" onClick={() => handleSort('users_count')}>
                  Польз. <SortIcon field="users_count" current={sortKey} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap" onClick={() => handleSort('computers_count')}>
                  Компьют. <SortIcon field="computers_count" current={sortKey} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
                    Нет приложений за выбранный период
                  </td>
                </tr>
              ) : pagedApps.map(a => (
                <tr
                  key={a.name}
                  className={`cursor-pointer transition-colors ${selectedApp === a.name ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
                  onClick={() => setSelectedApp(a.name === selectedApp ? null : a.name)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white truncate" title={a.name}>{a.name}</td>
                  <td className="px-4 py-3"><Badge status={a.global_status} /></td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{a.total_launches}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{a.users_count}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{a.computers_count}</td>
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
