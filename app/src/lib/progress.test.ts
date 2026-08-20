import { describe, it, expect } from 'vitest'
import { progressByTask } from './progress'
import type { ChecklistItem } from './schema'

function item(
  taskId: string,
  done: boolean,
  overrides: Partial<ChecklistItem> = {},
): ChecklistItem {
  return {
    id: `${taskId}-${Math.random()}`,
    workspace_id: 'w',
    task_id: taskId,
    title: 'an item',
    done,
    position: 'a0',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'device',
    ...overrides,
  }
}

describe('progressByTask', () => {
  it('counts the done items and the total, per task', () => {
    const counts = progressByTask([
      item('trip', true),
      item('trip', false),
      item('trip', false),
    ])
    expect(counts.get('trip')).toEqual({ done: 1, total: 3 })
  })

  it('keeps two tasks apart', () => {
    const counts = progressByTask([item('trip', true), item('report', false)])
    expect(counts.get('trip')).toEqual({ done: 1, total: 1 })
    expect(counts.get('report')).toEqual({ done: 0, total: 1 })
  })

  it('leaves a task with no items out of the map', () => {
    // Absence is what lets TaskRow render nothing without every caller
    // checking — an undefined prop is already "no checklist".
    const counts = progressByTask([item('trip', false)])
    expect(counts.get('report')).toBeUndefined()
    expect(counts.size).toBe(1)
  })

  it('does not count tombstones', () => {
    // SPEC §9: deletions are soft, so a tombstone is a row in the table. The
    // reader filters them, and so does this — it is handed rows and must be
    // honest about them on its own.
    const counts = progressByTask([
      item('trip', true),
      item('trip', true, { deleted_at: '2026-08-20T10:00:00.000Z' }),
    ])
    expect(counts.get('trip')).toEqual({ done: 1, total: 1 })
  })

  it('reads 3/3 when everything is ticked', () => {
    const counts = progressByTask([
      item('trip', true),
      item('trip', true),
      item('trip', true),
    ])
    expect(counts.get('trip')).toEqual({ done: 3, total: 3 })
  })
})
