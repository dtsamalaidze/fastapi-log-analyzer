import { useQuery } from '@tanstack/react-query'
import { X, Monitor, FolderOpen } from 'lucide-react'
import { api } from '../../services/api'
import type { AppUserEntry } from '../../types'
import Spinner from './Spinner'

function fioOf(e: AppUserEntry): string | null {
  const parts = [e.last_name, e.first_name, e.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

export default function AppUsersPanel({ appName, onClose }: { appName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['app-users', appName],
    queryFn: () => api.getAppUsers(appName),
    staleTime: 60_000,
  })

  const entries: AppUserEntry[] = data?.entries ?? []

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative ml-auto w-[480px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30">
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-0.5">Приложение</p>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white break-all">{appName}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && (
            <div className="flex justify-center py-10"><Spinner /></div>
          )}

          {!isLoading && entries.length === 0 && (
            <div className="text-center py-10 text-gray-400 dark:text-slate-500 text-sm space-y-2">
              <p>Нет данных о запусках.</p>
              <p className="text-xs">Выполните полную переобработку логов чтобы заполнить пути.</p>
            </div>
          )}

          {entries.map((e, i) => (
            <div key={i} className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4 space-y-2.5">
              {/* User */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 text-sm font-bold shrink-0">
                  {(fioOf(e) ?? e.username)[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{fioOf(e) ?? e.username}</p>
                  {fioOf(e) && <p className="text-xs text-gray-400 dark:text-slate-500">{e.username}</p>}
                </div>
                <span className="ml-auto text-xs text-gray-400 dark:text-slate-500">{e.launch_count} запусков</span>
              </div>

              {/* Computer */}
              {e.computer && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
                  <Monitor className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
                  <span className="font-medium">{e.computer}</span>
                </div>
              )}

              {/* Path */}
              {e.full_path ? (
                <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-slate-400">
                  <FolderOpen className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0 mt-0.5" />
                  <span className="break-all font-mono bg-gray-100 dark:bg-slate-700 rounded px-2 py-1 leading-relaxed">{e.full_path}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
                  <FolderOpen className="w-4 h-4 shrink-0" />
                  <span>Путь не определён</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
