/**
 * What went wrong, said out loud.
 *
 * Every mutation in this app is fired and forgotten — `void run().then(...)` —
 * so until now a rejected write vanished without a trace: no row, no message,
 * nothing in the UI to distinguish "it failed" from "you did not press it".
 * That is fine at a desk with DevTools open and useless on a phone, which is
 * exactly where the app is meant to live (SPEC §15).
 *
 * The same shape as `undo.ts` and `nav.ts`: a framework-free module singleton
 * read through `useSyncExternalStore`, so it is testable by calling it.
 *
 * One slot, not a queue. A second failure right after the first is almost
 * always the same cause, and a stack of toasts on a phone screen buries the
 * app it is complaining about.
 */

export interface Problem {
  /** What the user was trying to do: "Project not added". */
  what: string
  /** The error itself, as text a person can read out or paste. */
  detail: string
}

let problem: Problem | null = null
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

/** Returns the same object until it changes — see `nav.ts` on identity. */
export function getProblem(): Problem | null {
  return problem
}

/**
 * IndexedDB throws `DOMException`s whose `name` is the whole diagnosis —
 * `QuotaExceededError`, `ConstraintError` and `DatabaseClosedError` are three
 * unrelated problems whose messages often read the same. Dexie's own errors
 * follow the same convention, so the name leads.
 */
export function describeProblem(error: unknown): string {
  if (error instanceof Error) {
    if (!error.name) return error.message
    // Dexie's messages already open with the name; prefixing it again would
    // print the only word that matters twice.
    if (error.message.startsWith(error.name)) return error.message
    return `${error.name}: ${error.message}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return '[unserialisable value]'
  }
}

export function reportProblem(what: string, error: unknown): void {
  problem = { what, detail: describeProblem(error) }
  emit()
}

export function dismissProblem(): void {
  if (problem === null) return
  problem = null
  emit()
}
