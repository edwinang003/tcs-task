/**
 * Checklist items — sub-steps on a task, and nothing more.
 *
 * SPEC §4: "Checklist items are not tasks. They have no due date, no labels,
 * no detail view. This is what stops the app growing into a project-management
 * tool." So this file is deliberately smaller than `tasks.ts` and stays that
 * way: an item is a title, a boolean and a position.
 *
 * `done` is a boolean where a task carries `completed_at`, which is SPEC §4.1's
 * asymmetry, not an oversight — see the comment on the type.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { create, write, batch, now } from './write'
import { appendItemPositionIn } from './positions'
import type { ChecklistItem } from '../schema'
import type { UndoStep } from '../undo'

/**
 * Every live item in the workspace.
 *
 * One index read serves this and `listChecklistItems` both, exactly as
 * `listAllTasks` does for tasks: the row counters span every task on screen,
 * so a second index keyed by task would be a second thing to keep correct for
 * no measured gain.
 */
export async function listAllChecklistItems(): Promise<ChecklistItem[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.checklist_items
    .where('[workspace_id+task_id]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((item) => item.deleted_at === null)
}

/** One task's items, in the order they will be drawn. */
export async function listChecklistItems(taskId: string): Promise<ChecklistItem[]> {
  const rows = await listAllChecklistItems()
  return rows
    .filter((item) => item.task_id === taskId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))
}

export async function addChecklistItem(
  taskId: string,
  title: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a checklist item with no title')

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()

  // The position is derived inside the transaction that writes it, like
  // `addTask`: the add field keeps focus, so the next item can be submitted
  // before this one has landed, and read outside both would see the same key.
  const undo = await batch(['checklist_items'], async () => {
    const row: ChecklistItem = {
      id,
      workspace_id: workspaceId,
      task_id: taskId,
      title: trimmed,
      done: false,
      position: await appendItemPositionIn(taskId),
      updated_at: now(),
      deleted_at: null,
      client_id: clientId(),
    }
    return create('checklist_items', row, 'Item added')
  })

  return { id, undo }
}

/**
 * Ticking an item does nothing to the task it belongs to, even when it is the
 * last one. SPEC §4: checklist items are not tasks. Completing the parent on
 * your behalf is delightful once and wrong thereafter — you tick the last
 * sub-step to record that you did it and the task leaves the screen.
 */
export function setChecklistItemDone(
  id: string,
  done: boolean,
): Promise<UndoStep | null> {
  return write('checklist_items', id, { done }, done ? 'Item ticked' : 'Item unticked')
}

export function renameChecklistItem(
  id: string,
  title: string,
): Promise<UndoStep | null> {
  const trimmed = title.trim()
  // Null rather than a throw: the editor commits on a pause as well as on
  // blur, so an empty field is a normal intermediate state, not a failure.
  if (!trimmed) return Promise.resolve(null)
  return write('checklist_items', id, { title: trimmed }, 'Item renamed')
}

/**
 * SPEC §9: deletions are soft. The toast is on, because the item leaves a
 * sheet that stays open — and on a phone there is no Ctrl+Z to reach for.
 */
export function deleteChecklistItem(id: string): Promise<UndoStep | null> {
  return write('checklist_items', id, { deleted_at: now() }, 'Item deleted', true)
}
