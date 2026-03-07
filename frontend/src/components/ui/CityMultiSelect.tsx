import { useState, useRef, useEffect } from 'react'
import { MapPin, ChevronDown, Check } from 'lucide-react'

export default function CityMultiSelect({
  cities,
  selected,
  onChange,
}: {
  cities: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (city: string) => {
    const next = new Set(selected)
    next.has(city) ? next.delete(city) : next.add(city)
    onChange(next)
  }

  const label =
    selected.size === 0
      ? 'Все города'
      : selected.size === 1
      ? Array.from(selected)[0]
      : `${selected.size} города выбрано`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
          selected.size > 0
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400'
        }`}
      >
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-lg min-w-[200px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => onChange(new Set())}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
              selected.size === 0 ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 dark:border-slate-500'
            }`}>
              {selected.size === 0 && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className={selected.size === 0 ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-gray-700 dark:text-slate-300'}>Все города</span>
          </button>
          <div className="border-t border-gray-100 dark:border-slate-700 my-1" />
          {cities.map(city => {
            const checked = selected.has(city)
            return (
              <button
                key={city}
                onClick={() => toggle(city)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 dark:border-slate-500'
                }`}>
                  {checked && <Check className="w-3 h-3 text-white" />}
                </span>
                {city}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
