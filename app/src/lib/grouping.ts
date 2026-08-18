/**
 * How the list is divided.
 *
 * Pure and framework-free, because the interesting rule in here is SPEC §4.4's
 * — a task whose section no longer exists lands in the project's first section
 * rather than being dropped — and that deserves a test, not a DOM.
 *
 * Both inputs arrive in position order from `listSections` and `listTasks`;
 * this preserves that order rather than re-sorting.
 */
import type { Section, Task } from './schema'

export interface SectionGroup {
  section: Section
  tasks: Task[]
}

export function groupBySection(
  sections: Section[],
  tasks: Task[],
): SectionGroup[] {
  // The done section renders last however its key sorts: sections created
  // after the project was made can easily land above it.
  const ordered = [
    ...sections.filter((s) => !s.is_done_section),
    ...sections.filter((s) => s.is_done_section),
  ]
  if (ordered.length === 0) return []

  const groups = new Map(ordered.map((s) => [s.id, [] as Task[]]))
  const fallback = groups.get(ordered[0].id)!

  for (const task of tasks) {
    // SPEC §4.4: "Sync must never silently discard a row because its parent
    // moved." P1's first cross-device section delete produces exactly this row.
    ;(groups.get(task.section_id) ?? fallback).push(task)
  }

  return ordered.map((section) => ({ section, tasks: groups.get(section.id)! }))
}
