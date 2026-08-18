/**
 * Undo. SPEC §4.5: "local, session-scoped, and single-level per action: the
 * previous value of the changed columns is held in memory and reapplied as an
 * ordinary new mutation. It is not a sync operation and it never rewinds the
 * outbox."
 *
 * In memory means a module singleton, not a table — it dies with the tab, by
 * design. Single-level means exactly one step: `undoLast` discards whatever
 * step its own write returns, because a redo that pushes an undo turns Ctrl+Z
 * into a toggle between two states.
 *
 * Deliberately free of React so it can be tested by calling it. The one
 * consumer subscribes through `useSyncExternalStore`.
 */

export interface UndoStep {
  /** What just happened, from the user's side: "Task deleted". */
  label: string
  /**
   * Whether the action took its result off the screen and therefore needs a
   * visible offer rather than only a keyboard shortcut. Slice 2 sets this on
   * deletes alone; slice 3 adds completion, once checking a task moves it into
   * the done section.
   */
  toast: boolean
  /** Reapplies the previous values as an ordinary new mutation. */
  apply: () => Promise<unknown>
}

let step: UndoStep | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUndo(): UndoStep | null {
  return step
}

/**
 * Accepts null so call sites can stay one line: repo returns null when the row
 * had already gone, and that must not clear the step the user is reaching for.
 */
export function pushUndo(next: UndoStep | null): void {
  if (next === null) return
  step = next
  emit()
}

export async function undoLast(): Promise<boolean> {
  const pending = step
  if (pending === null) return false
  // Emptied before the await: two fast Ctrl+Z presses must not both find it.
  step = null
  emit()
  await pending.apply()
  return true
}

export function clearUndo(): void {
  if (step === null) return
  step = null
  emit()
}
