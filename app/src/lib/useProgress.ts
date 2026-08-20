/**
 * Checklist progress for every task on screen — the React seam.
 *
 * `progress.ts` does the counting and is tested without a DOM; this is the one
 * live query that feeds it. The same split as `nav.ts`/`useRoute.ts` and
 * `view.ts`/`useView.ts`, for the same reason.
 *
 * Called once per list, never per row: a hook inside `TaskRow` would be one
 * live query per visible task.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllChecklistItems } from './repo'
import { progressByTask, type Progress } from './progress'

export function useProgress(): Map<string, Progress> {
  const items = useLiveQuery(() => listAllChecklistItems(), [])
  // Memoized on the query result so the map keeps its identity between
  // renders that changed nothing about the checklists.
  return useMemo(() => progressByTask(items ?? []), [items])
}
