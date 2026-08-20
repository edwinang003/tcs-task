import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  addTask,
  addChecklistItem,
  listChecklistItems,
  listAllChecklistItems,
  setChecklistItemDone,
  renameChecklistItem,
  deleteChecklistItem,
} from './index'
import { activeWorkspace } from '../workspace'

const inbox = activeWorkspace().projectId

async function entriesFor(rowId: string) {
  return db.outbox
    .where('[table+row_id]')
    .equals(['checklist_items', rowId])
    .toArray()
}

describe('checklist items', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Opening seeds the Inbox project and its sections, each with an entry.
    await db.outbox.clear()
  })

  it('creates an item with its full sync column set', async () => {
    // SPEC §15: "every row is created with its full sync column set", so that
    // P1 implements a transport rather than a migration.
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    expect(await db.checklist_items.get(id)).toMatchObject({
      task_id: taskId,
      title: 'passport',
      done: false,
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })
  })

  it('enqueues the item under checklist_items, without server-owned columns', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')
    const [entry] = await entriesFor(id)

    expect(entry.table).toBe('checklist_items')
    expect(entry.columns).toContain('task_id')
    expect(entry.columns).toContain('position')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('appends items in the order they were typed', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    await addChecklistItem(taskId, 'passport')
    await addChecklistItem(taskId, 'tickets')
    await addChecklistItem(taskId, 'chargers')

    expect((await listChecklistItems(taskId)).map((i) => i.title)).toEqual([
      'passport',
      'tickets',
      'chargers',
    ])
  })

  it('lists only the items of the task asked about', async () => {
    const { id: trip } = await addTask('pack for the trip', inbox)
    const { id: other } = await addTask('write the report', inbox)
    await addChecklistItem(trip, 'passport')
    await addChecklistItem(other, 'outline')

    expect((await listChecklistItems(trip)).map((i) => i.title)).toEqual(['passport'])
    expect(await listAllChecklistItems()).toHaveLength(2)
  })

  it('refuses an item with no title', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    await expect(addChecklistItem(taskId, '   ')).rejects.toThrow()
    expect(await listChecklistItems(taskId)).toHaveLength(0)
  })

  it('ticks an item, and the step unticks it', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await setChecklistItemDone(id, true)
    expect((await db.checklist_items.get(id))?.done).toBe(true)

    await step?.apply()
    expect((await db.checklist_items.get(id))?.done).toBe(false)
  })

  it('renames an item, and the step puts the old title back', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await renameChecklistItem(id, 'passport + visa')
    expect((await db.checklist_items.get(id))?.title).toBe('passport + visa')

    await step?.apply()
    expect((await db.checklist_items.get(id))?.title).toBe('passport')
  })

  it('refuses to rename an item to nothing', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    // Null, not a thrown error: the sheet commits on a pause and on blur, so
    // an empty field is a normal intermediate state rather than a failure.
    expect(await renameChecklistItem(id, '  ')).toBeNull()
    expect((await db.checklist_items.get(id))?.title).toBe('passport')
  })

  it('deletes softly, and the step brings the item back', async () => {
    // SPEC §9: deletions are soft, so a device offline for a week learns about
    // the deletion instead of resurrecting the row.
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await deleteChecklistItem(id)
    expect(await db.checklist_items.get(id)).toBeDefined()
    expect(await listChecklistItems(taskId)).toHaveLength(0)

    await step?.apply()
    expect(await listChecklistItems(taskId)).toHaveLength(1)
  })
})
