/**
 * How far through a checklist a task is.
 *
 * Pure and DOM-free, like `agenda.ts` and `grouping.ts`, so the counting is
 * tested by calling it. `useProgress.ts` is the seam that feeds it rows.
 *
 * Named `progress.ts` rather than `checklist.ts` on purpose: `repo/checklist.ts`
 * is the write path, and two files named checklist doing opposite things is a
 * coin-flip every time someone opens one.
 */
import type { ChecklistItem } from './schema'

export interface Progress {
  done: number
  total: number
}

/**
 * A task with no items is absent from the map rather than present as 0/0 —
 * which is what lets `TaskRow` render nothing from an undefined prop, with no
 * `total > 0` check spread across its callers.
 */
export function progressByTask(items: ChecklistItem[]): Map<string, Progress> {
  const counts = new Map<string, Progress>()
  for (const item of items) {
    // SPEC §9: deletions are soft, so a tombstone is still a row. The reader
    // filters them out too; this function is handed rows and is honest about
    // them on its own, so a caller that reaches past the reader cannot get a
    // count that includes deleted items.
    if (item.deleted_at !== null) continue
    const count = counts.get(item.task_id) ?? { done: 0, total: 0 }
    counts.set(item.task_id, {
      done: count.done + (item.done ? 1 : 0),
      total: count.total + 1,
    })
  }
  return counts
}
