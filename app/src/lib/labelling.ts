/**
 * Labels: the palette, and which ones a task carries.
 *
 * Pure and DOM-free, like `progress.ts` and `agenda.ts`, so all of it is
 * tested by calling it. `useLabels.ts` is the seam that feeds it rows.
 *
 * Named `labelling.ts` rather than `labels.ts` on purpose: `repo/labels.ts` is
 * the write path, and two files named `labels` doing opposite things is a
 * coin-flip every time someone opens one. The same reason `progress.ts` is not
 * called `checklist.ts`.
 */
import type { Label, TaskLabel } from './schema'

/**
 * The whole colour vocabulary. Eight is enough to tell labels apart at the
 * size of a dot and few enough that a person can hold them; more would make
 * two of them indistinguishable on a phone row, which is the only place the
 * colour has to do any work.
 */
export const PALETTE = [
  'rose',
  'amber',
  'lime',
  'teal',
  'sky',
  'indigo',
  'violet',
  'slate',
] as const

const ORDER = new Map<string, number>(PALETTE.map((key, i) => [key, i]))

/**
 * Every class the palette can produce, spelled out.
 *
 * Tailwind's compiler scans source text for class names, so a name built at
 * runtime from a stored key would be purged from the build and render as an
 * invisible dot. This lookup exists so every class is literally present in a
 * file the compiler reads.
 *
 * Each colour is a pair: the 500 that reads on white is too dark on
 * near-black, so the dark variant steps up to 400.
 */
const DOTS: Record<string, string> = {
  rose: 'bg-rose-500 dark:bg-rose-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  lime: 'bg-lime-500 dark:bg-lime-400',
  teal: 'bg-teal-500 dark:bg-teal-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
  indigo: 'bg-indigo-500 dark:bg-indigo-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  slate: 'bg-slate-500 dark:bg-slate-400',
}

const FALLBACK = 'bg-neutral-400 dark:bg-neutral-500'

/**
 * The classes for a stored key. An unknown one — a row from a future build, or
 * a hand-edited database — renders neutral rather than throwing: a label that
 * looks plain is a much better failure than a list that will not render.
 */
export function dotClasses(color: string): string {
  return DOTS[color] ?? FALLBACK
}

/**
 * The colour a new label takes.
 *
 * Assigned rather than chosen, because the fast path is typing a name into the
 * sheet and carrying on — a colour decision in the middle of that is one
 * nobody wants to make about a label they are inventing in passing.
 *
 * The least-used colour, ties broken by palette order. Pure, so it is tested
 * by calling it, and it spreads across the palette instead of repeating one
 * colour until it wraps.
 */
export function nextColor(existing: Label[]): string {
  const used = new Map<string, number>(PALETTE.map((key) => [key, 0]))
  for (const label of existing) {
    const count = used.get(label.color)
    // A colour outside the palette votes for nothing. It cannot be "used up",
    // and counting it would skew assignment away from a real colour.
    if (count !== undefined) used.set(label.color, count + 1)
  }

  let best: string = PALETTE[0]
  for (const key of PALETTE) {
    if ((used.get(key) ?? 0) < (used.get(best) ?? 0)) best = key
  }
  return best
}

/**
 * Which labels each task carries.
 *
 * A task with no labels is absent from the map rather than present as an empty
 * array — which is what lets `TaskRow` render nothing from an undefined prop,
 * with no length check spread across its callers. `progressByTask` does the
 * same thing for the same reason.
 */
export function labelsByTask(
  links: TaskLabel[],
  labels: Label[],
): Map<string, Label[]> {
  const byId = new Map(labels.map((label) => [label.id, label]))
  const grouped = new Map<string, Label[]>()

  for (const link of links) {
    // SPEC §9: deletions are soft, so a tombstone is still a row. The reader
    // filters them too; doing it here as well means a caller that reaches past
    // the reader cannot draw a dot for a label someone removed.
    if (link.deleted_at !== null) continue
    const label = byId.get(link.label_id)
    // A link whose label was deleted on another device. §4.4 says sync must
    // never silently discard a row because its parent moved — the link stays
    // in the table for P1, it simply draws nothing.
    if (label === undefined) continue
    const current = grouped.get(link.task_id)
    if (current === undefined) grouped.set(link.task_id, [label])
    else current.push(label)
  }

  // Sorted by palette so a row's dots keep their order when an unrelated
  // label is renamed, or when a link is rewritten and comes back in a
  // different position.
  const last = PALETTE.length
  for (const carried of grouped.values()) {
    carried.sort(
      (a, b) => (ORDER.get(a.color) ?? last) - (ORDER.get(b.color) ?? last),
    )
  }
  return grouped
}
