import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  totalPages: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize?: (s: number) => void
  pageSizeOptions?: number[]
}

export default function Pagination({
  page,
  totalPages,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizeOptions = [25, 50, 100],
}: Props) {
  if (totalPages <= 1 && total <= pageSizeOptions[0]) return null

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
      <span className="text-sm text-gray-500">
        {total === 0 ? 'Нет записей' : `${from}–${to} из ${total}`}
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`dots-${i}`} className="px-2 text-gray-400 text-sm select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={`min-w-[2rem] h-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {onPageSize && (
        <select
          value={pageSize}
          onChange={e => { onPageSize(Number(e.target.value)); onPage(1) }}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {pageSizeOptions.map(s => (
            <option key={s} value={s}>{s} / стр.</option>
          ))}
        </select>
      )}
    </div>
  )
}
