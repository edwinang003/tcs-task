/**
 * List or board — per project, per device.
 *
 * The third module of this shape, after `undo.ts` and `nav.ts`: a
 * framework-free singleton over `localStorage`, read through
 * `useSyncExternalStore` (SPEC §11.3 rule 2 — "prefer ~40 lines you own to a
 * package").
 *
 * SPEC §4.1 is emphatic that this preference is *not* synced: "switching to
 * board view on the tablet silently switches the phone too — and the phone
 * almost always wants the list while the tablet wants the board. This is the
 * one place where 'the same data everywhere' is the wrong instinct." So it
 * never touches IndexedDB and never reaches the outbox.
 *
 * One key holding a map rather than a key per project, so that reading is one
 * parse and a corrupt value has exactly one place to be handled.
 */
const KEY = 'lane.view'

export type ViewMode = 'list' | 'board'

/**
 * What a stored string means.
 *
 * Exported because the module reads storage once, at import: a test that writes
 * to `localStorage` afterwards proves nothing about how a fresh tab would load.
 * Anything unrecognised is dropped rather than thrown — a display preference is
 * never worth a blank screen, and falling through to the default is a good
 * answer.
 */
export function parseViews(raw: string | null): Record<string, ViewMode> {
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const views: Record<string, ViewMode> = {}
  for (const [id, mode] of Object.entries(parsed as Record<string, unknown>)) {
    if (mode === 'list' || mode === 'board') views[id] = mode
  }
  return views
}

let views = parseViews(localStorage.getItem(KEY))
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Returns the same object until a choice actually changes.
 * `useSyncExternalStore` compares by identity and would loop forever on a
 * fresh object every call.
 */
export function getViews(): Record<string, ViewMode> {
  return views
}

export function setView(projectId: string, mode: ViewMode): void {
  if (views[projectId] === mode) return
  views = { ...views, [projectId]: mode }
  try {
    localStorage.setItem(KEY, JSON.stringify(views))
  } catch {
    // A full origin, or private mode. The view is switched for this session
    // and forgotten by the next, which is the whole cost. `reportProblem` is
    // for writes that lost your data, and this one lost a preference.
  }
  for (const listener of listeners) listener()
}

/**
 * Which view a project opens in.
 *
 * A stored choice always wins; the default is only ever a first answer. And
 * the default is the board — SPEC §8 rule 6 predicted the phone would want
 * the list, and P0b's touch-drag work settled it the other way: `dnd-kit`'s
 * touch sensor makes the board usable at 390px, one column at a time, and
 * the columns are the sections you already think in.
 *
 * `projects.default_view` is deliberately not consulted. Every row in the
 * database says 'list', because the column has a default and nothing in the
 * UI writes it — so honouring it here would make this default a no-op on
 * exactly the projects it is for. The column keeps its place and waits for
 * P1 to give it a writer.
 */
export function resolveView(stored: ViewMode | undefined): ViewMode {
  return stored ?? 'board'
}
