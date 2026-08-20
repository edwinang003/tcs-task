/**
 * Where did I put that.
 *
 * Pure and DOM-free, like `agenda.ts` and `labelling.ts`, so every rule in
 * here is tested by calling it. `SearchList.tsx` is the seam that feeds it
 * rows.
 *
 * SPEC §5 decides the implementation before this file starts: "a
 * case-insensitive substring scan over titles and notes across a few thousand
 * rows is single-digit milliseconds. Build that, not an index." If it ever
 * stops being true, the replacement is an in-memory inverted index built at
 * load — never a server round trip, because a search that fails offline would
 * violate the app's central promise. Nothing outside this file would change.
 */
import type { Project, Task } from './schema'

export interface Hit {
  task: Task
  /**
   * The matching stretch of notes, for a hit that needed them. Null in the
   * title band, where the title is its own explanation.
   */
  excerpt: string | null
}

/**
 * The query, as the words it is made of.
 *
 * Exported to be tested on its own, and because "what counts as a term" is
 * the rule most likely to change: `@label` and `#project` tokens are 9b's
 * chips and P2's parser, and both start here.
 */
export function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

/** Every term present, in one already-lowercased haystack. */
function matchesAll(haystack: string, want: string[]): boolean {
  return want.every((term) => haystack.includes(term))
}

/**
 * How much of a note the row shows, and how much runs ahead of the match.
 *
 * 80 fits one line at 390px without the row's own truncation doing the
 * clipping instead; 24 is enough lead-in that the excerpt reads as a sentence
 * rather than starting mid-word.
 */
const WINDOW = 80
const LEAD = 24

/**
 * The matching stretch of a note, as one line.
 *
 * Plain text, with no highlight markup: marking the term inside a string that
 * has already been clipped means splitting on match boundaries, escaping, and
 * deciding what a half-cut highlight does — real machinery for emphasis a
 * phone renders at 13px. The line already answers the question it exists to
 * answer, which is *why is this row here*.
 */
export function excerptAround(notes: string, want: string[]): string | null {
  // Flattened before the search, so the indices below are indices into the
  // string that will actually be shown.
  const flat = notes.replace(/\s+/g, ' ').trim()
  const hay = flat.toLowerCase()

  let at = -1
  for (const term of want) {
    const found = hay.indexOf(term)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  // No term in the notes at all. `search` never reaches this — a notes-band
  // hit needed the notes for at least one term — but a caller handed an
  // arbitrary pair should get an honest answer rather than the first 80
  // characters of an unrelated note.
  if (at === -1) return null
  if (flat.length <= WINDOW) return flat

  // Pulled back off the end so the last window is a full one rather than a
  // stub, which is what makes the trailing ellipsis mean "there is more".
  let start = Math.min(Math.max(0, at - LEAD), flat.length - WINDOW)
  if (start > 0) {
    // Then forward to the next word. An excerpt opening mid-word — "…s
    // morning" — reads as a rendering fault rather than as a quotation, and
    // a phone showed exactly that the first time this ran against real
    // notes. Only when the boundary comes before the match: with no space
    // between here and the word you searched for, the lead-in is worth less
    // than a legible start, and the excerpt begins at the match itself.
    const space = flat.indexOf(' ', start)
    if (space !== -1 && space < at) start = space + 1
  }
  // Clamped, because the snap above may have pushed the window off the end.
  const end = Math.min(start + WINDOW, flat.length)
  return (
    (start > 0 ? '…' : '') +
    flat.slice(start, end) +
    (end < flat.length ? '…' : '')
  )
}

/**
 * Every live task matching every term, title band first.
 *
 * **No terms means no text constraint, not no results.** With an empty
 * query every live task lands in the title band with a null excerpt, which
 * is what lets a query made only of 9b's chips run through this same
 * function. The alternative was a second listing path in the view, and it
 * would have had to reimplement the two rules below — the failure mode when
 * those drift is an archived project's tasks showing up in one kind of
 * query but not the other. Whether an empty query is worth rendering is the
 * caller's decision; `SearchList` makes it with `terms` and `hasAny`.
 *
 * `projects` is the list the drawer reads, so an archived project's tasks are
 * absent for the same reason they are absent from Today: the archive is one
 * rule with one source. Completed tasks are *not* excluded — see the design,
 * decision 5.
 */
export function search(
  query: string,
  tasks: Task[],
  projects: Project[],
): Hit[] {
  const want = terms(query)
  const liveProjects = new Set(projects.map((project) => project.id))
  const titleBand: Hit[] = []
  const notesBand: Hit[] = []

  for (const task of tasks) {
    // SPEC §9: deletions are soft, so a tombstone is still a row. The reader
    // filters them too; doing it here as well means a caller that reaches
    // past the reader cannot get results that include deleted tasks.
    if (task.deleted_at !== null) continue
    if (!liveProjects.has(task.project_id)) continue

    const title = task.title.toLowerCase()
    if (matchesAll(title, want)) {
      titleBand.push({ task, excerpt: null })
      continue
    }

    if (task.notes === null) continue
    // Joined with a newline so no term can match across the seam between the
    // two fields and claim a word that exists in neither.
    if (!matchesAll(title + '\n' + task.notes.toLowerCase(), want)) continue
    notesBand.push({ task, excerpt: excerptAround(task.notes, want) })
  }

  // Both bands were built in the order `tasks` arrived, which is position
  // order, and concatenating keeps it.
  return [...titleBand, ...notesBand]
}
