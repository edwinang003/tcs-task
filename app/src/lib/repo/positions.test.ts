import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import { appendPositionIn, positionBeforeIn } from './positions'
import { now } from './write'

const { workspaceId } = activeWorkspace()

async function seed(rows: Array<{ id: string; position: string; deleted?: boolean }>) {
  await db.tasks.bulkAdd(
    rows.map((row) => ({
      id: row.id,
      workspace_id: workspaceId,
      project_id: 'p',
      section_id: 'section-1',
      title: row.id,
      notes: null,
      due_on: null,
      due_time: null,
      reminder_at: null,
      reminder_sent_at: null,
      priority: 0 as const,
      completed_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      position: row.position,
      created_by: null,
      assignee_id: null,
      updated_at: now(),
      deleted_at: row.deleted === true ? now() : null,
      client_id: 'test',
    })),
  )
}

describe('positionBeforeIn', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
  })

  it('returns a key that sorts between the two neighbours', async () => {
    await seed([
      { id: 'first', position: 'a0' },
      { id: 'second', position: 'a1' },
      { id: 'mover', position: 'a2' },
    ])

    const key = await positionBeforeIn('section-1', 'second', 'mover')

    expect(key > 'a0').toBe(true)
    expect(key < 'a1').toBe(true)
  })

  it('appends when there is nothing to land before', async () => {
    await seed([
      { id: 'first', position: 'a0' },
      { id: 'mover', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', null, 'mover')

    expect(key > 'a0').toBe(true)
  })

  it('ignores the task being moved, which is still sitting in the list', async () => {
    // Without the exclusion the mover's own key is a neighbour of itself, and
    // `generateKeyBetween` throws on equal ends.
    await seed([
      { id: 'mover', position: 'a0' },
      { id: 'other', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', 'other', 'mover')

    expect(key < 'a1').toBe(true)
  })

  it('counts a tombstone as occupied, exactly as an append does', async () => {
    // Same rule as `appendPositionIn`: a deleted task's key is not free while
    // its undo offer still stands.
    await seed([
      { id: 'gone', position: 'a0', deleted: true },
      { id: 'mover', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', null, 'mover')
    const append = await appendPositionIn('section-1')

    expect(key > 'a0').toBe(true)
    expect(append > 'a0').toBe(true)
  })
})
