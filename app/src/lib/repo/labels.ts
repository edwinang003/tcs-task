/**
 * Labels — cross-project tags, and the join rows that attach them.
 *
 * SPEC §4: "A task is in exactly one project and one section. Labels handle
 * everything cross-cutting." So a label is a name and a colour, and a
 * `task_labels` row is nothing but the pair it points at.
 *
 * That emptiness is what makes the join row's id derivable, which is this
 * slice's one real decision — see `taskLabelId`.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { nextColor } from '../labelling'
import { create, write, batch, composite, now } from './write'
import type { Label, TaskLabel } from '../schema'
import type { UndoStep } from '../undo'

/**
 * A join row's id, computed from the pair rather than generated.
 *
 * Two devices offline both tag the same task with the same label. With a
 * UUIDv7 that is two live rows asserting one fact, a dedupe on every read, and
 * a cleanup path P1 would have to grow. Computed, both devices produce the
 * same id and the push upserts one onto the other.
 *
 * `db.ts` already relies on this for the seeded workspace: "Every device
 * generates the same ids here, which is harmless — push upserts by row id, so
 * the second device collapses onto the first." A join row is the only other
 * row whose identity is fully determined by what it points at; every other
 * table has a name or a title two devices can legitimately differ on.
 */
export function taskLabelId(taskId: string, labelId: string): string {
  return `${taskId}.${labelId}`
}

/** Every live label, in the order the drawer and the picker draw them. */
export async function listLabels(): Promise<Label[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.labels
    .where('[workspace_id+name]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((label) => label.deleted_at === null)
}

/**
 * Every live join row in the workspace.
 *
 * One index read serves this and `listTaskLabels` both, exactly as
 * `listAllChecklistItems` does: the row dots span every task on screen, so a
 * second index keyed by task would be a second thing to keep correct for no
 * measured gain.
 */
export async function listAllTaskLabels(): Promise<TaskLabel[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.task_labels
    .where('[workspace_id+task_id]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  return rows.filter((link) => link.deleted_at === null)
}

/** One task's live join rows. */
export async function listTaskLabels(taskId: string): Promise<TaskLabel[]> {
  const rows = await listAllTaskLabels()
  return rows.filter((link) => link.task_id === taskId)
}

/**
 * Null rather than a throw for an empty name: the picker's field is allowed to
 * be empty, and submitting it is a normal intermediate state rather than a
 * failure — the same rule `renameChecklistItem` follows.
 */
export async function createLabel(
  name: string,
): Promise<{ id: string; undo: UndoStep } | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()

  // The colour is chosen inside the transaction that writes it, like a
  // position in `addChecklistItem`: the picker keeps focus, so a second label
  // can be submitted before the first has landed, and a colour read outside
  // would hand both of them the same one.
  const undo = await batch(['labels'], async () => {
    const row: Label = {
      id,
      workspace_id: workspaceId,
      name: trimmed,
      color: nextColor(await listLabels()),
      updated_at: now(),
      deleted_at: null,
      client_id: clientId(),
    }
    return create('labels', row, 'Label created')
  })

  return { id, undo }
}

export function renameLabel(
  id: string,
  name: string,
): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('labels', id, { name: trimmed }, 'Label renamed')
}

export function setLabelColor(
  id: string,
  color: string,
): Promise<UndoStep | null> {
  return write('labels', id, { color }, 'Label recoloured')
}

/**
 * SPEC §4.4: "Delete a label → `task_labels` rows tombstone; tasks are
 * untouched."
 *
 * The links are read live-only and the undo is built from exactly those. Untag
 * is itself a tombstone, so a task someone untagged last week must not come
 * back tagged because the label was deleted today.
 */
export async function deleteLabel(id: string): Promise<UndoStep | null> {
  return batch(['labels', 'task_labels'], async () => {
    const links = (await listAllTaskLabels()).filter((l) => l.label_id === id)
    const stamp = now()

    const steps: (UndoStep | null)[] = [
      await write('labels', id, { deleted_at: stamp }, 'Label deleted'),
    ]
    for (const link of links) {
      steps.push(
        await write(
          'task_labels',
          link.id,
          { deleted_at: stamp },
          'Label deleted',
        ),
      )
    }

    // One `deleted_at` for the whole gesture, so the tombstones agree about
    // when the label went away — the shape `deleteTask` established.
    return composite('Label deleted', steps, true)
  })
}

/**
 * An upsert, not an insert, because the id is a function of the pair.
 *
 * Three real cases: no row yet, a live row, and a tombstone to revive. The
 * last is reached after `deleteLabel` and after any plain untag, so it is not
 * an edge — it is the ordinary way a label comes back to a task.
 *
 * A live row returns null: nothing changed, and handing back a step would
 * evict the one the user is reaching for (SPEC §4.5's single level).
 */
export async function tagTask(
  taskId: string,
  labelId: string,
): Promise<UndoStep | null> {
  const id = taskLabelId(taskId, labelId)
  const { workspaceId } = activeWorkspace()

  return batch(['task_labels'], async () => {
    const existing = await db.task_labels.get(id)

    if (existing === undefined) {
      const row: TaskLabel = {
        id,
        workspace_id: workspaceId,
        task_id: taskId,
        label_id: labelId,
        updated_at: now(),
        deleted_at: null,
        client_id: clientId(),
      }
      return create('task_labels', row, 'Label added')
    }

    if (existing.deleted_at === null) return null
    return write('task_labels', id, { deleted_at: null }, 'Label added')
  })
}

/** SPEC §9: deletions are soft, here as everywhere. */
export function untagTask(
  taskId: string,
  labelId: string,
): Promise<UndoStep | null> {
  return write(
    'task_labels',
    taskLabelId(taskId, labelId),
    { deleted_at: now() },
    'Label removed',
  )
}
