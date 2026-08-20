/**
 * Which labels every task on screen carries — the React seam.
 *
 * `labelling.ts` does the grouping and is tested without a DOM; this is the
 * pair of live queries that feed it. The same split as `progress.ts`/
 * `useProgress.ts`, for the same reason.
 *
 * Called once per list, never per row: a hook inside `TaskRow` would be two
 * live queries per visible task.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listLabels, listAllTaskLabels } from './repo'
import { labelsByTask } from './labelling'
import type { Label } from './schema'

export function useLabels(): Map<string, Label[]> {
  const labels = useLiveQuery(() => listLabels(), [])
  const links = useLiveQuery(() => listAllTaskLabels(), [])
  // Memoized on both query results so the map keeps its identity between
  // renders that changed nothing about the tagging.
  return useMemo(() => labelsByTask(links ?? [], labels ?? []), [links, labels])
}
