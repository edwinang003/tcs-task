/**
 * What every view that spans projects needs before it can draw anything.
 *
 * Today, Upcoming and a label route each subscribed to the same four things,
 * built the same project-name map and wrote the same loading guard. A search
 * view made it three copies, which is where the pattern has proved itself.
 *
 * A hook rather than a component, because `AgendaList` computes its groups
 * *from* these rows — it needs them in hand before it can render, and a
 * component that owned the subscriptions could only hand them back through a
 * render prop. The rows themselves are `CrossProjectRows`. This is the same
 * split as `progress.ts`/`useProgress.ts`, for the same reason.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTasks, listProjects } from './repo'
import { useProgress } from './useProgress'
import { useLabels } from './useLabels'
import type { Label, Project, Task } from './schema'
import type { Progress } from './progress'

export interface CrossProject {
  /** Every live task in the workspace, in position order. */
  tasks: Task[]
  /** Every live project, in position order — the archive is already gone. */
  projects: Project[]
  /** Project id → name, for the row badge. */
  names: Map<string, string>
  progress: Map<string, Progress>
  labels: Map<string, Label[]>
  /** False until both reads have answered once. */
  loaded: boolean
}

// Stable empties. `?? []` would hand a fresh array to every consumer on every
// render while the reads are in flight, invalidating their memos for nothing.
const NO_TASKS: Task[] = []
const NO_PROJECTS: Project[] = []

export function useCrossProject(): CrossProject {
  const tasks = useLiveQuery(() => listAllTasks(), [])
  const projects = useLiveQuery(() => listProjects(), [])
  const progress = useProgress()
  const labels = useLabels()

  const names = useMemo(
    () => new Map((projects ?? NO_PROJECTS).map((p) => [p.id, p.name])),
    [projects],
  )

  return {
    tasks: tasks ?? NO_TASKS,
    projects: projects ?? NO_PROJECTS,
    names,
    progress,
    labels,
    loaded: tasks !== undefined && projects !== undefined,
  }
}
