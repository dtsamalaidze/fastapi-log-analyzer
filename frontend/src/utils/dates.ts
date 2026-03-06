type Period = 'yesterday' | 'week' | 'month' | 'custom' | null

export function getPeriodDates(
  period: Period,
  customFrom: string,
  customTo: string,
): { from: Date | null; to: Date | null } {
  if (!period) return { from: null, to: null }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (period === 'yesterday') {
    const from = new Date(today)
    from.setDate(from.getDate() - 1)
    const to = new Date(from)
    to.setHours(23, 59, 59, 999)
    return { from, to }
  }

  if (period === 'week') {
    const from = new Date(today)
    from.setDate(from.getDate() - 7)
    return { from, to: new Date() }
  }

  if (period === 'month') {
    const from = new Date(today)
    from.setMonth(from.getMonth() - 1)
    return { from, to: new Date() }
  }

  if (period === 'custom') {
    return {
      from: customFrom ? new Date(customFrom) : null,
      to: customTo ? new Date(customTo + 'T23:59:59') : null,
    }
  }

  return { from: null, to: null }
}
