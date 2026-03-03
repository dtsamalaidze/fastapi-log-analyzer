import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuth } from './useAuth'
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_VIEWER_PERMISSIONS } from '../types'
import type { UserPermissions } from '../types'

function mergePerms(base: UserPermissions, partial: Partial<UserPermissions>): UserPermissions {
  return {
    users: { ...base.users, ...(partial.users ?? {}) },
    departments: { ...base.departments, ...(partial.departments ?? {}) },
    apps_global: { ...base.apps_global, ...(partial.apps_global ?? {}) },
    apps_department: { ...base.apps_department, ...(partial.apps_department ?? {}) },
    reports: { ...base.reports, ...(partial.reports ?? {}) },
    logs: { ...base.logs, ...(partial.logs ?? {}) },
    accounts: { ...base.accounts, ...(partial.accounts ?? {}) },
    database: { ...base.database, ...(partial.database ?? {}) },
    pages: { ...base.pages, ...(partial.pages ?? {}) },
    report_types: { ...base.report_types, ...(partial.report_types ?? {}) },
    data_scope: {
      departments: partial.data_scope?.departments ?? base.data_scope.departments,
      cities: partial.data_scope?.cities ?? base.data_scope.cities,
      users: partial.data_scope?.users ?? base.data_scope.users,
    },
  }
}

export function usePermissions(): UserPermissions {
  const { user, authenticated } = useAuth()

  const { data } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: api.getMyPermissions,
    enabled: authenticated,
    staleTime: 60_000,
  })

  const base = user?.role === 'admin' ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_VIEWER_PERMISSIONS
  if (!data?.permissions) return base
  return mergePerms(base, data.permissions)
}
