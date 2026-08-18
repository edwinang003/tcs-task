import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { addTask, setTaskDone, renameTask, deleteTask, listTasks } from './repo'
import { activeWorkspace } from './workspace'

async function entriesFor(rowId: string) {
  return db.outbox.where('[table+row_id]').equals(['tasks', rowId]).toArray()
}

describe('repo', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Task 6 seeds the Inbox project and its sections on first open.
    await db.outbox.clear()
  })

  it('enqueues a new task with its full column set', async () => {
    const id = await addTask('buy milk')
    const [entry] = await entriesFor(id)

    expect(entry.columns).toContain('title')
    expect(entry.columns).toContain('workspace_id')
    expect(entry.columns).toContain('position')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('enqueues only the column each edit changed', async () => {
    const id = await addTask('buy milk')
    await db.outbox.clear()

    // `client_id` rides along on every write and is pushed with it — SPEC §9
    // has the server store which device wrote last so the others can skip
    // echoing their own changes. Only §4.1's server-owned columns are absent.
    await renameTask(id, 'buy oat milk')
    expect((await entriesFor(id))[0].columns).toEqual(['title', 'client_id'])

    await db.outbox.clear()
    await setTaskDone(id, true)
    expect((await entriesFor(id))[0].columns).toEqual(['completed_at', 'client_id'])
  })

  it('tombstones rather than removing, and enqueues deleted_at', async () => {
    const id = await addTask('buy milk')
    await db.outbox.clear()

    await deleteTask(id)

    expect(await db.tasks.get(id)).toBeDefined()
    expect((await entriesFor(id))[0].columns).toEqual(['deleted_at', 'client_id'])
    expect(await listTasks()).toHaveLength(0)
  })

  it('writes the row and its entry atomically', async () => {
    // SPEC §9.1: "A row written without its outbox entry is a silently lost
    // change." Force the append to fail and both halves must roll back.
    const id = await addTask('buy milk')
    await db.outbox.clear()

    const original = db.outbox.add
    // Dexie hands back its own PromiseExtended; the cast is the stub saying it
    // only needs to reject.
    db.outbox.add = (() =>
      Promise.reject(new Error('disk full'))) as unknown as typeof db.outbox.add
    try {
      await expect(renameTask(id, 'renamed')).rejects.toThrow('disk full')
    } finally {
      db.outbox.add = original
    }

    expect((await db.tasks.get(id))!.title).toBe('buy milk')
    expect(await db.outbox.count()).toBe(0)
  })

  it('stamps every write with this device and a fresh updated_at', async () => {
    const id = await addTask('buy milk')
    const before = (await db.tasks.get(id))!
    await renameTask(id, 'renamed')
    const after = (await db.tasks.get(id))!

    expect(after.client_id).toBe(before.client_id)
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at))
  })

  it('creates tasks in the active workspace, not a literal', async () => {
    const id = await addTask('buy milk')
    const task = (await db.tasks.get(id))!
    const { workspaceId, projectId, sectionId } = activeWorkspace()
    expect(task).toMatchObject({
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
    })
  })
})
