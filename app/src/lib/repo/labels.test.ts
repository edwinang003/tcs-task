import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  addTask,
  createLabel,
  renameLabel,
  setLabelColor,
  deleteLabel,
  tagTask,
  untagTask,
  taskLabelId,
  listLabels,
  listTaskLabels,
  listAllTaskLabels,
} from './index'
import { activeWorkspace } from '../workspace'
import { PALETTE } from '../labelling'

const inbox = activeWorkspace().projectId

async function entriesFor(table: string, rowId: string) {
  return db.outbox.where('[table+row_id]').equals([table, rowId]).toArray()
}

describe('labels', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Opening seeds the Inbox project and its sections, each with an entry.
    await db.outbox.clear()
  })

  it('creates a label with its full sync column set and a palette colour', async () => {
    // SPEC §15: every row is created with its full sync column set, so that
    // P1 implements a transport rather than a migration.
    const created = await createLabel('errand')
    expect(created).not.toBeNull()

    expect(await db.labels.get(created!.id)).toMatchObject({
      name: 'errand',
      color: PALETTE[0],
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })
  })

  it('enqueues the label without server-owned columns', async () => {
    const created = await createLabel('errand')
    const [entry] = await entriesFor('labels', created!.id)

    expect(entry.table).toBe('labels')
    expect(entry.columns).toContain('name')
    expect(entry.columns).toContain('color')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('spreads colours across labels as they are created', async () => {
    await createLabel('one')
    await createLabel('two')
    const third = await createLabel('three')

    expect((await db.labels.get(third!.id))?.color).toBe(PALETTE[2])
  })

  it('refuses a label with no name', async () => {
    // Null rather than a throw: the picker's field is allowed to be empty,
    // and an empty submit is a normal intermediate state.
    expect(await createLabel('   ')).toBeNull()
    expect(await listLabels()).toHaveLength(0)
  })

  it('lists labels by name', async () => {
    await createLabel('zulu')
    await createLabel('alpha')

    expect((await listLabels()).map((l) => l.name)).toEqual(['alpha', 'zulu'])
  })

  it('renames and recolours a label, each undoably', async () => {
    const { id } = (await createLabel('erand'))!

    const renameUndo = await renameLabel(id, 'errand')
    expect((await db.labels.get(id))?.name).toBe('errand')
    await renameUndo!.apply()
    expect((await db.labels.get(id))?.name).toBe('erand')

    const colorUndo = await setLabelColor(id, 'violet')
    expect((await db.labels.get(id))?.color).toBe('violet')
    await colorUndo!.apply()
    expect((await db.labels.get(id))?.color).toBe(PALETTE[0])
  })

  it('derives a join row id from the pair, so two devices agree', async () => {
    // The decision this slice rests on. Two devices tagging the same task
    // with the same label offline must produce the SAME row id, so the push
    // upserts one onto the other instead of leaving a duplicate.
    expect(taskLabelId('task-1', 'label-1')).toBe('task-1.label-1')
  })

  it('tags a task with its full sync column set, under task_labels', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)

    const id = taskLabelId(taskId, labelId)
    expect(await db.task_labels.get(id)).toMatchObject({
      task_id: taskId,
      label_id: labelId,
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })

    const [entry] = await entriesFor('task_labels', id)
    expect(entry.table).toBe('task_labels')
    expect(entry.columns).toContain('label_id')
    expect(entry.columns).not.toContain('updated_at')
  })

  it('tags idempotently: tagging twice leaves one live row', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)
    // Null: nothing changed, so there is nothing to undo — and returning a
    // step here would evict the one the user is reaching for.
    expect(await tagTask(taskId, labelId)).toBeNull()

    expect(await db.task_labels.count()).toBe(1)
    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('untags by tombstoning, and re-tagging revives the same row', async () => {
    // The direct consequence of the derived id: untag and re-tag address one
    // row, so tagTask is an upsert with three real cases — absent, live, and
    // a tombstone to revive.
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    const id = taskLabelId(taskId, labelId)

    await tagTask(taskId, labelId)
    await untagTask(taskId, labelId)

    expect((await db.task_labels.get(id))?.deleted_at).not.toBeNull()
    expect(await listTaskLabels(taskId)).toHaveLength(0)

    await tagTask(taskId, labelId)

    expect((await db.task_labels.get(id))?.deleted_at).toBeNull()
    expect(await db.task_labels.count()).toBe(1)
  })

  it('undoes an untag by putting the label back', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)
    const undo = await untagTask(taskId, labelId)
    await undo!.apply()

    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('deleting a label tombstones its links and leaves the tasks alone', async () => {
    // SPEC §4.4: "Delete a label → task_labels rows tombstone; tasks are
    // untouched."
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    await deleteLabel(labelId)

    expect((await db.labels.get(labelId))?.deleted_at).not.toBeNull()
    expect(await listAllTaskLabels()).toHaveLength(0)
    expect((await db.tasks.get(taskId))?.deleted_at).toBeNull()
  })

  it('undoing a label delete restores it and its links', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    const undo = await deleteLabel(labelId)
    await undo!.apply()

    expect(await listLabels()).toHaveLength(1)
    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('undoing a label delete does not resurrect a link untagged earlier', async () => {
    // The case that makes the cascade read live rows only. Untag is itself a
    // tombstone, so a task untagged last week must not come back tagged
    // because the label was deleted today.
    const { id: kept } = await addTask('call the plumber', inbox)
    const { id: dropped } = await addTask('post the forms', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(kept, labelId)
    await tagTask(dropped, labelId)
    await untagTask(dropped, labelId)

    const undo = await deleteLabel(labelId)
    await undo!.apply()

    expect(await listTaskLabels(kept)).toHaveLength(1)
    expect(await listTaskLabels(dropped)).toHaveLength(0)
  })
})
