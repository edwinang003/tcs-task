/**
 * Where you are — the React seam.
 *
 * `nav.ts` stores a route and `resolveProject` interprets the project branch of
 * it; this is the hook between them. It lives here rather than in `nav.ts` so
 * `nav.ts` stays framework-free and its tests keep running without a DOM.
 *
 * Every component that needs the route reads it through here. When the header
 * and the task list each worked it out for themselves they drifted: archiving a
 * project moved the header to Inbox while the list went on showing the archived
 * project's tasks.
 */
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listProjects } from './repo'
import { subscribe, getRoute, resolveProject } from './nav'
import type { Route } from './nav'
import type { Project } from './schema'

export interface Nav {
  /**
   * The route to render. A `project` route always names a project that
   * exists — a stored id whose project was archived or deleted resolves to
   * Inbox before any component sees it.
   */
  route: Route
  /** The open project's row, on a project route once `listProjects` answers. */
  project: Project | undefined
  /** Every live project, in position order — what the drawer lists. */
  projects: Project[]
  /** False until `listProjects` has answered once. */
  loaded: boolean
}

export function useRoute(): Nav {
  const stored = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])

  const route: Route =
    stored.kind === 'project'
      ? { kind: 'project', projectId: resolveProject(projects, stored.projectId) }
      : stored

  return {
    route,
    project:
      route.kind === 'project'
        ? projects?.find((p) => p.id === route.projectId)
        : undefined,
    projects: projects ?? [],
    loaded: projects !== undefined,
  }
}
