import { describe, it, expect, beforeEach } from 'vitest'
import { getRoute, openProject, resolveProject, subscribe } from './nav'
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
    expect(resolveProject(projects, { kind: 'project', projectId: 'work' }))
      .toBe('work')
  })

  it('falls back to Inbox when the open project is gone or archived', () => {
    // `listProjects` excludes both deleted and archived projects, so this one
    // branch covers "deleted on another device" and "archived a moment ago".
    const projects = [project(inbox)]
    expect(resolveProject(projects, { kind: 'project', projectId: 'work' }))
      .toBe(inbox)
  })
})
