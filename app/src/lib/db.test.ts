import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './db'

describe('schema', () => {
  const dbs: { close(): void }[] = []
  afterEach(() => {
    for (const d of dbs) d.close()
    dbs.length = 0
  })

  it('is at version 3, with the four tables', async () => {
    // Version 3 adds no table and no index — it backfills `default_view` onto
    // project rows the previous build wrote, so the table list is version 2's.
    const db = createDb('lane-schema-test')
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(3)
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'outbox',
      'projects',
      'sections',
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
