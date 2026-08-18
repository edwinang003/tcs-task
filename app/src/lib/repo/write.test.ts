import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import { batch, create, write, composite, now } from './write'

function projectRow(id: string) {
  const { workspaceId } = activeWorkspace()
  return {
    id,
    workspace_id: workspaceId,
    name: 'Temporary',
    color: null,
    icon: null,
    position: 'a5',
    archived_at: null,
    updated_at: now(),
    deleted_at: null,
    client_id: 'test',
  }
}

describe('write primitives', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    await db.outbox.clear()
  })

  // The whole design of `addProject` and `deleteSection` rests on Dexie
  // joining an inner transaction to an outer one. If it ever stops doing
  // that, a half-built project reaches the database and this test says so.
  it('rolls back both the row and its outbox entry when a batch fails', async () => {
    await expect(
      batch(['projects'], async () => {
        await create('projects', projectRow('roll-me-back'), 'Project added')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await db.projects.get('roll-me-back')).toBeUndefined()
    const entries = await db.outbox
      .where('[table+row_id]')
      .equals(['projects', 'roll-me-back'])
      .toArray()
    expect(entries).toHaveLength(0)
  })

  it('commits every row in a batch that succeeds', async () => {
    await batch(['projects'], async () => {
      await create('projects', projectRow('one'), 'Project added')
      await create('projects', projectRow('two'), 'Project added')
    })

    expect(await db.projects.get('one')).toBeDefined()
    expect(await db.projects.get('two')).toBeDefined()
  })

  it('reverses a composite step newest-first', async () => {
    const order: string[] = []
    const step = composite('Batch', [
      { label: 'a', toast: false, apply: async () => void order.push('a') },
      { label: 'b', toast: false, apply: async () => void order.push('b') },
    ])

    await step.apply()

    expect(order).toEqual(['b', 'a'])
  })

  it('ignores nulls among a composite step\'s parts', async () => {
    await create('projects', projectRow('keep'), 'Project added')
    const step = composite('Batch', [
      null,
      await write('projects', 'keep', { name: 'Renamed' }, 'Renamed'),
      await write('projects', 'missing', { name: 'Nope' }, 'Renamed'),
    ])

    await step.apply()

    expect((await db.projects.get('keep'))?.name).toBe('Temporary')
  })
})
