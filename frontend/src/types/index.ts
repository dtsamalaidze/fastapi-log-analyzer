export interface User {
  username: string
  role: 'admin' | 'viewer'
}

export interface AuthCheckResponse {
  authenticated: boolean
  user: User | null
}

export interface AppEntry {
  name: string
  first_launch: string
  last_seen: string | null
  launch_count: number
  status: 'allowed' | 'blocked' | 'neutral'
}

export interface UserData {
  username: string
  last_name: string | null
  first_name: string | null
  middle_name: string | null
  city: string | null
  address: string | null
  telegram: string | null
  department: string | null
  computers: string
  log_date: string
  total_apps: number
  total_launches: number
  allowed_count: number
  blocked_count: number
  neutral_count: number
  log_files_count: number
  apps: AppEntry[]
}

export interface Stats {
  total_users: number
  total_launches: number
  total_log_files: number
  total_unique_apps: number
  total_computers: number
  avg_launches_per_user: number
  avg_log_files_per_user: number
  top_apps: Array<{ name: string; count: number; users: number }>
  status_stats: { allowed: number; blocked: number; neutral: number }
}

export interface Department {
  name: string
  user_count: number
  allowed_count: number
  blocked_count: number
}

export interface DepartmentApps {
  department: string
  allowed: string[]
  blocked: string[]
  allowed_count: number
  blocked_count: number
}

export interface AppReport {
  name: string
  global_status: 'allowed' | 'blocked' | 'neutral'
  total_launches: number
  users_count: number
  computers_count: number
  first_seen: string
  last_seen: string
  status_counts: { allowed: number; blocked: number; neutral: number }
}

export interface ComputerReport {
  name: string
  ip_address: string | null
  users_count: number
  total_launches: number
  apps_count: number
  last_seen: string
  status_counts: { allowed: number; blocked: number; neutral: number }
}

export interface ComputerUserEntry {
  username: string
  last_name: string | null
  first_name: string | null
  middle_name: string | null
  department: string | null
}

export interface AppUserEntry {
  username: string
  last_name: string | null
  first_name: string | null
  middle_name: string | null
  computer: string
  full_path: string
  launch_count: number
}

export interface DepartmentReport {
  name: string
  users_count: number
  total_launches: number
  apps_count: number
  computers_count: number
  status_counts: { allowed: number; blocked: number; neutral: number }
  avg_launches_per_user: number
}

export type SortDir = 'asc' | 'desc'

// ===== Account Management =====

export interface DataScope {
  departments: string[]
  cities: string[]
  users: string[]
}

export interface UserPermissions {
  users: { view: boolean; edit_profile: boolean }
  departments: { view: boolean; edit: boolean }
  apps_global: { view: boolean; edit: boolean }
  apps_department: { view: boolean; edit: boolean }
  reports: { view: boolean }
  logs: { process: boolean }
  accounts: { manage: boolean }
  database: { view: boolean; manage: boolean }
  pages: { users: boolean; reports: boolean; apps: boolean; departments: boolean; database: boolean }
  report_types: { users: boolean; apps: boolean; computers: boolean; departments: boolean }
  data_scope: DataScope
}

export interface SystemAccount {
  username: string
  name: string
  role: 'admin' | 'viewer'
  created_at: string
  permissions: Partial<UserPermissions>
}

export interface PermissionRole {
  name: string
  description: string
  permissions: Partial<UserPermissions>
  is_builtin: boolean
  created_at: string
}

export const DEFAULT_ADMIN_PERMISSIONS: UserPermissions = {
  users: { view: true, edit_profile: true },
  departments: { view: true, edit: true },
  apps_global: { view: true, edit: true },
  apps_department: { view: true, edit: true },
  reports: { view: true },
  logs: { process: true },
  accounts: { manage: true },
  database: { view: true, manage: true },
  pages: { users: true, reports: true, apps: true, departments: true, database: true },
  report_types: { users: true, apps: true, computers: true, departments: true },
  data_scope: { departments: [], cities: [], users: [] },
}

export const DEFAULT_VIEWER_PERMISSIONS: UserPermissions = {
  users: { view: true, edit_profile: false },
  departments: { view: true, edit: false },
  apps_global: { view: true, edit: false },
  apps_department: { view: true, edit: false },
  reports: { view: true },
  logs: { process: false },
  accounts: { manage: false },
  database: { view: false, manage: false },
  pages: { users: true, reports: true, apps: false, departments: false, database: false },
  report_types: { users: true, apps: true, computers: true, departments: true },
  data_scope: { departments: [], cities: [], users: [] },
}
