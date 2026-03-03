import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, ChevronDown, Search, CheckCircle, XCircle } from 'lucide-react'
import { api } from '../services/api'
import type { AppReport } from '../types'
import { useToast } from '../context/ToastContext'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import AppUsersPanel from '../components/ui/AppUsersPanel'

type Tab = 'global' | 'departments'

export default function AppsPage() {
  const [tab, setTab] = useState<Tab>('global')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Управление приложениями</h1>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['global', 'departments'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'global' ? 'Глобальные правила' : 'Правила по отделам'}
          </button>
        ))}
      </div>

      {tab === 'global' && <GlobalRules />}
      {tab === 'departments' && <DepartmentRules />}
    </div>
  )
}

// ─── Список разрешённых/заблокированных с ручным добавлением ──────────────────

function AppList({
  title,
  colorCls,
  apps,
  onRemove,
  onAdd,
  onSelect,
  selectedApp,
  loading,
}: {
  title: string
  colorCls: string
  apps: string[]
  onRemove: (app: string) => void
  onAdd: (app: string) => void
  onSelect: (app: string) => void
  selectedApp: string | null
  loading: boolean
}) {
  const [input, setInput] = useState('')

  const handleAdd = () => {
    const val = input.trim()
    if (!val) return
    onAdd(val)
    setInput('')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className={`px-5 py-3 border-b border-gray-100 ${colorCls}`}>
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-xs opacity-70 mt-0.5">{apps.length} приложений</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="app.exe"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button size="sm" onClick={handleAdd} disabled={loading || !input.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading && apps.length === 0 ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : apps.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Список пуст</p>
          ) : (
            apps.map(app => (
              <div
                key={app}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  selectedApp === app ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-gray-50 hover:bg-gray-100'
                }`}
                onClick={() => onSelect(app)}
              >
                <span className="text-sm text-gray-800 truncate">{app}</span>
                <button
                  onClick={e => { e.stopPropagation(); onRemove(app) }}
                  className="flex-shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Список нейтральных приложений с быстрыми действиями ─────────────────────

function NeutralAppsList({
  apps,
  loading,
  onAddAllowed,
  onAddBlocked,
  onSelect,
  selectedApp,
}: {
  apps: string[]
  loading: boolean
  onAddAllowed: (app: string) => void
  onAddBlocked: (app: string) => void
  onSelect: (app: string) => void
  selectedApp: string | null
}) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? apps.filter(a => a.toLowerCase().includes(search.toLowerCase()))
    : apps

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 text-gray-700">
        <h3 className="font-semibold text-sm">Нейтральные приложения</h3>
        <p className="text-xs opacity-70 mt-0.5">
          {loading ? '…' : `${apps.length} приложений — нажмите на название чтобы посмотреть кто использует`}
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {loading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {search ? 'Ничего не найдено' : 'Нейтральных приложений нет'}
            </p>
          ) : (
            filtered.map(app => (
              <div
                key={app}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer group transition-colors ${
                  selectedApp === app ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'
                }`}
                onClick={() => onSelect(app)}
              >
                <span className="text-sm text-gray-800 truncate flex-1 min-w-0">{app}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => { e.stopPropagation(); onAddAllowed(app) }}
                    title="Добавить в разрешённые"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Разрешить
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onAddBlocked(app) }}
                    title="Добавить в заблокированные"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Заблокировать
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {filtered.length > 0 && !loading && (
          <p className="text-xs text-gray-400 text-right">
            {filtered.length !== apps.length
              ? `Показано ${filtered.length} из ${apps.length}`
              : `Всего: ${apps.length}`}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Глобальные правила ───────────────────────────────────────────────────────

function GlobalRules() {
  const [selectedApp, setSelectedApp] = useState<string | null>(null)
  const qc = useQueryClient()
  const { showToast } = useToast()

  const { data: allowed, isLoading: loadingA } = useQuery({
    queryKey: ['global/allowed'],
    queryFn: api.getGlobalAllowed,
  })
  const { data: blocked, isLoading: loadingB } = useQuery({
    queryKey: ['global/blocked'],
    queryFn: api.getGlobalBlocked,
  })
  const { data: appsReport = [], isLoading: loadingReport } = useQuery({
    queryKey: ['reports/apps'],
    queryFn: api.getAppsReport,
  })

  // Нейтральные = все приложения из отчёта, не входящие ни в один список
  const allowedSet = new Set((allowed?.apps ?? []).map(a => a.toLowerCase()))
  const blockedSet = new Set((blocked?.apps ?? []).map(a => a.toLowerCase()))
  const neutralApps = appsReport
    .filter((a: AppReport) => !allowedSet.has(a.name.toLowerCase()) && !blockedSet.has(a.name.toLowerCase()))
    .map((a: AppReport) => a.name)
    .sort((a, b) => a.localeCompare(b))

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['global/allowed'] })
    qc.invalidateQueries({ queryKey: ['global/blocked'] })
    qc.invalidateQueries({ queryKey: ['reports/apps'] })
  }

  const addAllowed = useMutation({
    mutationFn: api.addGlobalAllowed,
    onSuccess: () => { invalidateAll(); showToast('Добавлено в разрешённые', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const removeAllowed = useMutation({
    mutationFn: api.removeGlobalAllowed,
    onSuccess: () => { invalidateAll(); showToast('Удалено из разрешённых', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const addBlocked = useMutation({
    mutationFn: api.addGlobalBlocked,
    onSuccess: () => { invalidateAll(); showToast('Добавлено в заблокированные', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const removeBlocked = useMutation({
    mutationFn: api.removeGlobalBlocked,
    onSuccess: () => { invalidateAll(); showToast('Удалено из заблокированных', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const handleSelect = (app: string) => setSelectedApp(prev => prev === app ? null : app)

  return (
    <>
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <AppList
            title="Глобально разрешённые"
            colorCls="bg-emerald-50 text-emerald-800"
            apps={allowed?.apps ?? []}
            loading={loadingA}
            onAdd={app => addAllowed.mutate(app)}
            onRemove={app => removeAllowed.mutate(app)}
            onSelect={handleSelect}
            selectedApp={selectedApp}
          />
          <AppList
            title="Глобально заблокированные"
            colorCls="bg-red-50 text-red-800"
            apps={blocked?.apps ?? []}
            loading={loadingB}
            onAdd={app => addBlocked.mutate(app)}
            onRemove={app => removeBlocked.mutate(app)}
            onSelect={handleSelect}
            selectedApp={selectedApp}
          />
        </div>

        <NeutralAppsList
          apps={neutralApps}
          loading={loadingReport}
          onAddAllowed={app => addAllowed.mutate(app)}
          onAddBlocked={app => addBlocked.mutate(app)}
          onSelect={handleSelect}
          selectedApp={selectedApp}
        />
      </div>

      {selectedApp && (
        <AppUsersPanel appName={selectedApp} onClose={() => setSelectedApp(null)} />
      )}
    </>
  )
}

// ─── Правила по отделам ───────────────────────────────────────────────────────

function DepartmentRules() {
  const [openDept, setOpenDept] = useState<string | null>(null)
  const qc = useQueryClient()
  const { showToast } = useToast()

  const { data, isLoading } = useQuery({ queryKey: ['departments'], queryFn: api.getDepartments })
  const departments = data?.departments ?? []

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>

  return (
    <div className="space-y-3">
      {departments.length === 0 && (
        <p className="text-gray-400 text-center py-10">Нет отделов. Создайте их на странице Отделы.</p>
      )}
      {departments.map(dept => (
        <DeptAccordion
          key={dept.name}
          dept={dept.name}
          open={openDept === dept.name}
          onToggle={() => setOpenDept(openDept === dept.name ? null : dept.name)}
          qc={qc}
          showToast={showToast}
        />
      ))}
    </div>
  )
}

function DeptAccordion({
  dept,
  open,
  onToggle,
  qc,
  showToast,
}: {
  dept: string
  open: boolean
  onToggle: () => void
  qc: ReturnType<typeof useQueryClient>
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [selectedApp, setSelectedApp] = useState<string | null>(null)

  const { data: deptApps, isLoading: loadingDept } = useQuery({
    queryKey: ['dept-apps', dept],
    queryFn: () => api.getDepartmentApps(dept),
    enabled: open,
  })
  const { data: appsReport = [], isLoading: loadingReport } = useQuery({
    queryKey: ['reports/apps'],
    queryFn: api.getAppsReport,
    enabled: open,
  })

  // Нейтральные для отдела = все приложения, не попавшие в списки отдела
  const deptAllowedSet = new Set((deptApps?.allowed ?? []).map((a: string) => a.toLowerCase()))
  const deptBlockedSet = new Set((deptApps?.blocked ?? []).map((a: string) => a.toLowerCase()))
  const neutralApps = (appsReport as AppReport[])
    .filter(a => !deptAllowedSet.has(a.name.toLowerCase()) && !deptBlockedSet.has(a.name.toLowerCase()))
    .map(a => a.name)
    .sort((a, b) => a.localeCompare(b))

  const invalidateDept = () => qc.invalidateQueries({ queryKey: ['dept-apps', dept] })

  const addAllowed = useMutation({
    mutationFn: (app: string) => api.addDeptAllowed(dept, app),
    onSuccess: () => { invalidateDept(); showToast('Добавлено в разрешённые', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const removeAllowed = useMutation({
    mutationFn: (app: string) => api.removeDeptAllowed(dept, app),
    onSuccess: () => { invalidateDept(); showToast('Удалено', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const addBlocked = useMutation({
    mutationFn: (app: string) => api.addDeptBlocked(dept, app),
    onSuccess: () => { invalidateDept(); showToast('Добавлено в заблокированные', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const removeBlocked = useMutation({
    mutationFn: (app: string) => api.removeDeptBlocked(dept, app),
    onSuccess: () => { invalidateDept(); showToast('Удалено', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const handleSelect = (app: string) => setSelectedApp(prev => prev === app ? null : app)

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium text-gray-900">{dept}</span>
          <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="px-5 pb-5 border-t border-gray-100 space-y-4 mt-0">
            {loadingDept ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4 pt-4">
                  <AppList
                    title="Разрешённые для отдела"
                    colorCls="bg-emerald-50 text-emerald-800"
                    apps={deptApps?.allowed ?? []}
                    loading={false}
                    onAdd={app => addAllowed.mutate(app)}
                    onRemove={app => removeAllowed.mutate(app)}
                    onSelect={handleSelect}
                    selectedApp={selectedApp}
                  />
                  <AppList
                    title="Заблокированные для отдела"
                    colorCls="bg-red-50 text-red-800"
                    apps={deptApps?.blocked ?? []}
                    loading={false}
                    onAdd={app => addBlocked.mutate(app)}
                    onRemove={app => removeBlocked.mutate(app)}
                    onSelect={handleSelect}
                    selectedApp={selectedApp}
                  />
                </div>

                <NeutralAppsList
                  apps={neutralApps}
                  loading={loadingReport}
                  onAddAllowed={app => addAllowed.mutate(app)}
                  onAddBlocked={app => addBlocked.mutate(app)}
                  onSelect={handleSelect}
                  selectedApp={selectedApp}
                />
              </>
            )}
          </div>
        )}
      </div>

      {selectedApp && (
        <AppUsersPanel appName={selectedApp} onClose={() => setSelectedApp(null)} />
      )}
    </>
  )
}
