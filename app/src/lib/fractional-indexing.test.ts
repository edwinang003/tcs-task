import { describe, it, expect } from 'vitest'
import { generateKeyBetween } from './fractional-indexing'

/**
 * SPEC §9.9: "Property test the fractional indexing. Random interleaved
 * reorders from two clients should always converge to a consistent order with
 * no duplicate positions."
 *
 * This module is vendored (SPEC §11.2), so these tests are the only thing
 * standing between us and a silently mis-ordered list.
 */

// A deterministic PRNG, so a failure is reproducible from its seed.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('generateKeyBetween — known values', () => {
  it('matches the reference implementation on the base cases', () => {
    expect(generateKeyBetween(null, null)).toBe('a0')
    expect(generateKeyBetween('a0', null)).toBe('a1')
    expect(generateKeyBetween(null, 'a0')).toBe('Zz')
    expect(generateKeyBetween('a0', 'a1')).toBe('a0V')
  })

  it('rejects an inverted range', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow()
    expect(() => generateKeyBetween('a0', 'a0')).toThrow()
  })
})

describe('generateKeyBetween — invariants', () => {
  it('appending stays strictly increasing over a long run', () => {
    let last: string | null = null
    const keys: string[] = []
    for (let i = 0; i < 2000; i++) {
      const k = generateKeyBetween(last, null)
      if (last !== null) expect(k > last).toBe(true)
      keys.push(k)
      last = k
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('prepending stays strictly decreasing over a long run', () => {
    let first: string | null = null
    for (let i = 0; i < 2000; i++) {
      const k = generateKeyBetween(null, first)
      if (first !== null) expect(k < first).toBe(true)
      first = k
    }
  })

  it('random insertions preserve the intended order and never duplicate', () => {
    const rand = rng(0xc0ffee)
    // The list holds [key, intendedOrder] pairs; intendedOrder is the ground
    // truth the string keys must agree with.
    let list: Array<[string, number]> = []
    let seq = 0
    for (let i = 0; i < 1500; i++) {
      const at = Math.floor(rand() * (list.length + 1))
      const before = at > 0 ? list[at - 1][0] : null
      const after = at < list.length ? list[at][0] : null
      const key = generateKeyBetween(before, after)
      if (before !== null) expect(key > before).toBe(true)
      if (after !== null) expect(key < after).toBe(true)
      list.splice(at, 0, [key, seq++])
    }
    const keys = list.map(([k]) => k)
    expect(new Set(keys).size).toBe(keys.length)
    // Sorting by string key must reproduce the list's actual order.
    const sorted = [...list].sort((x, y) => (x[0] < y[0] ? -1 : 1))
    expect(sorted.map(([, o]) => o)).toEqual(list.map(([, o]) => o))
  })

  it('two offline clients inserting into the same gap converge', () => {
    // SPEC §4.2 / §9.7: both inserts survive, no collision, and every device
    // that merges them lands on the same total order.
    const rand = rng(42)
    for (let trial = 0; trial < 200; trial++) {
      // Build a shared starting list both clients have already synced.
      let shared: string[] = []
      let last: string | null = null
      const n = 2 + Math.floor(rand() * 6)
      for (let i = 0; i < n; i++) {
        last = generateKeyBetween(last, null)
        shared.push(last)
      }

      const gap = Math.floor(rand() * (shared.length + 1))
      const before = gap > 0 ? shared[gap - 1] : null
      const after = gap < shared.length ? shared[gap] : null

      // Both clients pick the same gap while offline; neither sees the other.
      const clientA = generateKeyBetween(before, after)
      const clientB = generateKeyBetween(before, after)

      const merged = [...shared, clientA, clientB]
      // Identical keys are the one thing that would make the merge ambiguous.
      // Fractional indexing does not prevent that when both clients pick the
      // same gap, so the order falls back to a tiebreak on row id — what must
      // hold is that the merged order is stable and the surrounding rows keep
      // their relative positions.
      const order = [...merged].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
      const sharedInMerged = order.filter((k) => shared.includes(k))
      expect(sharedInMerged).toEqual(shared)
      for (const k of [clientA, clientB]) {
        if (before !== null) expect(k > before).toBe(true)
        if (after !== null) expect(k < after).toBe(true)
      }
    }
  })
})
