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

/**
 * Must be called inside the transaction that writes the key it returns — see
 * `addTask` and `moveTaskTo`, which wrap it in `batch()`. Read outside one,
 * two appends into the same section interleave, both see the same last key,
 * and both write it.
 *
 * Tombstones count. A deleted task's key is not free: the delete is undoable
 * for the length of the toast, and handing the key to the next task would put
 * two live rows on it the moment the user takes the delete back.
 */
export async function appendPositionIn(sectionId: string): Promise<string> {
  const tasks = await db.tasks.toArray()
  const positions = tasks
    .filter((task) => task.section_id === sectionId)
    .map((task) => task.position)
    .sort()
  return generateKeyBetween(positions.at(-1) ?? null, null)
}

/**
 * The key for a task landing directly above `beforeId`, or at the end when
 * that is null.
 *
 * Same two rules as `appendPositionIn`: call it inside the transaction that
 * writes the key, and count tombstones. `excludeId` is the task being moved —
 * it is still sitting in the list it is being dragged out of, and using its
 * own key as one of its neighbours makes `generateKeyBetween` throw.
 */
export async function positionBeforeIn(
  sectionId: string,
  beforeId: string | null,
  excludeId: string,
): Promise<string> {
  const tasks = await db.tasks.toArray()
  const siblings = tasks
    .filter((task) => task.section_id === sectionId && task.id !== excludeId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))

  const found = beforeId === null ? -1 : siblings.findIndex((t) => t.id === beforeId)
  const index = found === -1 ? siblings.length : found

  return generateKeyBetween(
    siblings[index - 1]?.position ?? null,
    siblings[index]?.position ?? null,
  )
}

/**
 * The key for an item appended to a task's checklist.
 *
 * A sibling of `appendPositionIn` rather than a parameter on it. The generic
 * version — a table name and a parent column — saves four lines and costs both
 * call sites their readability: `appendPositionIn(section.id)` says what it
 * does and `appendPositionIn('tasks', 'section_id', section.id)` does not.
 *
 * The same two rules apply: call it inside the transaction that writes the key
 * it returns, and count tombstones, because a delete is undoable for the
 * length of the toast.
 */
export async function appendItemPositionIn(taskId: string): Promise<string> {
  const items = await db.checklist_items.toArray()
  const positions = items
    .filter((item) => item.task_id === taskId)
    .map((item) => item.position)
    .sort()
  return generateKeyBetween(positions.at(-1) ?? null, null)
}
