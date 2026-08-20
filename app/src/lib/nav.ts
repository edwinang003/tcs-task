/**
 * Where you are.
 *
 * SPEC §11.3 rule 2 — "prefer ~40 lines you own to a package" — already
 * rejected React Router once. This is the same shape as `undo.ts`: a
 * framework-free module singleton, read through `useSyncExternalStore`.
 *
 * Persisted, so reopening the installed app returns you to where you were
 * rather than to a default. One string holds it: `'today'`, `'upcoming'`, or a
 * project uuid. A uuid cannot collide with either word, so a value written by
 * the previous build still loads as a project route and no migration is needed.
 */
import { activeWorkspace } from './workspace'
import { todayLocal } from './dates'
import type { Project } from './schema'

const KEY = 'lane.route'

export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }

/**
 * What a stored string means.
 *
 * Exported because the module reads storage once, at import: a test that writes
 * to `localStorage` afterwards proves nothing about how a fresh tab would load,
 * and "a uuid written by the previous build still opens that project" is the
 * guarantee that lets this type change without a migration.
 */
export function parseStored(stored: string | null): Route {
  if (stored === 'today') return { kind: 'today' }
  if (stored === 'upcoming') return { kind: 'upcoming' }
  return {
    kind: 'project',
    projectId: stored ?? activeWorkspace().projectId,
  }
}

let route: Route = parseStored(localStorage.getItem(KEY))
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

function go(next: Route, stored: string): void {
  route = next
  localStorage.setItem(KEY, stored)
  for (const listener of listeners) listener()
}

export function openProject(projectId: string): void {
  if (route.kind === 'project' && route.projectId === projectId) return
  go({ kind: 'project', projectId }, projectId)
}

export function openView(kind: 'today' | 'upcoming'): void {
  if (route.kind === kind) return
  go({ kind }, kind)
}

/**
 * Where a captured task lands, and whether it arrives dated.
 *
 * A task typed into Today that landed undated in Inbox would vanish as you
 * finished typing, which reads as a bug and teaches people not to trust the
 * field — so Today dates it. Upcoming has no single obvious date to assume,
 * and guessing one would be the silent mis-dating SPEC §5.1 warns about.
 *
 * A rule about routes, so it lives here rather than as a branch inside
 * `QuickAdd`, where it could not be tested without a DOM.
 */
export function captureTarget(
  route: Route,
  at: Date = new Date(),
): { projectId: string; dueOn: string | null } {
  if (route.kind === 'project') {
    return { projectId: route.projectId, dueOn: null }
  }
  return {
    projectId: activeWorkspace().projectId,
    dueOn: route.kind === 'today' ? todayLocal(at) : null,
  }
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
  projectId: string,
): string {
  // `undefined` means the read has not answered yet. An empty list would
  // otherwise read as "your project is gone" and resolve to Inbox, so the
  // stored id is trusted until there is something to check it against.
  if (projects === undefined) return projectId
  const exists = projects.some((p) => p.id === projectId)
  return exists ? projectId : activeWorkspace().projectId
}
