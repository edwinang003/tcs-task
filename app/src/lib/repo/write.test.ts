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
  // Both of these protect the same thing: the undo store holds exactly one
  // step (SPEC §4.5), so any write that had no reason to happen evicts the
  // step the user is actually reaching for — the toast disappears mid-offer
  // and the delete behind it becomes unrecoverable.
  it('ignores a write that changes nothing', async () => {
    await create('projects', projectRow('unchanged'), 'Project added')
    await db.outbox.clear()
    const stampBefore = (await db.projects.get('unchanged'))!.updated_at

    const step = await write('projects', 'unchanged', { name: 'Temporary' }, 'Renamed')

    expect(step).toBeNull()
    expect(await db.outbox.count()).toBe(0)
    // Not even the stamp moves: an identical write is not a write.
    expect((await db.projects.get('unchanged'))!.updated_at).toBe(stampBefore)
  })

  it('ignores an edit to a tombstone, but lets the undo of the delete through', async () => {
    // The sheet's debounced commit can land after Delete was tapped. Writing
    // the tombstone would push a second step over the delete's own.
    await create('projects', projectRow('deleted'), 'Project added')
    await write('projects', 'deleted', { deleted_at: now() }, 'Project deleted', true)
    await db.outbox.clear()

    const late = await write('projects', 'deleted', { name: 'Late edit' }, 'Renamed')
    expect(late).toBeNull()
    expect((await db.projects.get('deleted'))!.name).toBe('Temporary')
    expect(await db.outbox.count()).toBe(0)

    // A change that touches `deleted_at` is how a delete is undone, so it has
    // to survive the guard.
    const revived = await write('projects', 'deleted', { deleted_at: null }, 'Project restored')
    expect(revived).not.toBeNull()
    expect((await db.projects.get('deleted'))!.deleted_at).toBeNull()
  })
})
