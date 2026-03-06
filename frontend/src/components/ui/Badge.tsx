interface BadgeProps {
  status: 'allowed' | 'blocked' | 'neutral'
  label?: string
}

const statusConfig = {
  allowed: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300', label: 'Разрешено' },
  blocked: { cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300', label: 'Заблокировано' },
  neutral: { cls: 'bg-gray-300 text-gray-800 dark:bg-slate-600 dark:text-slate-200', label: 'Нейтрально' },
}

export default function Badge({ status, label }: BadgeProps) {
  const cfg = statusConfig[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {label ?? cfg.label}
    </span>
  )
}
