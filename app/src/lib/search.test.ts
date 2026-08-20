import { describe, it, expect } from 'vitest'
import { excerptAround, search, terms } from './search'
import type { Project, Task } from './schema'

function project(id: string): Project {
  return {
    id,
    workspace_id: 'w',
    name: id,
    color: null,
    icon: null,
    default_view: 'list',
    position: 'a0',
    archived_at: null,
    updated_at: '2026-08-20T00:00:00.000Z',
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
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
    ...fields,
  }
}

/** The one live project every task below belongs to, unless it says otherwise. */
const live = [project('p')]

/** The ids of the hits, in order — what nearly every assertion is about. */
function ids(hits: { task: Task }[]): string[] {
  return hits.map((hit) => hit.task.id)
}

describe('terms', () => {
  it('lowercases and splits on runs of whitespace', () => {
    expect(terms('  Call   the PLUMBER \n')).toEqual(['call', 'the', 'plumber'])
  })

  it('yields nothing for an empty or whitespace-only query', () => {
    // Decision 3: an empty query matches nothing rather than everything. A
    // field that dumps the whole workspace on focus reads as broken.
    expect(terms('')).toEqual([])
    expect(terms('   \t ')).toEqual([])
  })
})

describe('search', () => {
  it('finds a case-insensitive substring of the title', () => {
    const hits = search('RENT', [task('t', { title: 'Pay the rent' })], live)
    expect(ids(hits)).toEqual(['t'])
  })

  it('matches inside a word', () => {
    // Deliberately dumb, per §5: a substring scan, not a word index.
    expect(ids(search('lumb', [task('t', { title: 'call the plumber' })], live)))
      .toEqual(['t'])
  })

  it('requires every term, and reads them across title and notes', () => {
    // Decision 3: the words you remember are rarely contiguous, so terms are
    // ANDed over the two fields together rather than matched as one string.
    const rows = [
      task('both', { title: 'call bob', notes: 'about the plumber' }),
      task('title-only', { title: 'call bob' }),
      task('neither', { title: 'buy milk' }),
    ]
    expect(ids(search('call plumber', rows, live))).toEqual(['both'])
  })

  it('returns nothing for an empty or whitespace-only query', () => {
    const rows = [task('t', { title: 'Pay the rent' })]
    expect(search('', rows, live)).toEqual([])
    expect(search('   ', rows, live)).toEqual([])
  })

  it('puts title matches above notes matches', () => {
    // Decision 4: two bands rather than a score. A title hit is what you
    // meant nearly every time; everything below is one undifferentiated pile.
    const rows = [
      task('notes', { title: 'call the agent', notes: 'chase them about rent' }),
      task('title', { title: 'pay rent' }),
    ]
    expect(ids(search('rent', rows, live))).toEqual(['title', 'notes'])
  })

  it('keeps position order within a band', () => {
    // `listAllTasks` hands rows over in position order, and a result set that
    // spans projects has no priority of its own to impose — LabelList's rule.
    const rows = [
      task('first', { title: 'rent a van', position: 'a0' }),
      task('second', { title: 'rent, March', position: 'a1' }),
      task('third', { title: 'rent receipt', position: 'a2' }),
    ]
    expect(ids(search('rent', rows, live))).toEqual(['first', 'second', 'third'])
  })

  it('finds a completed task', () => {
    // Decision 5: half of why you search is to find what you already did, and
    // a ticked task is already on screen in its project's Done section.
    const rows = [
      task('done', {
        title: 'rent, March',
        completed_at: '2026-03-02T09:00:00.000Z',
      }),
    ]
    expect(ids(search('rent', rows, live))).toEqual(['done'])
  })

  it('does not find a task in an archived project', () => {
    // The corpus is built from the same `listProjects` the drawer reads, so
    // archiving stays one rule with one source rather than one each view
    // re-argues. An archived project is simply absent from `projects`.
    const rows = [task('hidden', { title: 'pay rent', project_id: 'gone' })]
    expect(search('rent', rows, live)).toEqual([])
  })

  it('does not find a tombstone', () => {
    // `listAllTasks` has already dropped these. Doing it here too is
    // `progressByTask`'s precedent: a caller reaching past the reader cannot
    // get an answer that includes deleted rows.
    const rows = [
      task('gone', { title: 'pay rent', deleted_at: '2026-08-19T00:00:00.000Z' }),
    ]
    expect(search('rent', rows, live)).toEqual([])
  })

  it('carries no excerpt on a title hit', () => {
    const hits = search('rent', [task('t', { title: 'pay rent' })], live)
    expect(hits[0].excerpt).toBeNull()
  })
})

describe('excerptAround', () => {
  it('returns a short note whole, with no ellipses', () => {
    expect(excerptAround('chase the landlord about rent', ['rent'])).toBe(
      'chase the landlord about rent',
    )
  })

  it('collapses newlines and runs of spaces onto one line', () => {
    // A note is free text and a row is one line high. Without this a
    // three-paragraph note would set the row's height.
    expect(
      excerptAround('first line\n\n  second line about rent\n', ['rent']),
    ).toBe('first line second line about rent')
  })

  it('clips to a window around the match, ellipsing both ends', () => {
    // 80 characters, beginning 24 before the match: enough lead-in to read as
    // a sentence, short enough for one line at 390px.
    const notes = 'x'.repeat(100) + ' rent ' + 'y'.repeat(100)
    expect(excerptAround(notes, ['rent'])).toBe(
      '…' + 'x'.repeat(23) + ' rent ' + 'y'.repeat(51) + '…',
    )
  })

  it('anchors on the earliest match, not on the first term typed', () => {
    // With `call plumber` against a note that mentions the plumber two
    // paragraphs above the call, the useful excerpt is the one that comes
    // first on the page. The order the words were typed in carries no meaning.
    const notes = 'plumber ' + 'z'.repeat(200) + ' call'
    expect(excerptAround(notes, ['call', 'plumber'])).toBe(
      'plumber ' + 'z'.repeat(72) + '…',
    )
  })

  it('returns null when no term occurs', () => {
    expect(excerptAround('nothing to see here', ['rent'])).toBeNull()
  })
})

describe('search excerpts', () => {
  it('explains a notes-only hit with the matching stretch', () => {
    const rows = [
      task('t', {
        title: 'call the agent',
        notes: 'chase the landlord about rent',
      }),
    ]
    expect(search('rent', rows, live)[0].excerpt).toBe(
      'chase the landlord about rent',
    )
  })
})
