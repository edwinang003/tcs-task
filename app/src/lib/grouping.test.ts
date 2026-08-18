import { describe, it, expect } from 'vitest'
import { groupBySection } from './grouping'
import type { Section, Task } from './schema'

function section(id: string, position: string, done = false): Section {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    name: id,
    position,
    is_done_section: done,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function task(id: string, sectionId: string, position: string): Task {
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
    position,
    created_by: null,
    assignee_id: null,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

describe('groupBySection', () => {
  it('keeps sections in the order given', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('weekend', 'a1')],
      [],
    )
    expect(groups.map((g) => g.section.id)).toEqual(['todo', 'weekend'])
  })

  it('forces the done section last whatever its position', () => {
    // A done section whose key sorts first is not hypothetical: a user can
    // create sections above it long after the project was made.
    const groups = groupBySection(
      [section('done', 'a0', true), section('todo', 'a1')],
      [],
    )
    expect(groups.map((g) => g.section.id)).toEqual(['todo', 'done'])
  })

  it('puts each task in its own section, in the order given', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('weekend', 'a1')],
      [task('one', 'todo', 'a0'), task('two', 'weekend', 'a0'), task('three', 'todo', 'a1')],
    )
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['one', 'three'])
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['two'])
  })

  it('keeps empty sections', () => {
    const groups = groupBySection([section('todo', 'a0'), section('weekend', 'a1')], [])
    expect(groups).toHaveLength(2)
    expect(groups[1].tasks).toEqual([])
  })

  // SPEC §4.4: "it lands in the project's first section rather than being
  // dropped. Sync must never silently discard a row because its parent moved."
  it('folds a task with an unknown section into the first group', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('done', 'a1', true)],
      [task('orphan', 'deleted-elsewhere', 'a0')],
    )
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['orphan'])
  })

  it('drops every task rather than crashing when a project has no sections', () => {
    expect(groupBySection([], [task('one', 'gone', 'a0')])).toEqual([])
  })
})
