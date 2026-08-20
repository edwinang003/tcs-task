/**
 * Where a drop lands.
 *
 * Pure and framework-free, for the same reason `grouping.ts` is: the
 * interesting rule in here deserves a test, not a DOM. It reads the
 * `SectionGroup[]` the list has already computed, so it needs no database
 * read and cannot disagree with what is on the screen.
 *
 * `dnd-kit` reports which id the pointer was over and nothing else. That id is
 * either a task or a section — a section is a drop target in its own right,
 * which is what makes an empty section, and the collapsed Done header,
 * something a thumb can hit.
 */
import type { SectionGroup } from './grouping'

export interface DropTarget {
  sectionId: string
  /** The task to land above; null means the end of the section. */
  beforeId: string | null
}

export function resolveDrop(
  groups: SectionGroup[],
  activeId: string,
  overId: string | null,
): DropTarget | null {
  // No target: the drag was cancelled, or ended over nothing.
  if (overId === null || overId === activeId) return null

  const from = groups.find((g) => g.tasks.some((t) => t.id === activeId))
  if (from === undefined) return null

  const container = groups.find((g) => g.section.id === overId)
  if (container !== undefined) {
    return { sectionId: container.section.id, beforeId: null }
  }

  const to = groups.find((g) => g.tasks.some((t) => t.id === overId))
  if (to === undefined) return null

  const overIndex = to.tasks.findIndex((t) => t.id === overId)
  const fromIndex = to === from ? from.tasks.findIndex((t) => t.id === activeId) : -1

  // Dragging down inside one section: the row under the thumb has already
  // shifted up into the gap, so the drop belongs below it rather than above.
  const beforeId =
    fromIndex !== -1 && fromIndex < overIndex
      ? (to.tasks[overIndex + 1]?.id ?? null)
      : overId

  return { sectionId: to.section.id, beforeId }
}
