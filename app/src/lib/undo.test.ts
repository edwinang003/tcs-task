import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pushUndo, undoLast, clearUndo, subscribe, getUndo } from './undo'

function step(label: string, apply = async () => {}) {
  return { label, toast: false, apply }
}

describe('undo', () => {
  beforeEach(() => {
    clearUndo()
  })

  it('holds the most recent step and hands it back', () => {
    pushUndo(step('Title changed'))
    expect(getUndo()?.label).toBe('Title changed')
  })

  it('ignores a null step, so a no-op write does not clear a real one', () => {
    // repo returns null when the row was not there. Pushing that must not
    // swallow the undo the user is actually reaching for.
    pushUndo(step('Task deleted'))
    pushUndo(null)
    expect(getUndo()?.label).toBe('Task deleted')
  })

  it('keeps only the last step — SPEC §4.5 is single-level', () => {
    pushUndo(step('first'))
    pushUndo(step('second'))
    expect(getUndo()?.label).toBe('second')
  })

  it('runs the step and empties the store', async () => {
    const apply = vi.fn(async () => {})
    pushUndo(step('Task deleted', apply))

    expect(await undoLast()).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
    expect(getUndo()).toBeNull()
  })

  it('undoing twice is a no-op, not a redo', async () => {
    // Without this, undo would push its own undo and Ctrl+Z would toggle
    // between two states forever.
    const apply = vi.fn(async () => {})
    pushUndo(step('Task deleted', apply))

    await undoLast()
    expect(await undoLast()).toBe(false)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('empties the store before awaiting, so a double press cannot double-apply', async () => {
    let release: () => void = () => {}
    const apply = vi.fn(() => new Promise<void>((r) => { release = r }))
    pushUndo(step('Task deleted', apply))

    const first = undoLast()
    const second = undoLast()
    release()
    await Promise.all([first, second])

    expect(apply).toHaveBeenCalledOnce()
  })

  it('notifies subscribers on push, undo and clear, and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    pushUndo(step('one'))
    await undoLast()
    pushUndo(step('two'))
    clearUndo()
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    pushUndo(step('three'))
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('clearing an empty store notifies nobody', () => {
    const listener = vi.fn()
    subscribe(listener)
    clearUndo()
    expect(listener).not.toHaveBeenCalled()
  })
})
