import { describe, it, expect } from 'vitest'
import { placeMenu } from './menu'

/** A 390×844 phone — the screen every one of these rules exists for. */
const PHONE = { width: 390, height: 844 }

describe('placeMenu', () => {
  it('aligns the panel’s right edge with the trigger’s', () => {
    expect(placeMenu({ top: 100, bottom: 144, right: 350 }, PHONE).right)
      .toBe(40)
  })

  it('opens downward from the top half', () => {
    expect(placeMenu({ top: 100, bottom: 144, right: 350 }, PHONE))
      .toEqual({ top: 148, right: 40 })
  })

  it('opens upward from the bottom half', () => {
    // The case the module exists for: the last row of the drawer's label
    // list is near the bottom of the screen, and a panel hung below it
    // would open off the end of the phone.
    expect(placeMenu({ top: 700, bottom: 744, right: 350 }, PHONE))
      .toEqual({ bottom: 148, right: 40 })
  })

  it('opens downward from exactly the halfway line', () => {
    // A boundary has to fall one way. Down is the ordinary direction, so
    // the flip is the exception rather than the rule.
    const at = placeMenu({ top: 378, bottom: 422, right: 350 }, PHONE)
    expect(at.top).toBe(426)
    expect(at.bottom).toBeUndefined()
  })

  it('hangs flush against a trigger at the viewport’s right edge', () => {
    expect(placeMenu({ top: 10, bottom: 54, right: 390 }, PHONE).right).toBe(0)
  })
})
