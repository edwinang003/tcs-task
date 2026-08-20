import { describe, it, expect } from 'vitest'
import { applyFilters, hasAny, NO_FILTERS } from './filters'
import type { Filters } from './filters'
import type { Label, Task } from './schema'

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    section_id: 's',
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
    ...fields,
  }
}

function label(id: string): Label {
  return {
    id,
    name: id,
    color: 'rose',
    workspace_id: 'w',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

/** Nothing carries a label unless the test hands over a map that says so. */
const UNTAGGED = new Map<string, Label[]>()

/** One chip lit at a time, without spelling out the other two every call. */
function filters(fields: Partial<Filters> = {}): Filters {
  return { projects: new Set(), labels: new Set(), date: null, ...fields }
}

function ids(tasks: Task[]): string[] {
  return tasks.map((t) => t.id)
}

/**
 * Thursday 20 August 2026, late afternoon. Built from parts, never parsed
 * from a string: `new Date('2026-08-20')` is UTC midnight, which is the
 * previous day for anyone west of Greenwich — the trap `dates.ts` documents.
 */
const at = new Date(2026, 7, 20, 17, 0)

describe('hasAny', () => {
  it('is false for no filters at all', () => {
    expect(hasAny(NO_FILTERS)).toBe(false)
  })

  it('is true for each kind on its own', () => {
    expect(hasAny(filters({ projects: new Set(['p']) }))).toBe(true)
    expect(hasAny(filters({ labels: new Set(['l']) }))).toBe(true)
    expect(hasAny(filters({ date: 'today' }))).toBe(true)
  })
})

describe('applyFilters, with nothing lit', () => {
  it('returns every task, in the order it was given', () => {
    const rows = [task('c'), task('a'), task('b')]
    expect(ids(applyFilters(rows, NO_FILTERS, UNTAGGED, at))).toEqual([
      'c', 'a', 'b',
    ])
  })
})

describe('applyFilters, by date', () => {
  const rows = [
    task('yesterday', { due_on: '2026-08-19' }),
    task('today', { due_on: '2026-08-20' }),
    task('tomorrow', { due_on: '2026-08-21' }),
    task('day-six', { due_on: '2026-08-26' }),
    task('day-seven', { due_on: '2026-08-27' }),
    task('undated'),
  ]

  it('finds what is overdue', () => {
    expect(ids(applyFilters(rows, filters({ date: 'overdue' }), UNTAGGED, at)))
      .toEqual(['yesterday'])
  })

  it('still calls yesterday overdue one minute past midnight', () => {
    // The reason `at` is injected rather than read from the clock: the
    // boundary that actually breaks is the one nobody is awake for.
    const midnight = new Date(2026, 7, 20, 0, 1)
    expect(
      ids(applyFilters(rows, filters({ date: 'overdue' }), UNTAGGED, midnight)),
    ).toEqual(['yesterday'])
  })

  it('finds what is due today, and nothing on either side of it', () => {
    expect(ids(applyFilters(rows, filters({ date: 'today' }), UNTAGGED, at)))
      .toEqual(['today'])
  })

  it('reaches six days ahead, counting today, and stops', () => {
    // Six ahead plus today rather than a calendar week, which would shrink
    // to nothing by Saturday — when you are most likely to ask what is left.
    expect(ids(applyFilters(rows, filters({ date: 'week' }), UNTAGGED, at)))
      .toEqual(['today', 'tomorrow', 'day-six'])
  })

  it('finds what was never scheduled', () => {
    // The preset no other view in the app can offer: Today and Upcoming both
    // need a date before they will show a row at all.
    expect(ids(applyFilters(rows, filters({ date: 'none' }), UNTAGGED, at)))
      .toEqual(['undated'])
  })
})

describe('applyFilters, by label', () => {
  const carried = new Map<string, Label[]>([
    ['both', [label('waiting'), label('urgent')]],
    ['one', [label('waiting')]],
    ['other', [label('urgent')]],
    ['three', [label('waiting'), label('urgent'), label('home')]],
  ])
  const rows = [
    task('both'), task('one'), task('other'), task('three'), task('none'),
  ]

  it('finds the tasks carrying one label', () => {
    const f = filters({ labels: new Set(['waiting']) })
    expect(ids(applyFilters(rows, f, carried, at)))
      .toEqual(['both', 'one', 'three'])
  })

  it('intersects two labels rather than uniting them', () => {
    // Design decision 3, and the debt slice 8 deferred here by name: §4
    // makes labels tags a task carries many of, so two of them is the
    // question "waiting-on AND urgent" — which has answers in it.
    const f = filters({ labels: new Set(['waiting', 'urgent']) })
    expect(ids(applyFilters(rows, f, carried, at))).toEqual(['both', 'three'])
  })

  it('does not mind a task carrying more labels than were asked for', () => {
    const f = filters({ labels: new Set(['home']) })
    expect(ids(applyFilters(rows, f, carried, at))).toEqual(['three'])
  })
})

describe('applyFilters, by project', () => {
  const rows = [
    task('a', { project_id: 'work' }),
    task('b', { project_id: 'home' }),
    task('c', { project_id: 'errands' }),
  ]

  it('finds the tasks in one project', () => {
    const f = filters({ projects: new Set(['work']) })
    expect(ids(applyFilters(rows, f, UNTAGGED, at))).toEqual(['a'])
  })

  it('unites two projects rather than intersecting them', () => {
    // Decision 3, and the arithmetic decides it: a task has exactly one
    // project, so ANDing two would return the empty set every time.
    const f = filters({ projects: new Set(['work', 'home']) })
    expect(ids(applyFilters(rows, f, UNTAGGED, at))).toEqual(['a', 'b'])
  })
})

describe('applyFilters, combined', () => {
  it('ANDs across the three kinds, so failing any one is out', () => {
    const carried = new Map<string, Label[]>([
      ['keeper', [label('waiting')]],
      ['wrong-project', [label('waiting')]],
      ['wrong-date', [label('waiting')]],
    ])
    const rows = [
      task('keeper', { project_id: 'work', due_on: '2026-08-20' }),
      task('wrong-project', { project_id: 'home', due_on: '2026-08-20' }),
      task('wrong-label', { project_id: 'work', due_on: '2026-08-20' }),
      task('wrong-date', { project_id: 'work', due_on: '2026-08-27' }),
    ]
    const f = filters({
      projects: new Set(['work']),
      labels: new Set(['waiting']),
      date: 'today',
    })
    expect(ids(applyFilters(rows, f, carried, at))).toEqual(['keeper'])
  })
})
