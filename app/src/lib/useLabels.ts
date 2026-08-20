/**
 * Which labels every task on screen carries — the React seam.
 *
 * `labelling.ts` does the grouping and is tested without a DOM; this is the
 * pair of live queries that feed it. The same split as `progress.ts`/
 * `useProgress.ts`, for the same reason.
 *
 * Returns both shapes of the same read: the grouping every row needs, and
 * the flat list a picker or 9b's filter row needs. One subscription, two
 * views of it.
 *
 * Called once per list, never per row: a hook inside `TaskRow` would be two
 * live queries per visible task.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listLabels, listAllTaskLabels } from './repo'
import { labelsByTask } from './labelling'
import type { Label } from './schema'

export interface Labelling {
  /** Task id → the labels it carries. Absent when it carries none. */
  byTask: Map<string, Label[]>
  /**
   * Every live label in the workspace, in name order — what a picker or a
   * filter row needs. Handed back rather than re-read: the query below was
   * already running for the grouping, and a second subscription to the same
   * table would be one too many for a value that is already in hand.
   */
  all: Label[]
}

// A stable empty. `?? []` would hand a fresh array to every consumer on
// every render while the read is in flight, invalidating their memos for
// nothing — `useCrossProject`'s rule, for the same reason.
const NONE: Label[] = []

export function useLabels(): Labelling {
  const labels = useLiveQuery(() => listLabels(), [])
  const links = useLiveQuery(() => listAllTaskLabels(), [])
  // Memoized on both query results so the map keeps its identity between
  // renders that changed nothing about the tagging.
  return useMemo(
    () => ({
      byTask: labelsByTask(links ?? [], labels ?? NONE),
      all: labels ?? NONE,
    }),
    [links, labels],
  )
}
