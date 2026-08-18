/**
 * Where a task lands when it arrives in a section.
 *
 * Its own file because both `tasks.ts` and `sections.ts` need it — completing
 * a task, and moving tasks out of a section being deleted — while `tasks.ts`
 * already imports `sections.ts`. Putting it in either would be an import
 * cycle.
 *
 * SPEC §4.2: positions are one fractional-index space per workspace. Ordering
 * only ever matters *within* a section, and an append always derives from that
 * section's own last key, so keys within a section stay distinct even though
 * two tasks in different sections may compare in any order.
 */
import { db } from '../db'
import { generateKeyBetween } from '../fractional-indexing'

export async function appendPositionIn(sectionId: string): Promise<string> {
  const tasks = await db.tasks.toArray()
  const positions = tasks
    .filter((task) => task.section_id === sectionId && task.deleted_at === null)
    .map((task) => task.position)
    .sort()
  return generateKeyBetween(positions.at(-1) ?? null, null)
}
