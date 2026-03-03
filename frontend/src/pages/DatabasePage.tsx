import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Zap, ShieldCheck, Trash2, RefreshCw,
  HardDrive, Table2, AlertTriangle, CheckCircle2, XCircle, Download,
} from 'lucide-react'
import { api } from '../services/api'
import { usePermissions } from '../hooks/usePermissions'
import { useToast } from '../context/ToastContext'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import Modal from '../components/ui/Modal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return '0 Б'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} МБ`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

const TABLE_LABELS: Record<string, string> = {
  users:                    'Системные пользователи',
  sessions:                 'Активные сессии',
  departments:              'Отделы',
  global_allowed_apps:      'Разрешённые приложения (глоб.)',
  global_blocked_apps:      'Заблокированные приложения (глоб.)',
  department_allowed_apps:  'Разрешённые приложения (по отделам)',
  department_blocked_apps:  'Заблокированные приложения (по отделам)',
  log_users:                'Пользователи из логов',
  log_apps:                 'Записи запусков',
  log_app_paths:            'Пути запусков',
  computers:                'Компьютеры',
  user_computers:           'Связи пользователь-компьютер',
}

const LOG_TABLES = ['log_users', 'log_apps', 'log_app_paths', 'computers', 'user_computers']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const perms = usePermissions()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [vacuumDone, setVacuumDone] = useState(false)

  const handleBackup = () => {
    window.open('/api/db/backup', '_blank')
  }
  const [integrityResult, setIntegrityResult] = useState<{ ok: boolean; results: string[] } | null>(null)
  const [clearModal, setClearModal] = useState<'all' | 'partial' | null>(null)
  const [olderThanDays, setOlderThanDays] = useState('30')

  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ['db-stats'],
    queryFn: api.getDbStats,
    refetchOnWindowFocus: false,
  })

  const vacuumMutation = useMutation({
    mutationFn: api.vacuumDb,
    onSuccess: () => {
      setVacuumDone(true)
      qc.invalidateQueries({ queryKey: ['db-stats'] })
      showToast('VACUUM ANALYZE выполнен успешно', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const integrityMutation = useMutation({
    mutationFn: api.integrityCheck,
    onSuccess: res => {
      setIntegrityResult({ ok: res.ok, results: res.results })
      showToast(res.ok ? 'База данных доступна' : 'Ошибка подключения', res.ok ? 'success' : 'error')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const clearMutation = useMutation({
    mutationFn: (days?: number) => api.clearLogs(days),
    onSuccess: res => {
      setClearModal(null)
      qc.invalidateQueries({ queryKey: ['db-stats'] })
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0)
      showToast(`Удалено ${total} записей`, 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const canManage = perms.database.manage

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  const logRows = stats
    ? LOG_TABLES.reduce((s, t) => s + Math.max(0, stats.tables[t] ?? 0), 0)
    : 0
  const tableCount = stats ? Object.keys(stats.tables).length : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">База данных</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Обслуживание и мониторинг PostgreSQL
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" /> Обновить
        </Button>
      </div>

      {/* ── Engine badge ── */}
      {stats && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm">
          <Database className="w-5 h-5 text-indigo-500 shrink-0" />
          <div>
            <span className="font-semibold text-indigo-800">Движок: </span>
            <span className="font-mono text-indigo-700">{stats.engine}</span>
          </div>
        </div>
      )}

      {/* ── Stat cards ── */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<HardDrive className="w-5 h-5 text-indigo-500" />}
            label="Размер базы данных"
            value={formatBytes(stats.db_size)}
            sub="pg_database_size"
          />
          <StatCard
            icon={<Table2 className="w-5 h-5 text-purple-500" />}
            label="Таблиц"
            value={String(tableCount)}
            sub="в схеме public"
          />
          <StatCard
            icon={<Zap className="w-5 h-5 text-emerald-500" />}
            label="Записей в логах"
            value={logRows.toLocaleString('ru-RU')}
            sub="log_users + log_apps + пути"
          />
          <StatCard
            icon={<Database className="w-5 h-5 text-amber-500" />}
            label="Пользователей из логов"
            value={(stats.tables['log_users'] ?? 0).toLocaleString('ru-RU')}
            sub={`приложений: ${(stats.tables['log_apps'] ?? 0).toLocaleString('ru-RU')}`}
          />
        </div>
      )}

      {/* ── Operations ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* VACUUM ANALYZE */}
        <ActionCard
          icon={<Zap className="w-5 h-5 text-amber-500" />}
          title="VACUUM ANALYZE"
          description="Обновляет статистику планировщика запросов и освобождает мёртвые кортежи. Выполняется в AUTOCOMMIT-режиме."
          disabled={!canManage}
        >
          <Button
            onClick={() => { setVacuumDone(false); vacuumMutation.mutate() }}
            loading={vacuumMutation.isPending}
            disabled={!canManage}
            variant="secondary"
          >
            <Zap className="w-4 h-4" /> Выполнить VACUUM ANALYZE
          </Button>
          {vacuumDone && (
            <div className="mt-3 p-3 bg-amber-50 rounded-lg text-sm flex items-center gap-2 text-amber-800">
              <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
              VACUUM ANALYZE успешно выполнен
            </div>
          )}
        </ActionCard>

        {/* Health check */}
        <ActionCard
          icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
          title="Проверка подключения"
          description="Выполняет SELECT 1 — проверяет, что PostgreSQL отвечает и соединение активно."
          disabled={!canManage}
        >
          <Button
            onClick={() => integrityMutation.mutate()}
            loading={integrityMutation.isPending}
            disabled={!canManage}
            variant="secondary"
          >
            <ShieldCheck className="w-4 h-4" /> Проверить
          </Button>
          {integrityResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm space-y-1 ${integrityResult.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <div className={`flex items-center gap-2 font-medium ${integrityResult.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                {integrityResult.ok
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <XCircle className="w-4 h-4" />}
                {integrityResult.ok ? 'PostgreSQL доступен' : 'Ошибка подключения'}
              </div>
            </div>
          )}
        </ActionCard>

        {/* Backup */}
        <ActionCard
          icon={<Download className="w-5 h-5 text-blue-500" />}
          title="Резервная копия"
          description="Сервер выполняет pg_dump и возвращает готовый SQL-дамп базы данных."
          disabled={!canManage}
        >
          <Button onClick={handleBackup} disabled={!canManage} variant="secondary">
            <Download className="w-4 h-4" /> Скачать резервную копию
          </Button>
        </ActionCard>

        {/* Clear logs */}
        <ActionCard
          icon={<Trash2 className="w-5 h-5 text-red-500" />}
          title="Очистка лог-данных"
          description="Удаляет данные из лог-таблиц (log_users, log_apps, пути, компьютеры). Системные настройки и пользователи не затрагиваются."
          disabled={!canManage}
          danger
        >
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={() => setClearModal('partial')}
              disabled={!canManage}
            >
              <Trash2 className="w-4 h-4" /> Старше N дней
            </Button>
            <button
              onClick={() => setClearModal('all')}
              disabled={!canManage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Очистить всё
            </button>
          </div>
        </ActionCard>
      </div>

      {/* ── Table stats ── */}
      {stats && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Table2 className="w-4 h-4 text-gray-400" />
            <span className="font-semibold text-gray-800 text-sm">Статистика таблиц</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500">Таблица</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-500">Записей</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(stats.tables).map(([table, count]) => {
                const isLog = LOG_TABLES.includes(table)
                return (
                  <tr key={table} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-xs text-gray-500 mr-2">{table}</span>
                      <span className="text-gray-700">{TABLE_LABELS[table] ?? ''}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium text-gray-800">
                      {count < 0 ? '—' : count.toLocaleString('ru-RU')}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {isLog && count > 0 && (
                        <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">лог</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Clear ALL modal ── */}
      <Modal
        open={clearModal === 'all'}
        title="Очистить все лог-данные"
        onClose={() => setClearModal(null)}
      >
        <div className="space-y-4">
          <div className="flex gap-3 p-4 bg-red-50 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <p className="font-semibold mb-1">Это действие необратимо!</p>
              <p>Будут удалены все записи из таблиц:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {LOG_TABLES.map(t => (
                  <li key={t} className="font-mono text-xs">
                    {t} {stats?.tables[t] != null ? `(${stats.tables[t].toLocaleString('ru-RU')} записей)` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setClearModal(null)}>Отмена</Button>
            <button
              onClick={() => clearMutation.mutate(undefined)}
              disabled={clearMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {clearMutation.isPending ? <Spinner size="sm" /> : <Trash2 className="w-4 h-4" />}
              Удалить всё
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Clear PARTIAL modal ── */}
      <Modal
        open={clearModal === 'partial'}
        title="Очистить старые данные"
        onClose={() => setClearModal(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Удалить записи о пользователях и их активности, если последняя активность была более чем N дней назад.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Старше (дней)</label>
            <input
              type="number"
              min={1}
              value={olderThanDays}
              onChange={e => setOlderThanDays(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Это действие необратимо. Данные не могут быть восстановлены.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setClearModal(null)}>Отмена</Button>
            <button
              onClick={() => clearMutation.mutate(Number(olderThanDays))}
              disabled={clearMutation.isPending || !olderThanDays || Number(olderThanDays) < 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 transition-colors"
            >
              {clearMutation.isPending ? <Spinner size="sm" /> : <Trash2 className="w-4 h-4" />}
              Удалить
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, warn = false }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; warn?: boolean
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-4 ${warn ? 'border-amber-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500 font-medium">{label}</span></div>
      <p className={`text-xl font-bold ${warn ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function ActionCard({ icon, title, description, children, disabled = false, danger = false }: {
  icon: React.ReactNode; title: string; description: string
  children: React.ReactNode; disabled?: boolean; danger?: boolean
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 space-y-3 ${danger ? 'border-red-100' : 'border-gray-100'} ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-gray-800">{title}</span>
      </div>
      <p className="text-sm text-gray-500">{description}</p>
      <div>{children}</div>
    </div>
  )
}
