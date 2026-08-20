/**
 * A task's checklist, inside the sheet.
 *
 * SPEC §4: "Checklist items are not tasks. They have no due date, no labels,
 * no detail view." So this is three controls on a line and an add field, and
 * it should stay that way — every affordance added here is one step toward the
 * project-management tool §4 exists to prevent.
 *
 * **It uses `useLiveQuery`, and `TaskSheet` deliberately does not.** That rule
 * protects the *draft*, not the row set, and here the two come apart:
 *
 * - The live query drives which items exist and whether they are ticked. It
 *   has to: undo is an ordinary new mutation against the database (SPEC §4.5),
 *   so an item deleted and then restored must reappear on a sheet that is
 *   still open. A snapshot would show a stale list.
 * - A `drafts` map keyed by item id drives the characters in an input. On
 *   commit the draft is dropped, and the live value replacing it is the string
 *   we just wrote — an identical value, which React does not treat as a change,
 *   so the cursor stays where it was.
 */
import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listChecklistItems,
  addChecklistItem,
  setChecklistItemDone,
  renameChecklistItem,
  deleteChecklistItem,
} from '../lib/repo'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'

const PAUSE_MS = 500

export function Checklist({ taskId }: { taskId: string }) {
  const items = useLiveQuery(() => listChecklistItems(taskId), [taskId])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // One timer per item, not one for the checklist. `TaskSheet` learned this
  // the hard way: a single timer means committing one field silently drops
  // another field's pending edit.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const rows = items ?? []
  const done = rows.filter((item) => item.done).length

  function forget(id: string) {
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  /**
   * The draft is dropped whether or not the write happened. An empty title is
   * refused (`renameChecklistItem` returns null), and dropping the draft is
   * what puts the stored title back on screen — so the refusal is visible
   * rather than silent.
   */
  function commit(id: string, value: string) {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    void renameChecklistItem(id, value).then((step) => {
      pushUndo(step)
      forget(id)
    })
  }

  function commitLater(id: string, value: string) {
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => commit(id, value), PAUSE_MS))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = title.trim()
    if (!value) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field never appears to wait (SPEC §9). QuickAdd's rule.
    setTitle('')
    try {
      const { undo } = await addChecklistItem(taskId, value)
      pushUndo(undo)
    } catch (error) {
      // The field was cleared optimistically, so a failure hands the words
      // back — losing what someone typed is worse than the failure.
      setTitle(value)
      reportProblem('Item not added', error)
    }
    input.current?.focus()
  }

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Checklist
        </span>
        {rows.length > 0 && (
          <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {done}/{rows.length}
          </span>
        )}
      </div>

      <ul className="mt-1">
        {rows.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <label className="flex min-h-11 shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) =>
                  void setChecklistItemDone(item.id, e.target.checked).then(pushUndo)
                }
                aria-label={`Tick ${item.title}`}
                className="size-4 shrink-0 accent-accent"
              />
            </label>
            <input
              value={drafts[item.id] ?? item.title}
              onChange={(e) => {
                const value = e.target.value
                setDrafts((current) => ({ ...current, [item.id]: value }))
                commitLater(item.id, value)
              }}
              onBlur={() => commit(item.id, drafts[item.id] ?? item.title)}
              aria-label={`Item ${item.title}`}
              className={
                'min-h-11 flex-1 bg-transparent text-[15px] outline-none ' +
                (item.done
                  ? 'text-neutral-400 line-through dark:text-neutral-600'
                  : 'text-neutral-900 dark:text-neutral-100')
              }
            />
            <button
              type="button"
              onClick={() => void deleteChecklistItem(item.id).then(pushUndo)}
              aria-label={`Delete ${item.title}`}
              className="min-h-11 px-2 text-neutral-300 dark:text-neutral-600"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add an item"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          aria-label="Add a checklist item"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-accent disabled:opacity-30"
        >
          Add
        </button>
      </form>
    </div>
  )
}
