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
 * Every live task matching every term, title band first.
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
  // Before touching the array: an empty query matches nothing, and this is
  // also the state the view spends most of its life in — an open field.
  if (want.length === 0) return []

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
    notesBand.push({ task, excerpt: null })
  }

  // Both bands were built in the order `tasks` arrived, which is position
  // order, and concatenating keeps it.
  return [...titleBand, ...notesBand]
}
