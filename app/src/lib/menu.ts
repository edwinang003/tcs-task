/**
 * Where a menu panel goes — the arithmetic, without a DOM.
 *
 * `Menu.tsx` reads the trigger's rectangle and renders the answer; this
 * decides what the answer is. The same split as `view.ts` / `useView.ts`,
 * for the same reason: the part worth testing is the part with no browser
 * in it.
 *
 * The panel is fixed rather than absolute because both drawer lists scroll,
 * and an absolutely-positioned panel inside a scrolling box is clipped by
 * it. The label list is capped at two and a bit rows, so that would be most
 * of the list.
 */

/** Only the three edges placement reads, so a test can pass a literal. */
export interface TriggerRect {
  top: number
  bottom: number
  right: number
}

export interface Viewport {
  width: number
  height: number
}

/**
 * `position: fixed` offsets. Exactly one of `top` and `bottom` is ever set:
 * both together would pin a height the panel does not have.
 */
export interface Placement {
  top?: number
  bottom?: number
  right: number
}

/** The gap between the trigger and the panel, in px. */
const GAP = 4

export function placeMenu(
  trigger: TriggerRect,
  viewport: Viewport,
): Placement {
  // Right edges align. The trigger is the rightmost thing in its row at
  // every call site, so a panel hung from its right edge cannot run off the
  // left of the screen — which is why there is no clamp here.
  const right = viewport.width - trigger.right

  // Downward from the top half, upward from the bottom half. Rendering,
  // measuring and then repositioning would be exactly right about a case
  // where roughly right is indistinguishable, and would cost a visible jump
  // to be so.
  if (trigger.bottom <= viewport.height / 2) {
    return { top: trigger.bottom + GAP, right }
  }
  return { bottom: viewport.height - trigger.top + GAP, right }
}
