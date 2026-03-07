import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, X, Monitor, Users, Wifi } from 'lucide-react'
import { api } from '../services/api'
import type { ComputerReport, ComputerUserEntry } from '../types'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import SortIcon from '../components/ui/SortIcon'
import Pagination from '../components/ui/Pagination'
import { useSortedData } from '../hooks/useSortedData'
import { matchesPeriod, exportCsv, type FilterProps } from './reportUtils'

function computerFio(u: ComputerUserEntry): string | null {
  const parts = [u.last_name, u.first_name, u.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function ComputerDetailPanel({ computerName, onClose }: { computerName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['computer-users', computerName],
    queryFn: () => api.getComputerUsers(computerName),
    staleTime: 60_000,
  })
  const users: ComputerUserEntry[] = data?.users ?? []
  const ip = data?.ip_address

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative ml-auto w-[400px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white leading-tight font-mono">{computerName}</p>
              {!isLoading && (
                <p className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                  <Wifi className="w-3 h-3" />{ip || 'IP не определён'}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
          {!isLoading && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                Пользователи
                <span className="ml-auto text-xs font-normal text-gray-400 dark:text-slate-500">{users.length}</span>
              </h3>
              {users.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">Нет данных о пользователях</p>
              ) : (
                <div className="space-y-2">
                  {users.map((u, i) => {
                    const fio = computerFio(u)
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-slate-800 rounded-xl">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 text-sm font-bold shrink-0">
                          {(fio ?? u.username)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{fio ?? u.username}</p>
                          <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{fio ? u.username : (u.department ?? '—')}</p>
                        </div>
                        {fio && u.department && (
                          <span className="ml-auto text-xs text-gray-400 dark:text-slate-500 shrink-0">{u.department}</span>
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

export default function ComputersReport({ dateFrom, dateTo, statusFilters }: FilterProps) {
  const [selectedComputer, setSelectedComputer] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data = [], isLoading } = useQuery({ queryKey: ['reports/computers'], queryFn: api.getComputersReport, staleTime: 60_000 })
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

  const txtCls = 'px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap'
  const numCls = 'px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap'

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700">
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
            {filtered.length !== data.length ? `${filtered.length} из ${data.length} компьютеров` : `${data.length} компьютеров`}
          </span>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className={txtCls} onClick={() => handleSort('name')}>Компьютер <SortIcon field="name" current={sortKey} dir={sortDir} /></th>
                <th className={txtCls} onClick={() => handleSort('ip_address')}>IP-адрес <SortIcon field="ip_address" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('users_count')}>Польз. <SortIcon field="users_count" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('total_launches')}>Запусков <SortIcon field="total_launches" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('apps_count')}>Прил. <SortIcon field="apps_count" current={sortKey} dir={sortDir} /></th>
                <th className={numCls} onClick={() => handleSort('blocked_count')}>Заблок. <SortIcon field="blocked_count" current={sortKey} dir={sortDir} /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
              {pagedComputers.map(c => {
                const isSelected = selectedComputer === c.name
                return (
                  <tr
                    key={c.name}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
                    onClick={() => setSelectedComputer(isSelected ? null : c.name)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white font-mono">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400 font-mono text-xs">{c.ip_address || <span className="text-gray-300 dark:text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{c.users_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{c.total_launches}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{c.apps_count}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 font-medium">{c.status_counts.blocked}</td>
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
