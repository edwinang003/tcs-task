import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRoute, openProject, openView, captureTarget, parseStored, resolveProject,
  subscribe,
} from './nav'
import { activeWorkspace } from './workspace'
import type { Project } from './schema'

const inbox = activeWorkspace().projectId

function project(id: string): Project {
  return {
    id,
    workspace_id: activeWorkspace().workspaceId,
    name: id,
    color: null,
    icon: null,
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
