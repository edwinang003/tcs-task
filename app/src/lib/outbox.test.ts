import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { appendOutbox } from './outbox'

/** Every append must happen inside a transaction the caller owns (SPEC §9.1). */
function append(table: 'tasks' | 'projects', rowId: string, columns: string[]) {
  return db.transaction('rw', db.outbox, () => appendOutbox(table, rowId, columns))
}

describe('appendOutbox', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Task 6 seeds the Inbox project and its sections into every fresh
    // database, entries and all. These tests are about the append itself.
    await db.outbox.clear()
  })

  it('coalesces repeated edits to one row into a single entry', async () => {
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-1', ['due_on'])

    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].columns.sort()).toEqual(['due_on', 'title'])
  })

  it('keeps the original seq when coalescing, so referential order survives', async () => {
    // SPEC §9.2: a project pushed after the tasks inside it fails the FK.
    await append('projects', 'project-1', ['name'])
    await append('tasks', 'task-1', ['title'])
    await append('projects', 'project-1', ['color'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => e.row_id)).toEqual(['project-1', 'task-1'])
  })

  it('keeps separate entries for separate rows, in append order', async () => {
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-2', ['title'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => e.row_id)).toEqual(['task-1', 'task-2'])
    expect(entries[1].seq).toBeGreaterThan(entries[0].seq)
  })

  it('never enqueues server-owned columns', async () => {
    // SPEC §4.1: a client that pushes a stale reminder_sent_at silently
    // un-sends a reminder.
    await append('tasks', 'task-1', ['title', 'updated_at', 'reminder_sent_at'])

    const entry = await db.outbox.toCollection().first()
    expect(entry!.columns).toEqual(['title'])
  })

  it('does not append an entry whose columns are all server-owned', async () => {
    await append('tasks', 'task-1', ['updated_at'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('does not coalesce into a parked entry', async () => {
    // SPEC §9.1: a parked entry keeps its reason for the user to see.
    await append('tasks', 'task-1', ['title'])
    await db.outbox.toCollection().modify({ status: 'parked', reason: 'over plan limit' })

    await append('tasks', 'task-1', ['notes'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ status: 'parked', reason: 'over plan limit' })
    expect(entries[1]).toMatchObject({ status: 'pending', columns: ['notes'] })
  })

  it('records entries as pending with a creation timestamp', async () => {
    await append('tasks', 'task-1', ['title'])
    const entry = await db.outbox.toCollection().first()
    expect(entry).toMatchObject({ table: 'tasks', row_id: 'task-1', status: 'pending', reason: null })
    expect(Date.parse(entry!.created_at)).not.toBeNaN()
  })
})
