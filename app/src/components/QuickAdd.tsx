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
 *
 * Where a captured task lands depends on where you are: from Today it arrives
 * in Inbox dated today, because a task that vanished as you finished typing
 * would read as a bug and teach people not to trust the field. `captureTarget`
 * in `nav.ts` holds that rule.
 */
import { useRef, useState } from 'react'
import { addTask } from '../lib/repo'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'
import { useRoute } from '../lib/useRoute'
import { captureTarget } from '../lib/nav'

export function QuickAdd() {
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const { route } = useRoute()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field should never appear to wait on anything (SPEC §9).
    setTitle('')
    try {
      // Where a captured task lands is a rule about routes, and it lives in
      // `nav.ts`: from Today it arrives in Inbox dated today, so it appears on
      // the screen it was typed into rather than vanishing as you finish.
      const target = captureTarget(route)
      const { undo } = await addTask(value, target.projectId, {
        dueOn: target.dueOn,
      })
      pushUndo(undo)
    } catch (error) {
      // The field was cleared optimistically, so a failure has to hand the
      // words back — losing what someone typed is worse than the failure.
      setTitle(value)
      reportProblem('Task not added', error)
    }
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
          // Everywhere but search, where the view's own field is the point
          // of being there. This form sits after <main> in the DOM, so an
          // unconditional autoFocus wins on a cold start into that route and
          // the two paths in disagree: arriving from the drawer focuses the
          // search box, reopening the installed app focuses this one.
          autoFocus={route.kind !== 'search'}
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
