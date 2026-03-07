import type { AppEntry, StatusFilter, UserData } from '../types'

export interface FilterProps {
  dateFrom: Date | null
  dateTo: Date | null
  statusFilters: Set<StatusFilter>
}

export function exportCsv(headers: string[], rows: (string | number)[][], filename: string) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function filterApps(
  apps: AppEntry[],
  dateFrom: Date | null,
  dateTo: Date | null,
  statusFilters: Set<StatusFilter>,
): AppEntry[] {
  return apps.filter(app => {
    if (statusFilters.size > 0 && !statusFilters.has(app.status)) return false
    if (dateFrom !== null || dateTo !== null) {
      const dateStr = app.last_seen ?? app.first_launch
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) {
        if (dateFrom !== null && d < dateFrom) return false
        if (dateTo !== null && d > dateTo) return false
      }
    }
    return true
  })
}

export function matchesPeriod(dateStr: string | null | undefined, dateFrom: Date | null, dateTo: Date | null): boolean {
  if (dateFrom === null && dateTo === null) return true
  if (!dateStr) return true
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return true
  if (dateFrom !== null && d < dateFrom) return false
  if (dateTo !== null && d > dateTo) return false
  return true
}

export function userFio(u: UserData): string | null {
  const parts = [u.last_name, u.first_name, u.middle_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}
