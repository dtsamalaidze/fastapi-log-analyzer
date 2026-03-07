import type { SortDir } from '../../types'

export default function SortIcon({
  field,
  current,
  dir,
}: {
  field: string
  current: string | null
  dir: SortDir
}) {
  if (field !== current) return <span className="text-gray-300 dark:text-slate-600 ml-1">↕</span>
  return <span className="text-indigo-600 dark:text-indigo-400 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}
