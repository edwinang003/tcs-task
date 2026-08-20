/**
 * What is due, and when.
 *
 * Pure and framework-free, for the same reason `grouping.ts` and `drag.ts`
 * are: the interesting rules in here are date rules, and date rules deserve a
 * test rather than a DOM. `at` is injected exactly as `dates.ts` injects it,
 * so "due today, read at one minute past midnight" is a unit test rather than
 * a clock mock.
 *
 * Every comparison is string arithmetic on `YYYY-MM-DD` (SPEC §4.1): a task
 * due Tuesday stays due Tuesday wherever you are.
 */
import { todayLocal, formatDue } from './dates'
import type { Project, Task } from './schema'

export interface AgendaGroup {
  key: string
  title: string
  tasks: Task[]
}

/**
 * The tasks an agenda view may show at all.
 *
 * Two rules beyond "has a due date". A task from an archived project is gone
 * from the drawer, so surfacing it here would be the one place the archive
 * leaked — and reading the same list the drawer reads also guarantees every
 * row has a name for its badge. And a task completed *today* stays: the view
 * has no Done section to move a ticked row into, so filtering on completion
 * alone would take the row off the screen under the user's thumb.
 */
function visible(tasks: Task[], projects: Project[], today: string): Task[] {
  const live = new Set(projects.map((p) => p.id))
  return tasks.filter(
    (task) =>
      task.due_on !== null &&
      live.has(task.project_id) &&
      (task.completed_at === null ||
        todayLocal(new Date(task.completed_at)) === today),
  )
}

/**
 * Down the clock, then by position.
 *
 * Untimed tasks come after timed ones on the same day rather than sorting to
 * midnight: "due Tuesday with no particular time is the common case"
 * (SPEC §4.1) and has no place in a time sequence. `position` breaks the
 * remaining ties so the order is total and does not shuffle between renders.
 */
function byDue(a: Task, b: Task): number {
  if (a.due_on !== b.due_on) return (a.due_on ?? '') < (b.due_on ?? '') ? -1 : 1
  if (a.due_time !== b.due_time) {
    if (a.due_time === null) return 1
    if (b.due_time === null) return -1
    return a.due_time < b.due_time ? -1 : 1
  }
  return a.position < b.position ? -1 : 1
}

function group(key: string, title: string, tasks: Task[]): AgendaGroup[] {
  return tasks.length === 0 ? [] : [{ key, title, tasks: tasks.sort(byDue) }]
}

/** Overdue pinned above what is due today, across every project (SPEC §5). */
export function todayAgenda(
  tasks: Task[],
  projects: Project[],
  at: Date = new Date(),
): AgendaGroup[] {
  const today = todayLocal(at)
  const rows = visible(tasks, projects, today)

  return [
    ...group('overdue', 'Overdue', rows.filter((t) => t.due_on! < today)),
    ...group('today', 'Today', rows.filter((t) => t.due_on === today)),
  ]
}

/**
 * Tomorrow to +7, one group per day.
 *
 * It starts at tomorrow so that nothing appears in both views: complementary
 * views cannot disagree, and ticking a task in one can never leave a stale
 * copy in the other. Empty days are omitted — seven headers over two tasks is
 * mostly furniture.
 */
export function upcomingAgenda(
  tasks: Task[],
  projects: Project[],
  at: Date = new Date(),
): AgendaGroup[] {
  const rows = visible(tasks, projects, todayLocal(at))

  const groups: AgendaGroup[] = []
  for (let offset = 1; offset <= 7; offset += 1) {
    // Built from parts so the month and year roll over on their own.
    const day = todayLocal(
      new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset),
    )
    // `formatDue` already spells a bare date as "Tomorrow" or "Sat 22 Aug",
    // which is exactly the heading wanted here.
    groups.push(
      ...group(day, formatDue(day, null, at)!, rows.filter((t) => t.due_on === day)),
    )
  }
  return groups
}
