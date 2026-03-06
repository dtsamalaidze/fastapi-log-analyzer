import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Search, Users, X, CheckCircle, XCircle, Circle, Monitor, Save, MapPin, MessageCircle, Home, Check, Copy } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import type { UserData } from '../types'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import Modal from '../components/ui/Modal'
import CityMultiSelect from '../components/ui/CityMultiSelect'

const ALL = '__all__'
const NONE = ''

/** Возвращает ФИО если заполнено, иначе null */
function fioOf(u: UserData): string | null {
  const parts = [u.last_name, u.first_name, u.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/** Отображаемое имя: ФИО или username */
function displayName(u: UserData): string {
  return fioOf(u) ?? u.username
}

export default function DepartmentsPage() {
  const [filter, setFilter] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState<Set<string>>(new Set())
  const [hasTelegramOnly, setHasTelegramOnly] = useState(false)
  const [newDeptName, setNewDeptName] = useState('')
  const [showAddDept, setShowAddDept] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null)
  const qc = useQueryClient()
  const { showToast } = useToast()

  const { data: deptData, isLoading: loadingDepts } = useQuery({
    queryKey: ['departments'],
    queryFn: api.getDepartments,
    staleTime: 5 * 60_000,
  })
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
    staleTime: 60_000,
  })

  const departments = deptData?.departments ?? []
  const deptNames = departments.map(d => d.name)

  const countByDept = (name: string) => users.filter(u => (u.department ?? '') === name).length
  const countUnassigned = users.filter(u => !u.department).length

  const cities = Array.from(new Set(users.map(u => u.city ?? '').filter(Boolean))).sort()
  const hasLocalFilters = cityFilter.size > 0 || hasTelegramOnly

  const addDeptMutation = useMutation({
    mutationFn: () => api.addDepartment(newDeptName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] })
      showToast('Отдел создан', 'success')
      setNewDeptName('')
      setShowAddDept(false)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const removeDeptMutation = useMutation({
    mutationFn: api.removeDepartment,
    onSuccess: (_res, removedName) => {
      qc.invalidateQueries({ queryKey: ['departments'] })
      if (filter === removedName) setFilter(ALL)
      showToast('Отдел удалён', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const setUserDeptMutation = useMutation({
    mutationFn: ({ username, department }: { username: string; department: string | null }) =>
      api.setUserDepartment(username, department),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['departments'] })
      if (selectedUser?.username === vars.username) {
        setSelectedUser(prev => prev ? { ...prev, department: vars.department } : null)
      }
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const filtered = users.filter(u => {
    const matchesDept =
      filter === ALL ||
      (filter === NONE ? !u.department : u.department === filter)
    const q = search.toLowerCase()
    const matchesSearch = !q ||
      u.username.toLowerCase().includes(q) ||
      (fioOf(u) ?? '').toLowerCase().includes(q)
    const matchesCity = cityFilter.size === 0 || cityFilter.has(u.city ?? '')
    const matchesTelegram = !hasTelegramOnly || !!u.telegram
    return matchesDept && matchesSearch && matchesCity && matchesTelegram
  })

  const handleUserClick = (user: UserData) => {
    const fresh = users.find(u => u.username === user.username) ?? user
    setSelectedUser(fresh)
  }

  if (loadingDepts || loadingUsers) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Распределение по отделам</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} пользователей</p>
        </div>
        <Button size="sm" onClick={() => setShowAddDept(true)}>
          <Plus className="w-4 h-4" /> Новый отдел
        </Button>
      </div>

      {/* Dept filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip label="Все" count={users.length} active={filter === ALL} onClick={() => setFilter(ALL)} />
        <FilterChip
          label="Без отдела" count={countUnassigned}
          active={filter === NONE} warn={countUnassigned > 0}
          onClick={() => setFilter(NONE)}
        />
        {departments.map(dept => (
          <FilterChip
            key={dept.name} label={dept.name} count={countByDept(dept.name)}
            active={filter === dept.name}
            onClick={() => setFilter(dept.name)}
            onDelete={() => removeDeptMutation.mutate(dept.name)}
          />
        ))}
      </div>

      {/* Search + city/telegram filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-none w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени, логину..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {cities.length > 0 && (
          <CityMultiSelect cities={cities} selected={cityFilter} onChange={setCityFilter} />
        )}
        <button
          onClick={() => setHasTelegramOnly(!hasTelegramOnly)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
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

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left font-medium text-gray-600">Пользователь</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Город</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Telegram</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 hidden lg:table-cell">Компьютеры</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Отдел</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(user => (
              <UserRow
                key={user.username}
                user={user}
                deptNames={deptNames}
                selected={selectedUser?.username === user.username}
                onClick={() => handleUserClick(user)}
                onChange={dept => setUserDeptMutation.mutate({ username: user.username, department: dept })}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">Пользователи не найдены</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-50 text-xs text-gray-400 text-right">
            {filtered.length} из {users.length}
          </div>
        )}
      </div>

      {/* Side panel */}
      {selectedUser && (
        <UserPanel
          key={selectedUser.username}
          user={selectedUser}
          deptNames={deptNames}
          onClose={() => setSelectedUser(null)}
          onDeptChange={dept => setUserDeptMutation.mutate({ username: selectedUser.username, department: dept })}
          onSaved={updated => {
            setSelectedUser(updated)
            qc.invalidateQueries({ queryKey: ['users'] })
          }}
        />
      )}

      {/* Add dept modal */}
      <Modal open={showAddDept} title="Новый отдел" onClose={() => setShowAddDept(false)}>
        <div className="space-y-4">
          <input
            value={newDeptName}
            onChange={e => setNewDeptName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newDeptName.trim() && addDeptMutation.mutate()}
            placeholder="Название отдела"
            autoFocus
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAddDept(false)}>Отмена</Button>
            <Button onClick={() => addDeptMutation.mutate()} loading={addDeptMutation.isPending} disabled={!newDeptName.trim()}>
              Создать
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, count, active, warn = false, onClick, onDelete }: {
  label: string; count: number; active: boolean; warn?: boolean
  onClick: () => void; onDelete?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 pl-3 rounded-full border text-sm font-medium cursor-pointer select-none transition-colors
        ${active ? 'bg-indigo-600 border-indigo-600 text-white'
          : warn && count > 0 ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}
        ${onDelete ? 'pr-1' : 'pr-3'}`}
    >
      <span>{label}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className={`p-1 rounded-full transition-colors ${active ? 'hover:bg-white/20' : 'hover:bg-red-100 hover:text-red-600'}`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

// ─── User row ─────────────────────────────────────────────────────────────────

function UserRow({ user, deptNames, selected, onClick, onChange }: {
  user: UserData; deptNames: string[]; selected: boolean
  onClick: () => void; onChange: (dept: string | null) => void
}) {
  const fio = fioOf(user)
  const [copied, setCopied] = useState(false)

  const copyTelegram = (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    if (!user.telegram) return
    navigator.clipboard.writeText(user.telegram)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <tr onClick={onClick} className={`cursor-pointer transition-colors ${selected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{fio ?? user.username}</p>
        {fio && <p className="text-xs text-gray-400 mt-0.5">{user.username}</p>}
      </td>
      <td className="px-4 py-3">
        {user.city
          ? <span className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap"><MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />{user.city}</span>
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3">
        {user.telegram ? (
          <button
            onClick={copyTelegram}
            title="Копировать в буфер"
            className={`flex items-center gap-1.5 text-xs font-mono rounded px-2 py-0.5 transition-colors whitespace-nowrap ${
              copied
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            {copied ? <Check className="w-3 h-3 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
            {user.telegram}
          </button>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{user.computers || '—'}</td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <select
          value={user.department ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer transition-colors
            ${user.department ? 'border-indigo-200 text-indigo-700 bg-indigo-50' : 'border-gray-300 text-gray-400'}`}
        >
          <option value="">Без отдела</option>
          {deptNames.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </td>
    </tr>
  )
}

// ─── User side panel ──────────────────────────────────────────────────────────

function UserPanel({ user, deptNames, onClose, onDeptChange, onSaved }: {
  user: UserData; deptNames: string[]
  onClose: () => void
  onDeptChange: (dept: string | null) => void
  onSaved: (updated: UserData) => void
}) {
  const { showToast } = useToast()

  const [lastName,   setLastName]   = useState(user.last_name   ?? '')
  const [firstName,  setFirstName]  = useState(user.first_name  ?? '')
  const [middleName, setMiddleName] = useState(user.middle_name ?? '')
  const [city,       setCity]       = useState(user.city        ?? '')
  const [address,    setAddress]    = useState(user.address     ?? '')
  const [telegram,   setTelegram]   = useState(user.telegram    ?? '')

  const profileMutation = useMutation({
    mutationFn: () => api.setUserProfile(user.username, {
      last_name:   lastName.trim(),
      first_name:  firstName.trim(),
      middle_name: middleName.trim(),
      city:        city.trim(),
      address:     address.trim(),
      telegram:    telegram.trim(),
    }),
    onSuccess: () => {
      showToast('Данные сохранены', 'success')
      onSaved({
        ...user,
        last_name:   lastName.trim()   || null,
        first_name:  firstName.trim()  || null,
        middle_name: middleName.trim() || null,
        city:        city.trim()       || null,
        address:     address.trim()    || null,
        telegram:    telegram.trim()   || null,
      })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const total = user.allowed_count + user.blocked_count + user.neutral_count
  const fio = fioOf(user)

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Пользователь</p>
            <h2 className="font-bold text-xl text-gray-900">{fio ?? user.username}</h2>
            {fio && <p className="text-xs text-gray-400 mt-0.5">{user.username}</p>}
            {user.department && (
              <span className="inline-block mt-1.5 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium">
                {user.department}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats */}
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Приложения · {total} всего
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col items-center p-3 bg-emerald-50 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-500 mb-1" />
              <span className="text-2xl font-bold text-emerald-600">{user.allowed_count}</span>
              <span className="text-xs text-emerald-600 mt-0.5">Разрешено</span>
            </div>
            <div className="flex flex-col items-center p-3 bg-red-50 rounded-xl">
              <XCircle className="w-5 h-5 text-red-400 mb-1" />
              <span className="text-2xl font-bold text-red-600">{user.blocked_count}</span>
              <span className="text-xs text-red-600 mt-0.5">Заблокировано</span>
            </div>
            <div className="flex flex-col items-center p-3 bg-gray-50 rounded-xl">
              <Circle className="w-5 h-5 text-gray-400 mb-1" />
              <span className="text-2xl font-bold text-gray-600">{user.neutral_count}</span>
              <span className="text-xs text-gray-500 mt-0.5">Нейтрально</span>
            </div>
          </div>
          {total > 0 && (
            <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
              {user.allowed_count > 0 && <div className="bg-emerald-400 h-full" style={{ width: `${(user.allowed_count / total) * 100}%` }} />}
              {user.blocked_count > 0 && <div className="bg-red-400 h-full" style={{ width: `${(user.blocked_count / total) * 100}%` }} />}
              {user.neutral_count > 0 && <div className="bg-gray-300 h-full" style={{ width: `${(user.neutral_count / total) * 100}%` }} />}
            </div>
          )}
        </div>

        {/* Computers */}
        {user.computers && user.computers !== 'Не указан' && (
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Компьютеры</p>
            <div className="flex flex-wrap gap-1.5">
              {user.computers.split(', ').map(c => (
                <span key={c} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg">
                  <Monitor className="w-3 h-3" />{c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Department */}
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Отдел</p>
          <select
            value={user.department ?? ''}
            onChange={e => onDeptChange(e.target.value || null)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="">Без отдела</option>
            {deptNames.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Profile form */}
        <div className="px-6 py-5 flex-1 space-y-5">
          {/* ФИО */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">ФИО</p>
            <div className="space-y-2.5">
              <LabeledInput label="Фамилия" value={lastName} onChange={setLastName} placeholder="Иванов" />
              <LabeledInput label="Имя" value={firstName} onChange={setFirstName} placeholder="Иван" />
              <LabeledInput label="Отчество" value={middleName} onChange={setMiddleName} placeholder="Иванович" />
            </div>
          </div>

          {/* Контакты */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Контакты</p>
            <div className="space-y-2.5">
              <LabeledInput
                label="Город" value={city} onChange={setCity} placeholder="Москва"
                icon={<MapPin className="w-3.5 h-3.5 text-gray-400" />}
              />
              <LabeledInput
                label="Адрес" value={address} onChange={setAddress} placeholder="ул. Ленина, 1"
                icon={<Home className="w-3.5 h-3.5 text-gray-400" />}
              />
              <LabeledInput
                label="Telegram" value={telegram} onChange={setTelegram} placeholder="@username"
                icon={<MessageCircle className="w-3.5 h-3.5 text-gray-400" />}
              />
            </div>
          </div>

          <Button
            className="w-full justify-center"
            onClick={() => profileMutation.mutate()}
            loading={profileMutation.isPending}
          >
            <Save className="w-4 h-4" /> Сохранить
          </Button>
        </div>
      </div>
    </>
  )
}

// ─── Labeled input helper ─────────────────────────────────────────────────────

function LabeledInput({ label, value, onChange, placeholder, icon }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; icon?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full border border-gray-300 rounded-lg text-sm py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${icon ? 'pl-9 pr-3' : 'px-3'}`}
        />
      </div>
    </div>
  )
}
