/**
 * A task's labels, inside the sheet.
 *
 * SPEC §4: labels are "cross-project tags" and nothing else — a name and a
 * colour. So this is a row of what the task carries, a field, and the labels
 * that match what you typed. No colour picker: a new label takes the next
 * palette colour, because a colour decision in the middle of typing a name is
 * one nobody wants to make about a label they are inventing in passing.
 *
 * **It uses `useLiveQuery`, and `TaskSheet` deliberately does not** — the same
 * split `Checklist` makes, for the same reason. That rule protects the draft,
 * not the row set: undo is an ordinary new mutation (SPEC §4.5), so a label
 * removed and then restored has to reappear on a sheet that is still open.
 * There is no draft to protect here beyond the filter field, which nothing but
 * this component ever writes.
 */
import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listLabels,
  listTaskLabels,
  createLabel,
  tagTask,
  untagTask,
} from '../lib/repo'
import { dotClasses } from '../lib/labelling'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'

export function LabelPicker({ taskId }: { taskId: string }) {
  const labels = useLiveQuery(() => listLabels(), [])
  const links = useLiveQuery(() => listTaskLabels(taskId), [taskId])
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const all = labels ?? []
  const tagged = new Set((links ?? []).map((link) => link.label_id))
  const mine = all.filter((label) => tagged.has(label.id))

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? all.filter((label) => label.name.toLowerCase().includes(needle))
    : []
  // Only an exact name blocks creating: "err" matching "errand" should still
  // be able to become its own label.
  const exists = all.some((label) => label.name.toLowerCase() === needle)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || exists) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field never appears to wait (SPEC §9). QuickAdd's rule.
    setQuery('')
    try {
      const created = await createLabel(value)
      if (created === null) return
      // The tag's step, not the label's. SPEC §4.5 holds one step, and the
      // gesture from the user's side was "put errand on this task" — so undo
      // takes it off the task and leaves the label in the workspace, where
      // another task can reach for it. Deleting a label is its own gesture,
      // in 8b's drawer.
      pushUndo(await tagTask(taskId, created.id))
    } catch (error) {
      // The field was cleared optimistically, so a failure hands the words
      // back — losing what someone typed is worse than the failure.
      setQuery(value)
      reportProblem('Label not created', error)
    }
    input.current?.focus()
  }

  return (
    <div className="mt-4">
      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        Labels
      </span>

      {mine.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {mine.map((label) => (
            <li key={label.id}>
              <button
                type="button"
                onClick={() => void untagTask(taskId, label.id).then(pushUndo)}
                aria-label={`Remove ${label.name}`}
                className="flex min-h-8 items-center gap-1.5 rounded-full border border-black/10 px-2.5 text-xs text-neutral-700 dark:border-white/15 dark:text-neutral-200"
              >
                <span
                  aria-hidden="true"
                  className={'size-2 rounded-full ' + dotClasses(label.color)}
                />
                {label.name}
                <span aria-hidden="true" className="text-neutral-400">
                  &times;
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-1 flex items-center gap-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add a label"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="none"
          aria-label="Add a label"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!query.trim() || exists}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-accent disabled:opacity-30"
        >
          Create
        </button>
      </form>

      {/* The matches appear only while there is something typed. Showing every
          label all the time would make the sheet taller than the phone for a
          list nobody is reading most of the time. */}
      {matches.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {matches.map((label) => {
            const on = tagged.has(label.id)
            return (
              <li key={label.id}>
                <button
                  type="button"
                  onClick={() =>
                    void (on
                      ? untagTask(taskId, label.id)
                      : tagTask(taskId, label.id)
                    ).then(pushUndo)
                  }
                  aria-label={`${on ? 'Remove' : 'Add'} ${label.name}`}
                  className={
                    'flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs ' +
                    (on
                      ? 'border-accent text-neutral-900 dark:text-neutral-100'
                      : 'border-black/10 text-neutral-500 dark:border-white/15 dark:text-neutral-400')
                  }
                >
                  <span
                    aria-hidden="true"
                    className={'size-2 rounded-full ' + dotClasses(label.color)}
                  />
                  {label.name}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
