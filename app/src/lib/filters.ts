/**
 * Which tasks a set of chips lets through.
 *
 * Pure and DOM-free, like `search.ts`, `agenda.ts` and `labelling.ts`, so
 * every rule in here is tested by calling it. `FilterChips.tsx` is the seam
 * that sets it; `SearchList.tsx` the one that applies it.
 *
 * Runs *before* `search`, never inside it (design, decision 2): filters
 * narrow the corpus, `search` scores what survives, and neither has to know
 * what the other does. `search` keeps the tombstone and archived-project
 * rules, which is what makes them apply to a query made only of chips.
 */
import { todayLocal } from './dates'
import type { Label, Task } from './schema'

export type DatePreset = 'overdue' | 'today' | 'week' | 'none'

export interface Filters {
  /** OR within. A task has exactly one project, so ANDing two is empty. */
  projects: Set<string>
  /** AND within. SPEC §4: labels are tags a task carries many of. */
  labels: Set<string>
  /**
   * Single-select, and the two spellings are worth reading twice: `null`
   * means no date filter is on at all, `'none'` means filter *to* the tasks
   * that have no date.
   */
  date: DatePreset | null
}

/**
 * The state every search starts in.
 *
 * A constant rather than a factory: it is a `useState` initial value, and a
 * fresh object per render would invalidate the memo that depends on it on
 * every keystroke. Frozen because nothing may write to it — the chip row
 * replaces the whole object rather than mutating one, which is also why the
 * `Set`s inside are safe to share.
 */
export const NO_FILTERS: Filters = Object.freeze({
  projects: new Set<string>(),
  labels: new Set<string>(),
  date: null,
})

/** Whether anything is lit — "is this query active at all", for the view. */
export function hasAny(filters: Filters): boolean {
  return (
    filters.projects.size > 0 ||
    filters.labels.size > 0 ||
    filters.date !== null
  )
}

/** How far ahead `week` reaches, counting today as the first day. */
const WEEK = 7

/**
 * Whether one due date satisfies one preset.
 *
 * String arithmetic on `YYYY-MM-DD` throughout, which is what SPEC §4.1
 * buys: a task due Tuesday stays due Tuesday wherever you are, so comparing
 * two due dates is comparing two strings.
 */
function matchesDate(
  dueOn: string | null,
  preset: DatePreset,
  at: Date,
): boolean {
  if (preset === 'none') return dueOn === null
  if (dueOn === null) return false

  const today = todayLocal(at)
  if (preset === 'overdue') return dueOn < today
  if (preset === 'today') return dueOn === today

  // Built from parts so the month and the year roll over on their own when
  // the day overflows — `formatDue` computes tomorrow the same way.
  const end = todayLocal(
    new Date(at.getFullYear(), at.getMonth(), at.getDate() + WEEK - 1),
  )
  return dueOn >= today && dueOn <= end
}

/**
 * The tasks every lit chip lets through, in the order they arrived.
 *
 * `labelsByTask` is the grouping `useCrossProject` already holds, not the
 * raw link rows: it is built once per list, and re-deriving it inside this
 * pass would be the nested scan `tasksWithLabel` exists to avoid.
 *
 * Returns the same array it was given when nothing is lit, rather than a
 * copy — the caller memoizes on identity, and a fresh array per keystroke
 * would invalidate the search below it for nothing.
 */
export function applyFilters(
  tasks: Task[],
  filters: Filters,
  labelsByTask: Map<string, Label[]>,
  at: Date = new Date(),
): Task[] {
  if (!hasAny(filters)) return tasks

  return tasks.filter((task) => {
    if (filters.projects.size > 0 && !filters.projects.has(task.project_id)) {
      return false
    }

    if (filters.labels.size > 0) {
      const carried = new Set(
        (labelsByTask.get(task.id) ?? []).map((label) => label.id),
      )
      for (const wanted of filters.labels) {
        if (!carried.has(wanted)) return false
      }
    }

    if (filters.date !== null && !matchesDate(task.due_on, filters.date, at)) {
      return false
    }

    return true
  })
}
