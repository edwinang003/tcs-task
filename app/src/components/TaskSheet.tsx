/**
 * The task editor, as a bottom sheet.
 *
 * Auto-saves: title and notes on blur and on a 500ms pause, due date and
 * priority the moment they are picked. "Done" only closes. SPEC §3 principle 1
 * — the UI never waits — and it is affordable because SPEC §9.1 coalesces the
 * outbox per row and dirty column set, so a debounced notes field is one entry
 * rather than thirty.
 *
 * It deliberately does not use `useLiveQuery`: a live value would fight the
 * cursor mid-word, and P0b has no second writer.
 */
import { useEffect, useRef, useState } from 'react'
import {
  getTask,
  renameTask,
  setTaskNotes,
  setTaskDue,
  setTaskPriority,
  deleteTask,
} from '../lib/repo'
import { pushUndo, type UndoStep } from '../lib/undo'

const PAUSE_MS = 500

const PRIORITIES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Urgent' },
]

interface Draft {
  title: string
  notes: string
  dueOn: string
  dueTime: string
  priority: 0 | 1 | 2 | 3
}

export function TaskSheet({
  taskId,
  onClose,
}: {
  taskId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let live = true
    void getTask(taskId).then((task) => {
      if (!live || task === undefined) return
      setDraft({
        title: task.title,
        notes: task.notes ?? '',
        dueOn: task.due_on ?? '',
        dueTime: task.due_time ?? '',
        priority: task.priority,
      })
    })
    return () => {
      live = false
    }
  }, [taskId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /**
   * The timer is deliberately not cleared on unmount: an edit typed a moment
   * before closing the sheet still has to land.
   */
  function commitLater(run: () => Promise<UndoStep | null>) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void run().then(pushUndo), PAUSE_MS)
  }

  function commitNow(run: () => Promise<UndoStep | null>) {
    clearTimeout(timer.current)
    void run().then(pushUndo)
  }

  function due(dueOn: string, dueTime: string) {
    // Mirrors `setTaskDue`: clearing the date clears the time with it. Without
    // this the row would hold no time while the sheet still displayed one.
    const time = dueOn === '' ? '' : dueTime
    setDraft((d) => (d === null ? d : { ...d, dueOn, dueTime: time }))
    commitNow(() => setTaskDue(taskId, dueOn || null, time || null))
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div
        role="dialog"
        aria-label="Task"
        className="relative max-h-[85%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 shadow-2xl dark:bg-ink sm:mx-auto sm:mb-8 sm:w-full sm:max-w-lg sm:rounded-2xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />

        {draft === null ? (
          <div className="min-h-64" />
        ) : (
          <>
            <input
              value={draft.title}
              autoFocus
              onChange={(e) => {
                const title = e.target.value
                setDraft({ ...draft, title })
                commitLater(() => renameTask(taskId, title))
              }}
              onBlur={() => commitNow(() => renameTask(taskId, draft.title))}
              aria-label="Title"
              className="min-h-11 w-full bg-transparent text-lg font-medium text-neutral-900 outline-none dark:text-neutral-100"
            />

            <label className="mt-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Notes
              <textarea
                value={draft.notes}
                rows={4}
                placeholder="Plain text — links become links"
                onChange={(e) => {
                  const notes = e.target.value
                  setDraft({ ...draft, notes })
                  commitLater(() => setTaskNotes(taskId, notes))
                }}
                onBlur={() => commitNow(() => setTaskNotes(taskId, draft.notes))}
                className="mt-1 w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-[15px] font-normal text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </label>

            <div className="mt-4 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Due
              </span>
              <input
                type="date"
                value={draft.dueOn}
                aria-label="Due date"
                onChange={(e) => due(e.target.value, draft.dueTime)}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
              <input
                type="time"
                value={draft.dueTime}
                aria-label="Due time"
                disabled={draft.dueOn === ''}
                onChange={(e) => due(draft.dueOn, e.target.value)}
                className="min-h-11 w-28 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Priority
              </span>
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={draft.priority === p.value}
                  onClick={() => {
                    setDraft({ ...draft, priority: p.value })
                    commitNow(() => setTaskPriority(taskId, p.value))
                  }}
                  className={
                    'min-h-11 flex-1 rounded-xl border text-sm ' +
                    (draft.priority === p.value
                      ? 'border-accent bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                      : 'border-black/10 text-neutral-500 dark:border-white/15 dark:text-neutral-400')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  void deleteTask(taskId).then(pushUndo)
                  onClose()
                }}
                className="min-h-11 rounded-xl px-3 text-sm text-red-600 dark:text-red-400"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-xl bg-accent px-5 font-medium text-ink"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
