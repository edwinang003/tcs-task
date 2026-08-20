import { describe, it, expect } from 'vitest'
import { resolveDrop } from './drag'
import type { SectionGroup } from './grouping'
import type { Section, Task } from './schema'

function section(id: string, done = false): Section {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    name: id,
    position: 'a0',
    is_done_section: done,
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function task(id: string, sectionId: string): Task {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    section_id: sectionId,
    title: id,
    notes: null,
    due_on: null,
    due_time: null,
    reminder_at: null,
    reminder_sent_at: null,
    priority: 0,
    completed_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    position: 'a0',
    created_by: null,
    assignee_id: null,
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

/** Tasks, then Done — the order `groupBySection` produces. */
function groups(open: string[], done: string[] = []): SectionGroup[] {
  return [
    { section: section('tasks'), tasks: open.map((id) => task(id, 'tasks')) },
    { section: section('done', true), tasks: done.map((id) => task(id, 'done')) },
  ]
}

describe('resolveDrop', () => {
  it('drops above the row you are over when dragging up', () => {
    expect(resolveDrop(groups(['a', 'b', 'c']), 'c', 'a')).toEqual({
      sectionId: 'tasks',
      beforeId: 'a',
    })
  })

  // The case that inverts, and the reason this file exists: the row under the
  // thumb has already shifted up to fill the gap the dragged task left, so
  // "above the row I am over" would put it back where it started.
  it('drops below the row you are over when dragging down', () => {
    expect(resolveDrop(groups(['a', 'b', 'c', 'd']), 'a', 'b')).toEqual({
      sectionId: 'tasks',
      beforeId: 'c',
    })
  })

  it('drops at the end when dragging down onto the last row', () => {
    expect(resolveDrop(groups(['a', 'b', 'c']), 'a', 'c')).toEqual({
      sectionId: 'tasks',
      beforeId: null,
    })
  })

  it('drops above the row you are over in another section', () => {
    // Nothing has shifted in a section the task did not come from.
    expect(resolveDrop(groups(['a', 'b'], ['x', 'y']), 'a', 'y')).toEqual({
      sectionId: 'done',
      beforeId: 'y',
    })
  })

  it('drops at the end of a section when the target is the section itself', () => {
    // An empty section, or a collapsed Done header: the drop is on the
    // container, not on a row.
    expect(resolveDrop(groups(['a', 'b']), 'a', 'done')).toEqual({
      sectionId: 'done',
      beforeId: null,
    })
  })

  it('ignores a drop onto itself', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', 'a')).toBeNull()
  })

  it('ignores a cancelled drag, which has nothing under it', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', null)).toBeNull()
  })

  it('ignores ids that are not in the list', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', 'ghost')).toBeNull()
    expect(resolveDrop(groups(['a', 'b']), 'ghost', 'a')).toBeNull()
  })
})
