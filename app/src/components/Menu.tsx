/**
 * The … a row hides its rarely-used actions behind.
 *
 * Three call sites — a section header, and the drawer's project and label
 * rows — and four things none of them should own twice: the trigger's open
 * state, dismissal, focus returning to the trigger, and placement.
 *
 * Not ARIA's menu/menuitem pattern, and not a library. SPEC §11.3 rule 2 —
 * "prefer ~40 lines you own to a package" — and a panel of two or three
 * buttons that Tab already walks in order gains nothing from roving focus.
 * A labelled group, and `aria-expanded` on the trigger, is the whole
 * contract: the same as the colour picker this is modelled on.
 *
 * The children are a render prop rather than an item list, because the
 * label menu's second face is eight colour swatches rather than a row of
 * text. An `items` array would have needed a special case on day one.
 */
import { useEffect, useRef, useState } from 'react'
import { placeMenu } from '../lib/menu'
import type { Placement } from '../lib/menu'

export function Menu({
  label,
  children,
}: {
  /** Names both the trigger and the panel — "Actions for Groceries". */
  label: string
  children: (close: () => void) => React.ReactNode
}) {
  // One piece of state for two facts: the panel is open, and it goes here.
  // Placement is measured as it opens, so the two are never separately true.
  const [at, setAt] = useState<Placement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  function close() {
    setAt(null)
    // So Tab picks up where it left off rather than at the top of the page.
    trigger.current?.focus()
  }

  useEffect(() => {
    if (at === null) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (panel.current?.contains(target)) return
      // The trigger closes itself on click; letting this fire as well would
      // close and reopen the panel within one gesture.
      if (trigger.current?.contains(target)) return
      // No focus call: focus is going wherever the user just pressed.
      setAt(null)
    }
    // A fixed panel does not follow a scrolling ancestor, so it leaves
    // rather than drifting away from the row it belongs to.
    function onLeave() {
      setAt(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Captured, because the scroll happens on the drawer's list rather than
    // on the window, and a scroll event does not bubble.
    window.addEventListener('scroll', onLeave, true)
    window.addEventListener('resize', onLeave)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onLeave, true)
      window.removeEventListener('resize', onLeave)
    }
  }, [at])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={at !== null}
        onClick={() => {
          if (at !== null) {
            close()
            return
          }
          const rect = trigger.current?.getBoundingClientRect()
          if (rect === undefined) return
          setAt(
            placeMenu(rect, {
              width: window.innerWidth,
              height: window.innerHeight,
            }),
          )
        }}
        className="min-h-11 shrink-0 px-2 text-neutral-400 dark:text-neutral-500"
      >
        &hellip;
      </button>
      {at !== null && (
        <div
          ref={panel}
          role="group"
          aria-label={label}
          style={{ position: 'fixed', ...at }}
          className="z-30 flex min-w-36 flex-col rounded-xl border border-black/10 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-ink"
        >
          {children(close)}
        </div>
      )}
    </>
  )
}

/**
 * One ordinary action. Exists so the three menus agree on their type size
 * and their touch target without agreeing through copy-paste.
 */
export function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void
  /** Delete, and nothing else. Archive is reversible and reads as ordinary. */
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-11 w-full rounded-lg px-3 text-left text-sm ' +
        (danger
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-700 dark:text-neutral-200')
      }
    >
      {children}
    </button>
  )
}
