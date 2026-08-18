import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  addTask, setTaskDone, renameTask, deleteTask, listTasks,
  getTask, setTaskNotes, setTaskDue, setTaskPriority,
  setTaskSection, setTaskProject,
  addProject, addSection, doneSectionOf, firstOpenSectionOf,
} from './index'
import { activeWorkspace } from '../workspace'

const inbox = activeWorkspace().projectId

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
    const { id } = await addTask('buy milk', inbox)
    const [entry] = await entriesFor(id)

    expect(entry.columns).toContain('title')
    expect(entry.columns).toContain('workspace_id')
    expect(entry.columns).toContain('position')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('enqueues only the column each edit changed', async () => {
    const { id } = await addTask('buy milk', inbox)
    await db.outbox.clear()

    // `client_id` rides along on every write and is pushed with it — SPEC §9
    // has the server store which device wrote last so the others can skip
    // echoing their own changes. Only §4.1's server-owned columns are absent.
    await renameTask(id, 'buy oat milk')
    expect((await entriesFor(id))[0].columns).toEqual(['title', 'client_id'])

    // setTaskDone is exercised separately: SPEC §4 has it write three columns
    // together, not one, so it would not fit this test's point.
    await db.outbox.clear()
    await setTaskPriority(id, 2)
    expect((await entriesFor(id))[0].columns).toEqual(['priority', 'client_id'])
  })

  it('tombstones rather than removing, and enqueues deleted_at', async () => {
    const { id } = await addTask('buy milk', inbox)
    await db.outbox.clear()

    await deleteTask(id)

    expect(await db.tasks.get(id)).toBeDefined()
    expect((await entriesFor(id))[0].columns).toEqual(['deleted_at', 'client_id'])
    expect(await listTasks(inbox)).toHaveLength(0)
  })

  it('writes the row and its entry atomically', async () => {
    // SPEC §9.1: "A row written without its outbox entry is a silently lost
    // change." Force the append to fail and both halves must roll back.
    const { id } = await addTask('buy milk', inbox)
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
    const { id } = await addTask('buy milk', inbox)
    const before = (await db.tasks.get(id))!
    await renameTask(id, 'renamed')
    const after = (await db.tasks.get(id))!

    expect(after.client_id).toBe(before.client_id)
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at))
  })

  it('creates tasks in the active workspace, not a literal', async () => {
    const { id } = await addTask('buy milk', inbox)
    const task = (await db.tasks.get(id))!
    const { workspaceId, projectId, sectionId } = activeWorkspace()
    expect(task).toMatchObject({
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
    })
  })

  it('hands back a step that restores exactly the columns it changed', async () => {
    const { id } = await addTask('buy milk', inbox)
    const before = (await db.tasks.get(id))!

    const undo = await renameTask(id, 'buy oat milk')
    expect((await db.tasks.get(id))!.title).toBe('buy oat milk')

    await undo!.apply()
    expect((await db.tasks.get(id))!.title).toBe('buy milk')
    // The restore is a new write, so it carries a new stamp rather than the
    // old one — SPEC §4.1 makes `updated_at` server-owned.
    expect(Date.parse((await db.tasks.get(id))!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before.updated_at),
    )
  })

  it('undoes a delete by clearing the tombstone', async () => {
    const { id } = await addTask('buy milk', inbox)
    const undo = await deleteTask(id)
    expect(await listTasks(inbox)).toHaveLength(0)

    await undo!.apply()
    expect(await listTasks(inbox)).toHaveLength(1)
  })

  it('undoes an add by tombstoning it', async () => {
    const { id, undo } = await addTask('buy milk', inbox)
    await undo.apply()

    expect(await listTasks(inbox)).toHaveLength(0)
    // A tombstone, not a removal: a device that already saw the row has to
    // learn it is gone (SPEC §9).
    expect(await db.tasks.get(id)).toBeDefined()
  })

  it('does not rewind the outbox — the undo is an ordinary new mutation', async () => {
    // SPEC §4.5: "it never rewinds the outbox — an undo that shipped after its
    // own edit already pushed would race the server."
    const { id } = await addTask('buy milk', inbox)
    await db.outbox.clear()

    const undo = await renameTask(id, 'buy oat milk')
    const [afterEdit] = await entriesFor(id)
    expect(afterEdit.columns).toEqual(['title', 'client_id'])

    await undo!.apply()
    const entries = await entriesFor(id)
    // Coalesced into the same entry, at the same seq, because the dirty column
    // set did not change (SPEC §9.1, §9.2). What matters is that it is still
    // there and still says the row is dirty.
    expect(entries).toHaveLength(1)
    expect(entries[0].seq).toBe(afterEdit.seq)
    expect(entries[0].columns).toEqual(['title', 'client_id'])
  })

  it('marks completion and delete, but not a rename, for a toast', async () => {
    const { id } = await addTask('buy milk', inbox)
    expect((await renameTask(id, 'renamed'))!.toast).toBe(false)
    // SPEC §4: completing a task moves it into the done section, which takes
    // it off the screen the same way a delete does.
    expect((await setTaskDone(id, true))!.toast).toBe(true)
    expect((await deleteTask(id))!.toast).toBe(true)
  })

  it('returns null for a row that is not there', async () => {
    expect(await renameTask('01920000-0000-7000-8000-0000000000ff', 'ghost')).toBeNull()
  })

  it('reads a single task, tombstones included', async () => {
    const { id } = await addTask('buy milk', inbox)
    expect((await getTask(id))!.title).toBe('buy milk')
    await deleteTask(id)
    // The sheet may still be open over a task that was just deleted; that is
    // the reader's problem, not this function's.
    expect(await getTask(id)).toBeDefined()
    expect(await getTask('01920000-0000-7000-8000-0000000000ff')).toBeUndefined()
  })

  it('stores notes, and stores emptiness as null rather than ""', async () => {
    const { id } = await addTask('buy milk', inbox)
    await setTaskNotes(id, '  the oat one  ')
    expect((await getTask(id))!.notes).toBe('the oat one')

    await setTaskNotes(id, '   ')
    // SPEC §4.1 types it `string | null`; two spellings of empty is one too
    // many for the server to reason about.
    expect((await getTask(id))!.notes).toBeNull()
  })

  it('writes due date and time together, and clears the time with the date', async () => {
    const { id } = await addTask('buy milk', inbox)
    await db.outbox.clear()

    await setTaskDue(id, '2026-08-21', '17:00')
    expect(await getTask(id)).toMatchObject({ due_on: '2026-08-21', due_time: '17:00' })
    expect((await entriesFor(id))[0].columns).toEqual(['due_on', 'due_time', 'client_id'])

    // A time with no date is not a due date, it is a fragment.
    await setTaskDue(id, null, '17:00')
    expect(await getTask(id)).toMatchObject({ due_on: null, due_time: null })
  })

  it('restores both due columns on undo', async () => {
    const { id } = await addTask('buy milk', inbox)
    await setTaskDue(id, '2026-08-21', '17:00')

    const undo = await setTaskDue(id, '2026-08-22', null)
    await undo!.apply()
    expect(await getTask(id)).toMatchObject({ due_on: '2026-08-21', due_time: '17:00' })
  })

  it('stores priority, including a real zero', async () => {
    const { id } = await addTask('buy milk', inbox)
    await setTaskPriority(id, 2)
    expect((await getTask(id))!.priority).toBe(2)

    // SPEC §4.1: "the default is a real zero rather than a magic sentinel."
    const undo = await setTaskPriority(id, 0)
    expect((await getTask(id))!.priority).toBe(0)
    await undo!.apply()
    expect((await getTask(id))!.priority).toBe(2)
  })

  it('scopes the list to one project', async () => {
    const { id: other } = await addProject('Work')
    const { id: here } = await addTask('mow the lawn', inbox)
    const { id: there } = await addTask('email the accountant', other)

    const ids = (await listTasks(inbox)).map((t) => t.id)
    expect(ids).toContain(here)
    expect(ids).not.toContain(there)
  })

  it('adds a task into the project\'s first open section', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(inbox)).id,
    )
  })

  // SPEC §4: "completed_at and section_id are always written together, never
  // independently."
  it('moves a completed task into the done section, in one outbox entry', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    await db.outbox.clear()

    await setTaskDone(id, true)

    const task = await getTask(id)
    expect(task?.completed_at).not.toBeNull()
    expect(task?.section_id).toBe((await doneSectionOf(inbox)).id)

    const [entry] = await entriesFor(id)
    expect(entry.columns).toContain('completed_at')
    expect(entry.columns).toContain('section_id')
    expect(entry.columns).toContain('position')
  })

  it('undoes a completion back to the exact section and position', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id } = await addTask('clear the shed', inbox)
    await setTaskSection(id, weekend)
    const before = await getTask(id)

    const undo = await setTaskDone(id, true)
    await undo!.apply()

    const after = await getTask(id)
    expect(after?.section_id).toBe(weekend)
    expect(after?.position).toBe(before?.position)
    expect(after?.completed_at).toBeNull()
  })

  it('sends a manual uncheck to the first open section', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id } = await addTask('clear the shed', inbox)
    await setTaskSection(id, weekend)
    await setTaskDone(id, true)

    await setTaskDone(id, false)

    // Nothing on the row remembers where it was; only undo restores that.
    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(inbox)).id,
    )
  })

  it('offers a toast on completion but not on reopening', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    expect((await setTaskDone(id, true))?.toast).toBe(true)
    expect((await setTaskDone(id, false))?.toast).toBe(false)
  })

  // The binding is two-way: the Section picker is the non-drag equivalent of
  // dragging a task into the done column.
  it('completes a task moved into the done section by the picker', async () => {
    const { id } = await addTask('mow the lawn', inbox)

    await setTaskSection(id, (await doneSectionOf(inbox)).id)

    expect((await getTask(id))?.completed_at).not.toBeNull()
  })

  it('reopens a task moved out of the done section by the picker', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    await setTaskDone(id, true)

    await setTaskSection(id, (await firstOpenSectionOf(inbox)).id)

    expect((await getTask(id))?.completed_at).toBeNull()
  })

  it('keeps the original completion time when a done task moves', async () => {
    const { id: other } = await addProject('Work')
    const { id } = await addTask('mow the lawn', inbox)
    await setTaskDone(id, true)
    const completedAt = (await getTask(id))?.completed_at

    await setTaskProject(id, other)

    const moved = await getTask(id)
    // P2's completed log should read when the work was finished, not when the
    // row was last touched.
    expect(moved?.completed_at).toBe(completedAt)
    expect(moved?.project_id).toBe(other)
    expect(moved?.section_id).toBe((await doneSectionOf(other)).id)
  })

  it('moves an open task to the target project\'s first open section', async () => {
    const { id: other } = await addProject('Work')
    const { id } = await addTask('mow the lawn', inbox)

    await setTaskProject(id, other)

    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(other)).id,
    )
  })
})
