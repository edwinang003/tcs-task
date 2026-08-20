import { describe, it, expect } from 'vitest'
import {
  getViews, parseViews, resolveView, setView, subscribe,
} from './view'

/**
 * Every test uses its own project id. The module is a singleton that loads
 * once, at import, so state written by one test is still there in the next —
 * the same reason `nav.test.ts` re-opens Inbox in a `beforeEach` rather than
 * assuming an empty store.
 */
describe('resolveView', () => {
  it('honours a stored choice over the width rule', () => {
    expect(resolveView('board', false, 'list')).toBe('board')
  })

  it('honours a stored list on a wide screen whose project starts as a board', () => {
    expect(resolveView('list', true, 'board')).toBe('list')
  })

  it("takes the project's initial value when nothing is stored and there is room", () => {
    expect(resolveView(undefined, true, 'board')).toBe('board')
  })

  it('opens a list on a narrow screen however the project starts', () => {
    // SPEC §8 rule 6: "default to list view at phone widths".
    expect(resolveView(undefined, false, 'board')).toBe('list')
  })
})

describe('the stored preference', () => {
  it('remembers a project across a reload', () => {
    setView('p-remember', 'board')
    // What a fresh tab would read: the module reloads and re-parses storage.
    expect(parseViews(localStorage.getItem('lane.view'))['p-remember']).toBe('board')
  })

  it('keeps one project’s choice out of another’s', () => {
    setView('p-alpha', 'board')
    setView('p-beta', 'list')

    expect(getViews()['p-alpha']).toBe('board')
    expect(getViews()['p-beta']).toBe('list')
  })

  it('returns the same object until something changes', () => {
    // `useSyncExternalStore` compares by identity and would loop forever on a
    // fresh object every call.
    const first = getViews()
    expect(getViews()).toBe(first)

    setView('p-identity', 'board')
    expect(getViews()).not.toBe(first)
  })

  it('neither writes nor notifies when the mode is already what you asked for', () => {
    setView('p-idempotent', 'board')
    localStorage.removeItem('lane.view')
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    setView('p-idempotent', 'board')

    expect(localStorage.getItem('lane.view')).toBeNull()
    expect(calls).toBe(0)
    unsubscribe()
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    setView('p-notify', 'board')
    expect(calls).toBe(1)

    unsubscribe()
    setView('p-notify', 'list')
    expect(calls).toBe(1)
  })
})

describe('parseViews', () => {
  it('reads nothing stored as nobody having chosen', () => {
    expect(parseViews(null)).toEqual({})
  })

  it('survives a value that is not JSON at all', () => {
    // A display preference is never worth a blank screen.
    expect(parseViews('{not json')).toEqual({})
  })

  it('survives JSON that is not an object', () => {
    expect(parseViews('3')).toEqual({})
  })

  it('drops modes it does not recognise', () => {
    // A newer build's value, or a hand-edited one. Falling through to the
    // width rule is right; rendering an unknown view is not.
    expect(parseViews('{"p":"kanban","q":"board"}')).toEqual({ q: 'board' })
  })
})
