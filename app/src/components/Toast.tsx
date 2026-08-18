/**
 * The undo offer.
 *
 * SPEC §4.5 fixes the mechanics; this is the affordance. A toast appears only
 * when the action took its result off the screen — a delete. A title edit, a
 * due date, a priority and a completion all stay in view and are reversible
 * with the control that made them, and a toast on every one of those would
 * train the eye to ignore the one that matters.
 *
 * The Ctrl/Cmd+Z listener lives here rather than in `App` because this is the
 * one component that is always mounted and already subscribed to the store.
 *
 * Hand-rolled rather than a toast package — SPEC §11.3 rule 2.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribe, getUndo, undoLast, type UndoStep } from '../lib/undo'

const VISIBLE_MS = 6000

export function UndoToast() {
  const step = useSyncExternalStore(subscribe, getUndo, getUndo)
  // Which step the timer has already hidden. Hiding the toast must not clear
  // the store: the keyboard can still undo long after the toast has gone.
  const [expired, setExpired] = useState<UndoStep | null>(null)

  useEffect(() => {
    if (step === null || !step.toast) return
    const timer = setTimeout(() => setExpired(step), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [step])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'z' || event.shiftKey) return
      if (!event.metaKey && !event.ctrlKey) return
      const target = event.target as HTMLElement | null
      // Native text undo inside a field has to keep working, or editing the
      // notes becomes a trap.
      if (
        target !== null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return
      }
      if (getUndo() === null) return
      event.preventDefault()
      void undoLast()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visible = step !== null && step.toast && step !== expired
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl bg-neutral-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-ink">
        <span>{step.label}</span>
        <button
          type="button"
          onClick={() => void undoLast()}
          className="min-h-11 rounded-lg px-3 font-medium text-accent"
        >
          Undo
        </button>
      </div>
    </div>
  )
}
