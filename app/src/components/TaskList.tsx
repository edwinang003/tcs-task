/**
 * The one hardcoded list. SPEC §13, P0a: "No projects, no board, no drag."
 *
 * Reads through `useLiveQuery`, so the list re-renders from IndexedDB whenever
 * the local database changes — SPEC §9's "the UI reads and writes IndexedDB",
 * with no manual refresh anywhere.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listTasks, setTaskDone, deleteTask } from '../lib/repo'
import { pushUndo } from '../lib/undo'

export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useLiveQuery(() => listTasks(), [])

  if (tasks === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  if (tasks.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-sm text-neutral-400 dark:text-neutral-500">
        Nothing here yet.
      </p>
    )
  }

  return (
    <ul className="mx-auto max-w-2xl px-3 py-2">
      {tasks.map((task) => {
        const done = task.completed_at !== null
        return (
          <li
            key={task.id}
            className="group flex items-center gap-3 rounded-xl px-1 py-1"
          >
            <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-1">
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => void setTaskDone(task.id, e.target.checked).then(pushUndo)}
                aria-label={`Complete ${task.title}`}
                className="size-5 shrink-0 accent-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => onOpen(task.id)}
              className="min-h-11 flex-1 text-left"
            >
              <span
                className={
                  done
                    ? 'text-neutral-400 line-through dark:text-neutral-600'
                    : 'text-neutral-900 dark:text-neutral-100'
                }
              >
                {task.title}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void deleteTask(task.id).then(pushUndo)}
              aria-label={`Delete ${task.title}`}
              className="min-h-11 px-2 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 dark:text-neutral-600"
            >
              &times;
            </button>
          </li>
        )
      })}
    </ul>
  )
}
