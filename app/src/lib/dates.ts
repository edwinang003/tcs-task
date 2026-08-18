/**
 * Due dates, formatted and compared.
 *
 * SPEC §4.1: "Due dates are a date plus an optional time, not a timestamp …
 * a task due Tuesday should stay due Tuesday when you fly somewhere, which a
 * `timestamptz` will not do." So everything here is string arithmetic on
 * `YYYY-MM-DD` and `HH:MM`, which sort correctly as strings, and the only Date
 * involved is the caller's "now".
 *
 * No `Intl`, no date library — SPEC §11.3 rule 2.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar date, which is not the UTC one after teatime. */
export function todayLocal(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * Built from parts on purpose: `new Date('2026-08-18')` parses as UTC midnight,
 * which is the previous day for anyone west of Greenwich.
 */
function parseDay(dueOn: string): Date {
  const [y, m, d] = dueOn.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isOverdue(
  dueOn: string | null,
  dueTime: string | null,
  at: Date = new Date(),
): boolean {
  if (dueOn === null) return false
  const today = todayLocal(at)
  if (dueOn !== today) return dueOn < today
  // Due today with no time is not overdue until the day is out — SPEC §4.1's
  // "due Tuesday with no particular time is the common case".
  if (dueTime === null) return false
  return dueTime < `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function formatTime(dueTime: string): string {
  const [h, m] = dueTime.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${pad(m)}${suffix}`
}

export function formatDue(
  dueOn: string | null,
  dueTime: string | null,
  at: Date = new Date(),
): string | null {
  if (dueOn === null) return null

  const today = todayLocal(at)
  // Month and year roll over on their own when the day overflows.
  const tomorrow = todayLocal(
    new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1),
  )

  let label: string
  if (dueOn === today) {
    label = 'Today'
  } else if (dueOn === tomorrow) {
    label = 'Tomorrow'
  } else {
    const day = parseDay(dueOn)
    label = `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`
    if (day.getFullYear() !== at.getFullYear()) label += ` ${day.getFullYear()}`
  }

  return dueTime === null ? label : `${label}, ${formatTime(dueTime)}`
}
