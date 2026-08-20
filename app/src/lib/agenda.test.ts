import { describe, it, expect } from 'vitest'
import { todayAgenda, upcomingAgenda } from './agenda'
import type { Project, Task } from './schema'

/** A Wednesday morning. Every test reads "now" from here. */
const NOW = new Date(2026, 7, 19, 9, 0)

function project(id: string, archived = false): Project {
  return {
    id,
    workspace_id: 'w',
    name: id,
    color: null,
    icon: null,
    position: 'a0',
    archived_at: archived ? '2026-08-01T00:00:00.000Z' : null,
    updated_at: '2026-08-19T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

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
    updated_at: '2026-08-19T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
    ...fields,
  }
}

/** The one live project every task below belongs to. */
const live = [project('p')]

describe('todayAgenda', () => {
  it('pins overdue above what is due today', () => {
    const groups = todayAgenda(
      [
        task('due', { due_on: '2026-08-19' }),
        task('late', { due_on: '2026-08-17' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Overdue', 'Today'])
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['late'])
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['due'])
  })

  it('omits a group with nothing in it', () => {
    const groups = todayAgenda([task('due', { due_on: '2026-08-19' })], live, NOW)

    expect(groups.map((g) => g.title)).toEqual(['Today'])
  })

  it('ignores tasks with no due date, and tasks due later', () => {
    const groups = todayAgenda(
      [task('someday'), task('friday', { due_on: '2026-08-21' })],
      live,
      NOW,
    )

    expect(groups).toEqual([])
  })

  // The rule that keeps the screen still under your thumb: ticking a row must
  // not take it away, because Today has no Done section to move it to.
  it('keeps a task completed today, so a tick does not empty the screen', () => {
    const groups = todayAgenda(
      [
        task('done', {
          due_on: '2026-08-19',
          completed_at: '2026-08-19T08:30:00.000Z',
        }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['done'])
  })

  it('drops a task completed on an earlier day', () => {
    // Overdue is for work still owed. Yesterday's finished work is P2's log.
    const groups = todayAgenda(
      [
        task('old', {
          due_on: '2026-08-17',
          completed_at: '2026-08-18T08:30:00.000Z',
        }),
      ],
      live,
      NOW,
    )

    expect(groups).toEqual([])
  })

  it('drops tasks whose project is archived, and so absent from the list', () => {
    // The caller passes the list `listProjects` returns, which already excludes
    // archived and deleted projects. A task of theirs surfacing here would be
    // the one place the archive leaked — and reading the same list the drawer
    // reads is also what guarantees every row has a name for its badge.
    const groups = todayAgenda(
      [
        task('visible', { due_on: '2026-08-19' }),
        task('hidden', { due_on: '2026-08-19', project_id: 'archived' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['visible'])
  })

  it('reads down the clock, with untimed tasks after the timed ones', () => {
    // SPEC §4.1: "due Tuesday with no particular time is the common case". It
    // has no place in a time sequence, so it follows rather than sorting to
    // midnight and claiming the top of the day.
    const groups = todayAgenda(
      [
        task('anytime', { due_on: '2026-08-19' }),
        task('evening', { due_on: '2026-08-19', due_time: '18:00' }),
        task('morning', { due_on: '2026-08-19', due_time: '09:30' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual([
      'morning',
      'evening',
      'anytime',
    ])
  })

  it('breaks ties by position, so the order does not shuffle', () => {
    const groups = todayAgenda(
      [
        task('second', { due_on: '2026-08-19', position: 'a1' }),
        task('first', { due_on: '2026-08-19', position: 'a0' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['first', 'second'])
  })

  it('sorts overdue oldest first', () => {
    const groups = todayAgenda(
      [
        task('recent', { due_on: '2026-08-18' }),
        task('ancient', { due_on: '2026-07-01' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['ancient', 'recent'])
  })
})

describe('upcomingAgenda', () => {
  it('starts at tomorrow, so nothing appears in both views', () => {
    const groups = upcomingAgenda(
      [
        task('today', { due_on: '2026-08-19' }),
        task('tomorrow', { due_on: '2026-08-20' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Tomorrow'])
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['tomorrow'])
  })

  it('runs to seven days out and no further', () => {
    const groups = upcomingAgenda(
      [
        task('last', { due_on: '2026-08-26' }),
        task('beyond', { due_on: '2026-08-27' }),
      ],
      live,
      NOW,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['last'])
  })

  it('omits days with nothing in them', () => {
    // Seven headers over two tasks is mostly furniture.
    const groups = upcomingAgenda(
      [
        task('thu', { due_on: '2026-08-20' }),
        task('sat', { due_on: '2026-08-22' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Tomorrow', 'Sat 22 Aug'])
  })

  it('ignores overdue work, which belongs to Today', () => {
    const groups = upcomingAgenda([task('late', { due_on: '2026-08-01' })], live, NOW)

    expect(groups).toEqual([])
  })

  it('keys each group by its date, so React can tell days apart', () => {
    const groups = upcomingAgenda([task('thu', { due_on: '2026-08-20' })], live, NOW)

    expect(groups[0].key).toBe('2026-08-20')
  })
})

describe('the local-midnight boundary', () => {
  it('treats a task due today as due today at one minute past midnight', () => {
    // `new Date('2026-08-19')` is UTC midnight, which is the previous day west
    // of Greenwich. Everything here goes through `todayLocal` for that reason.
    const justAfterMidnight = new Date(2026, 7, 19, 0, 1)

    const groups = todayAgenda(
      [task('due', { due_on: '2026-08-19' })],
      live,
      justAfterMidnight,
    )

    expect(groups.map((g) => g.title)).toEqual(['Today'])
  })

  it('moves it to Overdue once the day turns', () => {
    const nextMorning = new Date(2026, 7, 20, 0, 1)

    const groups = todayAgenda(
      [task('due', { due_on: '2026-08-19' })],
      live,
      nextMorning,
    )

    expect(groups.map((g) => g.title)).toEqual(['Overdue'])
  })
})
