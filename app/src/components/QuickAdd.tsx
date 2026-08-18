/**
 * Capture. SPEC §3: capture beats organization.
 *
 * The third question P0a exists to answer is "does typing a task feel fast
 * enough to beat Google Tasks?" — so the input keeps focus after submitting,
 * and it sits at the bottom of the screen where a thumb is (SPEC §8
 * consequence 4: Android is the capture device).
 *
 * No parsing here. SPEC §5.1 puts natural-language quick add in P2, because
 * the naive version is an afternoon and the trustworthy version is the only
 * one worth shipping.
 */
import { useRef, useState, useSyncExternalStore } from 'react'
import { addTask } from '../lib/repo'
import { pushUndo } from '../lib/undo'
import { subscribe, getRoute } from '../lib/nav'

export function QuickAdd() {
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field should never appear to wait on anything (SPEC §9).
    setTitle('')
    const { undo } = await addTask(value, route.projectId)
    pushUndo(undo)
    input.current?.focus()
  }

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 border-t border-black/5 bg-white/85 px-3 pt-3 backdrop-blur dark:border-white/10 dark:bg-ink/85"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-4 text-base text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="min-h-11 rounded-xl bg-accent px-4 font-medium text-ink disabled:opacity-30"
        >
          Add
        </button>
      </div>
    </form>
  )
}
