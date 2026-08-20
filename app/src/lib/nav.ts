/**
 * Where you are.
 *
 * SPEC §11.3 rule 2 — "prefer ~40 lines you own to a package" — already
 * rejected React Router once. This is the same shape as `undo.ts`: a
 * framework-free module singleton, read through `useSyncExternalStore`.
 *
 * Persisted, so reopening the installed app returns you to where you were
 * rather than to a default. One string holds it: `'today'`, `'upcoming'`,
 * `` `label:<uuid>` ``, or a bare project uuid. A uuid cannot collide with
 * either word or with the prefix, so a value written by any previous build
 * still loads as the route it always meant and no migration is needed.
 */
import { activeWorkspace } from './workspace'
import { todayLocal } from './dates'
import type { Project, Label } from './schema'

const KEY = 'lane.route'

/**
 * Labels store as `label:<uuid>`; every other route stores as a bare word or a
 * bare uuid. A prefix rather than a second key, because the route is one
 * value: two keys could disagree about where you are, and the reconciliation
 * would have no right answer.
 */
const LABEL_PREFIX = 'label:'

export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'label'; labelId: string }

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
  // Ahead of the fallback on purpose: that fallback treats anything it does
  // not recognise as a project id, so a label reaching it would open a
  // project that does not exist.
  if (stored !== null && stored.startsWith(LABEL_PREFIX)) {
    return { kind: 'label', labelId: stored.slice(LABEL_PREFIX.length) }
  }
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

export function openLabel(labelId: string): void {
  if (route.kind === 'label' && route.labelId === labelId) return
  go({ kind: 'label', labelId }, LABEL_PREFIX + labelId)
}

/**
 * Where a captured task lands, and whether it arrives dated.
 *
 * A task typed into Today that landed undated in Inbox would vanish as you
 * finished typing, which reads as a bug and teaches people not to trust the
 * field — so Today dates it. Upcoming has no single obvious date to assume,
 * and guessing one would be the silent mis-dating SPEC §5.1 warns about.
 *
 * A label route is Upcoming's case with one more temptation: the label is
 * right there, and attaching it would be one line. It is not attached, for
 * the same reason.
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
    // A label route dates nothing, and — the part worth saying out loud —
    // tags nothing either. Auto-tagging a task typed while `waiting-on` is
    // open is defensible, and is the same silent metadata this function
    // already refuses to attach in Upcoming.
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

/**
 * The route to actually show, given a stored label id and what exists.
 *
 * `resolveProject`'s shape, with one difference that matters: a missing
 * project resolves to *another project*, but a missing label has no next-best
 * label to fall back to, so this returns a whole `Route` and lands on Inbox.
 *
 * Deleting the label you are looking at therefore needs no navigation of its
 * own — the label leaves `listLabels`, this resolves to Inbox, and undoing
 * the delete brings both the label and the route back.
 */
export function resolveLabel(
  labels: Label[] | undefined,
  labelId: string,
): Route {
  // `undefined` means the read has not answered yet — the same reasoning
  // `resolveProject` spells out.
  if (labels === undefined) return { kind: 'label', labelId }
  const exists = labels.some((l) => l.id === labelId)
  if (exists) return { kind: 'label', labelId }
  return { kind: 'project', projectId: activeWorkspace().projectId }
}
