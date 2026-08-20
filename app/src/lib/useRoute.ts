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
import { listProjects, listLabels } from './repo'
import { subscribe, getRoute, resolveProject, resolveLabel } from './nav'
import type { Route } from './nav'
import type { Project, Label } from './schema'

export interface Nav {
  /**
   * The route to render. A `project` route always names a project that
   * exists — a stored id whose project was archived or deleted resolves to
   * Inbox before any component sees it.
   *
   * A `label` route likewise always names a label that exists — one deleted
   * here or on another device resolves to Inbox before any component sees it.
   */
  route: Route
  /** The open project's row, on a project route once `listProjects` answers. */
  project: Project | undefined
  /** Every live project, in position order — what the drawer lists. */
  projects: Project[]
  /** Every live label, in name order — what the drawer lists. */
  labels: Label[]
  /** The open label's row, on a label route once `listLabels` answers. */
  label: Label | undefined
  /** False until `listProjects` has answered once. */
  loaded: boolean
}

export function useRoute(): Nav {
  const stored = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])
  const labels = useLiveQuery(() => listLabels(), [])

  // Both resolutions happen here rather than in the components, for the
  // reason this file's header gives: when the header and the list each
  // worked the route out for themselves, they drifted.
  let route: Route = stored
  if (stored.kind === 'project') {
    route = {
      kind: 'project',
      projectId: resolveProject(projects, stored.projectId),
    }
  } else if (stored.kind === 'label') {
    route = resolveLabel(labels, stored.labelId)
    // A label that resolved away lands on a project route, which then wants
    // the same existence check every project route gets.
    if (route.kind === 'project') {
      route = {
        kind: 'project',
        projectId: resolveProject(projects, route.projectId),
      }
    }
  }

  return {
    route,
    project:
      route.kind === 'project'
        ? projects?.find((p) => p.id === route.projectId)
        : undefined,
    projects: projects ?? [],
    labels: labels ?? [],
    label:
      route.kind === 'label'
        ? labels?.find((l) => l.id === route.labelId)
        : undefined,
    // Still the projects' read alone: `loaded` gates the header's title, and
    // a label route's title comes from `label`, which is undefined until its
    // own query answers.
    loaded: projects !== undefined,
  }
}
