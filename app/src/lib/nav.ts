/**
 * Where you are.
 *
 * SPEC §11.3 rule 2 — "prefer ~40 lines you own to a package" — already
 * rejected React Router once. This is the same shape as `undo.ts`: a
 * framework-free module singleton, read through `useSyncExternalStore`.
 *
 * Persisted, so reopening the installed app returns you to the project you
 * were in rather than to a default. Slice 4 widens `Route` to a union with
 * `{ kind: 'today' }` and the drawer grows a group above the project list;
 * nothing else moves.
 */
import { activeWorkspace } from './workspace'
import type { Project } from './schema'

const KEY = 'lane.route'

export type Route = { kind: 'project'; projectId: string }

function load(): Route {
  return {
    kind: 'project',
    projectId: localStorage.getItem(KEY) ?? activeWorkspace().projectId,
  }
}

let route: Route = load()
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Returns the same object until the route actually changes.
 * `useSyncExternalStore` compares by identity and would loop forever on a
 * fresh object every call.
 */
export function getRoute(): Route {
  return route
}

export function openProject(projectId: string): void {
  if (route.kind === 'project' && route.projectId === projectId) return
  route = { kind: 'project', projectId }
  localStorage.setItem(KEY, projectId)
  for (const listener of listeners) listener()
}

/**
 * The project to actually show, given what is stored and what exists.
 *
 * Pure, and given the list the caller already has, so that "deleted on another
 * device" and "archived a moment ago" resolve through one branch: both simply
 * stop appearing in `listProjects`.
 */
export function resolveProject(
  projects: Project[] | undefined,
  current: Route,
): string {
  // `undefined` means the read has not answered yet. An empty list would
  // otherwise read as "your project is gone" and resolve to Inbox, so the
  // stored id is trusted until there is something to check it against.
  if (projects === undefined) return current.projectId
  const exists = projects.some((p) => p.id === current.projectId)
  return exists ? current.projectId : activeWorkspace().projectId
}
