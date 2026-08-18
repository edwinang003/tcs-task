/**
 * Which project is open — the one place that decides.
 *
 * `nav.ts` stores an id and `resolveProject` interprets it; this is the React
 * seam between them. It lives here rather than in `nav.ts` so `nav.ts` stays
 * framework-free and its tests keep running without a DOM.
 *
 * Every component that needs the open project reads it through this hook. When
 * the header and the task list each worked it out for themselves they drifted:
 * archiving a project moved the header to Inbox while the list went on showing
 * the archived project's tasks.
 */
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listProjects } from './repo'
import { subscribe, getRoute, resolveProject } from './nav'
import type { Project } from './schema'

export interface OpenProject {
  /** The project to read and write. Never undefined; falls back to Inbox. */
  projectId: string
  /** The row, once loaded. Undefined while `listProjects` is still in flight. */
  project: Project | undefined
  /** Every live project, in position order — what the drawer lists. */
  projects: Project[]
  /** False until `listProjects` has answered once. */
  loaded: boolean
}

export function useOpenProject(): OpenProject {
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])

  // Until the list arrives, an empty list would read as "your project is gone"
  // and resolve to Inbox, flashing Inbox on every load. Trust the stored id
  // until there is something to check it against.
  const projectId =
    projects === undefined ? route.projectId : resolveProject(projects, route)

  return {
    projectId,
    project: projects?.find((p) => p.id === projectId),
    projects: projects ?? [],
    loaded: projects !== undefined,
  }
}
