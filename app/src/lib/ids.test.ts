import { describe, it, expect } from 'vitest'
import { uuidv7 } from './ids'

describe('uuidv7', () => {
  it('has the right shape, version and variant', () => {
    const id = uuidv7()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('sorts lexicographically by creation order, even within one millisecond', () => {
    // SPEC §4.1 leans on v7 being time-sortable for index locality; a burst of
    // tasks added in the same tick must still keep insertion order.
    const ids = Array.from({ length: 5000 }, () => uuidv7())
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never goes backwards when the clock does', () => {
    // SPEC §9.4: the client's wall clock is not trustworthy.
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_600_000_000_000)
    expect(b > a).toBe(true)
  })
})
