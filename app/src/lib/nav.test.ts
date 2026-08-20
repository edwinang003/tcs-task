import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRoute, openProject, openView, openLabel, captureTarget, parseStored,
  resolveProject, resolveLabel, subscribe,
} from './nav'
import { activeWorkspace } from './workspace'
import type { Project, Label } from './schema'

const inbox = activeWorkspace().projectId

function project(id: string): Project {
  return {
    id,
    workspace_id: activeWorkspace().workspaceId,
    name: id,
    color: null,
    icon: null,
    default_view: 'list',
    position: 'a0',
    archived_at: null,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

describe('nav', () => {
  beforeEach(() => {
    localStorage.clear()
    openProject(inbox)
  })

  it('opens the Inbox project by default', () => {
    expect(getRoute()).toEqual({ kind: 'project', projectId: inbox })
  })

  it('remembers the open project across a reload', () => {
    openProject('some-project')
    // What a fresh tab would read: the module reloads and re-reads storage.
    expect(localStorage.getItem('lane.route')).toBe('some-project')
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openProject('a')
    openProject('b')
    unsubscribe()
    openProject('c')

    expect(calls).toBe(2)
  })

  it('does not notify when the same project is opened twice', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openProject('a')
    openProject('a')
    unsubscribe()

    // useSyncExternalStore re-reads on every emit; a no-op change should not
    // cost the whole list a render.
    expect(calls).toBe(1)
  })

  it('resolves to the open project when it still exists', () => {
    const projects = [project(inbox), project('work')]
    expect(resolveProject(projects, 'work')).toBe('work')
  })

  it('falls back to Inbox when the open project is gone or archived', () => {
    // `listProjects` excludes both deleted and archived projects, so this one
    // branch covers "deleted on another device" and "archived a moment ago".
    const projects = [project(inbox)]
    expect(resolveProject(projects, 'work')).toBe(inbox)
  })

  it('trusts the stored id while the read has not answered yet', () => {
    // `undefined` means "no answer", not "empty" — must not fall back.
    expect(resolveProject(undefined, 'work')).toBe('work')
  })

  it('differs from undefined once the list has answered and is empty', () => {
    // An empty array is a real answer: nothing exists, so fall back to Inbox.
    // This must differ from the undefined case above — that's the whole point.
    expect(resolveProject([], 'work')).toBe(inbox)
  })

  it('opens Today, and remembers it across a reload', () => {
    openView('today')

    expect(getRoute()).toEqual({ kind: 'today' })
    expect(localStorage.getItem('lane.route')).toBe('today')
  })

  it('opens Upcoming', () => {
    openView('upcoming')

    expect(getRoute()).toEqual({ kind: 'upcoming' })
  })

  it('does not notify when the same view is opened twice', () => {
    openView('today')
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openView('today')
    unsubscribe()

    expect(calls).toBe(0)
  })

  it('returns the same object until the route changes', () => {
    // `useSyncExternalStore` compares by identity and loops forever on a fresh
    // object every call.
    openView('today')
    expect(getRoute()).toBe(getRoute())
  })

  // `parseStored` is exported so that what a stored string means is testable at
  // all: the module reads storage once, at import, so a test that writes to
  // localStorage afterwards proves nothing about how a fresh tab would load.
  it('reads a project id written by the previous build, which stored a bare uuid', () => {
    // This is the guarantee that lets the route become a union with no
    // migration step: an installed phone must not lose its place on update.
    expect(parseStored('0192f0c4-0000-7000-8000-000000000000')).toEqual({
      kind: 'project',
      projectId: '0192f0c4-0000-7000-8000-000000000000',
    })
  })

  it('reads the two view words back as views', () => {
    expect(parseStored('today')).toEqual({ kind: 'today' })
    expect(parseStored('upcoming')).toEqual({ kind: 'upcoming' })
  })

  it('falls back to Inbox when nothing is stored', () => {
    expect(parseStored(null)).toEqual({ kind: 'project', projectId: inbox })
  })

  it('captures into the open project, undated', () => {
    expect(captureTarget({ kind: 'project', projectId: 'work' })).toEqual({
      projectId: 'work',
      dueOn: null,
    })
  })

  it('captures into Inbox dated today, so the task does not vanish as you type', () => {
    const at = new Date(2026, 7, 20, 9, 0)

    expect(captureTarget({ kind: 'today' }, at)).toEqual({
      projectId: inbox,
      dueOn: '2026-08-20',
    })
  })

  it('captures into Inbox undated from Upcoming, because no date is obvious', () => {
    // SPEC §5.1: a guess that hides itself is worse than no parsing at all.
    expect(captureTarget({ kind: 'upcoming' })).toEqual({
      projectId: inbox,
      dueOn: null,
    })
  })
})

describe('label routes', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores a label route under a prefix a uuid cannot produce', () => {
    // The whole reason for the prefix. A bare uuid already means a project,
    // so a label uuid stored bare would open a project that does not exist.
    openLabel('9f1d7c2e-0000-7000-8000-000000000001')
    expect(localStorage.getItem('lane.route')).toBe(
      'label:9f1d7c2e-0000-7000-8000-000000000001',
    )
    expect(getRoute()).toEqual({
      kind: 'label',
      labelId: '9f1d7c2e-0000-7000-8000-000000000001',
    })
  })

  it('reads a stored label route back', () => {
    expect(parseStored('label:abc')).toEqual({ kind: 'label', labelId: 'abc' })
  })

  it('still reads a bare uuid as a project', () => {
    // The guarantee that lets this union grow without a migration: a value
    // written by any previous build keeps meaning what it meant.
    expect(parseStored('9f1d7c2e-0000-7000-8000-000000000002')).toEqual({
      kind: 'project',
      projectId: '9f1d7c2e-0000-7000-8000-000000000002',
    })
    expect(parseStored('today')).toEqual({ kind: 'today' })
  })

  it('does not notify when the same label is opened twice', () => {
    openLabel('label-1')
    let calls = 0
    const off = subscribe(() => calls++)
    openLabel('label-1')
    expect(calls).toBe(0)
    openLabel('label-2')
    expect(calls).toBe(1)
    off()
  })

  it('captures into Inbox, undated and untagged, from a label route', () => {
    // Auto-tagging is defensible and deliberately not done: nav.ts already
    // refuses to guess a date for a task typed into Upcoming, and silently
    // attaching metadata nobody asked for is the same bet. The sheet is one
    // tap away. `captureTarget` returning no label field is how that is
    // enforced — there is nothing for QuickAdd to pass on.
    const target = captureTarget({ kind: 'label', labelId: 'label-1' })
    expect(target).toEqual({ projectId: inbox, dueOn: null })
  })
})

describe('resolveLabel', () => {
  function label(id: string): Label {
    return {
      id,
      name: id,
      color: 'rose',
      workspace_id: activeWorkspace().workspaceId,
      updated_at: '2026-08-20T00:00:00.000Z',
      deleted_at: null,
      client_id: 'test',
    }
  }

  it('stays on the label while it still exists', () => {
    expect(resolveLabel([label('l1')], 'l1')).toEqual({
      kind: 'label',
      labelId: 'l1',
    })
  })

  it('falls back to Inbox when the label is gone', () => {
    // Deleted here or on another device — both stop appearing in
    // `listLabels`, so one branch covers them. It falls back to a *project*
    // route rather than another label: there is no next-best label, and the
    // app's floor is Inbox, exactly as `resolveProject` decides.
    expect(resolveLabel([], 'l1')).toEqual({
      kind: 'project',
      projectId: inbox,
    })
  })

  it('trusts the stored id while the read has not answered yet', () => {
    // `undefined` means the query has not returned. Treating it as "gone"
    // would bounce every reload through Inbox for a frame.
    expect(resolveLabel(undefined, 'l1')).toEqual({
      kind: 'label',
      labelId: 'l1',
    })
  })
})

describe('the search route', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores as a bare word, like the other two views', () => {
    openView('search')
    expect(localStorage.getItem('lane.route')).toBe('search')
    expect(getRoute()).toEqual({ kind: 'search' })
  })

  it('reads back ahead of the uuid fallback', () => {
    // The fallback treats anything it does not recognise as a project id, so
    // a new word has to be recognised before it gets there or the app opens a
    // project called "search" that does not exist.
    expect(parseStored('search')).toEqual({ kind: 'search' })
  })

  it('still reads the words and uuids that were there before it', () => {
    expect(parseStored('today')).toEqual({ kind: 'today' })
    expect(parseStored('upcoming')).toEqual({ kind: 'upcoming' })
    expect(parseStored('label:abc')).toEqual({ kind: 'label', labelId: 'abc' })
    expect(parseStored('9f1d7c2e-0000-7000-8000-000000000003')).toEqual({
      kind: 'project',
      projectId: '9f1d7c2e-0000-7000-8000-000000000003',
    })
  })

  it('does not notify when search is opened twice', () => {
    openView('search')
    let calls = 0
    const off = subscribe(() => calls++)
    openView('search')
    expect(calls).toBe(0)
    openView('today')
    expect(calls).toBe(1)
    off()
  })

  it('captures into Inbox, undated, from the search route', () => {
    // Inherited rather than written: `captureTarget` dates only on `today`
    // and everything else falls through. Pinned by this test because it is
    // right by accident otherwise — and guessing a date here would be the
    // silent mis-dating §5.1 warns about.
    expect(captureTarget({ kind: 'search' })).toEqual({
      projectId: inbox,
      dueOn: null,
    })
  })
})
