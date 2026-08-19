import { describe, it, expect, beforeEach } from 'vitest'
import {
  reportProblem,
  describeProblem,
  dismissProblem,
  getProblem,
  subscribe,
} from './problems'

describe('problems', () => {
  beforeEach(() => {
    dismissProblem()
  })

  it('holds the most recent problem and hands it back', () => {
    reportProblem('Project not added', new Error('boom'))
    expect(getProblem()?.what).toBe('Project not added')
    expect(getProblem()?.detail).toBe('Error: boom')
  })

  it('returns the same object until something changes', () => {
    // `useSyncExternalStore` compares by identity and would loop forever on a
    // fresh object every call — the same rule `nav.ts` documents.
    reportProblem('Task not added', new Error('boom'))
    expect(getProblem()).toBe(getProblem())
  })

  it('replaces an older problem rather than queueing', () => {
    reportProblem('Project not added', new Error('first'))
    reportProblem('Task not added', new Error('second'))
    expect(getProblem()?.what).toBe('Task not added')
  })

  it('notifies subscribers on report and on dismiss', () => {
    let calls = 0
    const stop = subscribe(() => {
      calls += 1
    })
    reportProblem('Project not added', new Error('boom'))
    dismissProblem()
    stop()
    reportProblem('Ignored now', new Error('boom'))
    expect(calls).toBe(2)
  })

  it('does not notify when dismissing nothing', () => {
    let calls = 0
    const stop = subscribe(() => {
      calls += 1
    })
    dismissProblem()
    stop()
    expect(calls).toBe(0)
  })

  it('describes a DOMException by name, which is what IndexedDB throws', () => {
    // The name is the diagnosis: QuotaExceededError, ConstraintError and
    // DatabaseClosedError are three completely different problems, and the
    // message alone often does not say which one happened.
    const error = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    expect(describeProblem(error)).toBe('QuotaExceededError: The quota has been exceeded.')
  })

  it('does not repeat a name the message already carries', () => {
    // Dexie's errors read "DatabaseClosedError Database has been closed", so
    // prefixing the name again gives the user the word twice.
    const error = new Error('DatabaseClosedError Database has been closed')
    error.name = 'DatabaseClosedError'
    expect(describeProblem(error)).toBe('DatabaseClosedError Database has been closed')
  })

  it('describes a thrown non-error without turning it into "[object Object]"', () => {
    expect(describeProblem({ weird: true })).toBe('{"weird":true}')
    expect(describeProblem('just a string')).toBe('just a string')
  })

  it('survives a value that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(describeProblem(cyclic)).toBe('[unserialisable value]')
  })
})
