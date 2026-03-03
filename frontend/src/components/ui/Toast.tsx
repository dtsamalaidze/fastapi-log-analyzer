import { CheckCircle, XCircle, Info, X } from 'lucide-react'
import type { ToastType } from '../../context/ToastContext'

interface ToastProps {
  message: string
  type: ToastType
  onDismiss: () => void
}

const config = {
  success: { icon: CheckCircle, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  error: { icon: XCircle, cls: 'bg-red-50 border-red-200 text-red-800' },
  info: { icon: Info, cls: 'bg-blue-50 border-blue-200 text-blue-800' },
}

export default function Toast({ message, type, onDismiss }: ToastProps) {
  const { icon: Icon, cls } = config[type]
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full ${cls}`}>
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button onClick={onDismiss} className="flex-shrink-0 opacity-60 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
