import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './db'

describe('schema', () => {
  const dbs: { close(): void }[] = []
  afterEach(() => {
    for (const d of dbs) d.close()
    dbs.length = 0
  })

  it('is at version 5, with the seven tables', async () => {
    // Version 5 is a pure `stores` bump, like version 4: tables that have
    // never existed have no rows to backfill. `labels` carries a name index
    // because the drawer reads in that order and the picker checks it for a
    // duplicate before creating one.
    const db = createDb('lane-schema-test')
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(5)
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'checklist_items',
      'labels',
      'outbox',
      'projects',
      'sections',
      'task_labels',
      'tasks',
    ])
  })

  it('stops at version 1 when a ceiling is given', async () => {
    const db = createDb('lane-ceiling-test', 1)
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(1)
    expect(db.tables.map((t) => t.name)).toEqual(['tasks'])
  })

  it('gives the outbox an auto-incrementing primary key', async () => {
    const db = createDb('lane-seq-test')
    dbs.push(db)
    await db.open()
    const a = await db.outbox.add({
      table: 'tasks',
      row_id: 'a',
      columns: ['title'],
      status: 'pending',
      reason: null,
      created_at: '2026-08-18T00:00:00.000Z',
    } as never)
    const b = await db.outbox.add({
      table: 'tasks',
      row_id: 'b',
      columns: ['title'],
      status: 'pending',
      reason: null,
      created_at: '2026-08-18T00:00:00.000Z',
    } as never)
    expect(Number(b)).toBeGreaterThan(Number(a))
  })
})
