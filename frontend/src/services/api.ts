import type { AuthCheckResponse, UserData, Stats, DepartmentApps, AppReport, ComputerReport, DepartmentReport, AppUserEntry, ComputerUserEntry, SystemAccount, UserPermissions, PermissionRole } from '../types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/auth-check') {
    window.location.href = '/login'
    return Promise.reject(new Error('Сессия истекла'))
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ success: boolean; user: { username: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  authCheck: () => request<AuthCheckResponse>('/api/auth-check'),

  // Users & stats
  getUsers: () => request<UserData[]>('/api/users'),
  getStats: () => request<Stats>('/api/stats'),

  // Global apps
  getGlobalAllowed: () => request<{ apps: string[]; count: number }>('/api/global/allowed'),
  getGlobalBlocked: () => request<{ apps: string[]; count: number }>('/api/global/blocked'),
  addGlobalAllowed: (app_name: string) =>
    request<{ success: boolean; apps: string[]; message: string }>('/api/global/allowed/add', {
      method: 'POST',
      body: JSON.stringify({ app_name }),
    }),
  removeGlobalAllowed: (app_name: string) =>
    request<{ success: boolean; apps: string[]; message: string }>('/api/global/allowed/remove', {
      method: 'POST',
      body: JSON.stringify({ app_name }),
    }),
  addGlobalBlocked: (app_name: string) =>
    request<{ success: boolean; apps: string[]; message: string }>('/api/global/blocked/add', {
      method: 'POST',
      body: JSON.stringify({ app_name }),
    }),
  removeGlobalBlocked: (app_name: string) =>
    request<{ success: boolean; apps: string[]; message: string }>('/api/global/blocked/remove', {
      method: 'POST',
      body: JSON.stringify({ app_name }),
    }),

  // Departments
  getDepartments: () => request<{ departments: Array<{ name: string; user_count: number; allowed_count: number; blocked_count: number }> }>('/api/departments'),
  addDepartment: (name: string) =>
    request<{ success: boolean; message: string }>('/api/departments/add', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  removeDepartment: (name: string) =>
    request<{ success: boolean; message: string }>('/api/departments/remove', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  setUserProfile: (username: string, profile: {
    last_name: string; first_name: string; middle_name: string
    city: string; address: string; telegram: string
  }) =>
    request<{ success: boolean }>(`/api/users/${encodeURIComponent(username)}/profile`, {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

  setUserDepartment: (username: string, department: string | null) =>
    request<{ success: boolean; message: string }>('/api/departments/set-user', {
      method: 'POST',
      body: JSON.stringify({ username, department }),
    }),
  getDepartmentApps: (dept: string) =>
    request<DepartmentApps>(`/api/departments/${encodeURIComponent(dept)}/apps`),
  addDeptAllowed: (dept: string, app_name: string) =>
    request<{ success: boolean; message: string }>(
      `/api/departments/${encodeURIComponent(dept)}/apps/allowed/add`,
      { method: 'POST', body: JSON.stringify({ app_name }) },
    ),
  removeDeptAllowed: (dept: string, app_name: string) =>
    request<{ success: boolean; message: string }>(
      `/api/departments/${encodeURIComponent(dept)}/apps/allowed/remove`,
      { method: 'POST', body: JSON.stringify({ app_name }) },
    ),
  addDeptBlocked: (dept: string, app_name: string) =>
    request<{ success: boolean; message: string }>(
      `/api/departments/${encodeURIComponent(dept)}/apps/blocked/add`,
      { method: 'POST', body: JSON.stringify({ app_name }) },
    ),
  removeDeptBlocked: (dept: string, app_name: string) =>
    request<{ success: boolean; message: string }>(
      `/api/departments/${encodeURIComponent(dept)}/apps/blocked/remove`,
      { method: 'POST', body: JSON.stringify({ app_name }) },
    ),

  // Reports
  getUsersReport: () => request<UserData[]>('/api/reports/users'),
  getAppsReport: () => request<AppReport[]>('/api/reports/apps'),
  getComputersReport: () => request<ComputerReport[]>('/api/reports/computers'),
  getDepartmentsReport: () => request<DepartmentReport[]>('/api/reports/departments'),

  // App details
  getAppUsers: (app_name: string) =>
    request<{ app: string; entries: AppUserEntry[] }>(`/api/apps/${encodeURIComponent(app_name)}/users`),

  // Computer details
  getComputerUsers: (name: string) =>
    request<{ name: string; ip_address: string | null; users: ComputerUserEntry[] }>(
      `/api/computers/${encodeURIComponent(name)}/users`
    ),

  // Logs
  processLogs: (force_full = false) =>
    request<{ success: boolean; result: unknown }>('/api/logs/process', {
      method: 'POST',
      body: JSON.stringify({ force_full }),
    }),

  // Database maintenance
  getDbStats: () => request<{
    engine: string
    db_size: number
    tables: Record<string, number>
  }>('/api/db/stats'),
  vacuumDb: () => request<{ success: boolean; message: string }>(
    '/api/db/vacuum', { method: 'POST' }
  ),
  integrityCheck: () => request<{ success: boolean; ok: boolean; results: string[] }>(
    '/api/db/integrity-check', { method: 'POST' }
  ),
  clearLogs: (older_than_days?: number) => request<{ success: boolean; deleted: Record<string, number> }>(
    '/api/db/clear-logs',
    { method: 'POST', body: JSON.stringify(older_than_days != null ? { older_than_days } : { confirm_delete_all: true }) }
  ),

  // My permissions
  getMyPermissions: () => request<{ permissions: UserPermissions }>('/api/me/permissions'),

  // Scope options (for admin permission editor)
  getScopeOptions: () => request<{
    departments: string[]
    cities: string[]
    users: Array<{ username: string; display_name: string }>
  }>('/api/scope-options'),

  // Roles
  getRoles: () => request<{ roles: PermissionRole[] }>('/api/roles'),
  createRole: (data: { name: string; description: string; permissions: UserPermissions }) =>
    request<{ success: boolean; message: string }>('/api/roles/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRole: (name: string, data: { description?: string; permissions?: UserPermissions }) =>
    request<{ success: boolean; message: string }>(`/api/roles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteRole: (name: string) =>
    request<{ success: boolean; message: string }>(`/api/roles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  // Accounts management
  getAccounts: () => request<{ accounts: SystemAccount[] }>('/api/accounts'),
  createAccount: (data: { username: string; password: string; name: string; role: string }) =>
    request<{ success: boolean; message: string }>('/api/accounts/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAccount: (username: string, data: { name?: string; role?: string }) =>
    request<{ success: boolean; message: string }>(`/api/accounts/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  updateAccountPassword: (username: string, password: string) =>
    request<{ success: boolean; message: string }>(`/api/accounts/${encodeURIComponent(username)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),
  deleteAccount: (username: string) =>
    request<{ success: boolean; message: string }>(`/api/accounts/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  getAccountPermissions: (username: string) =>
    request<{ username: string; permissions: UserPermissions }>(`/api/accounts/${encodeURIComponent(username)}/permissions`),
  setAccountPermissions: (username: string, permissions: UserPermissions) =>
    request<{ success: boolean; message: string }>(`/api/accounts/${encodeURIComponent(username)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
}
