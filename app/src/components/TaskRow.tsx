/**
 * One task, as a row.
 *
 * The project list and the agenda views differ in almost everything — sections
 * and drag on one side, days and a project badge on the other — but a task
 * must look and behave the same in both. That is this file: the part that must
 * not drift, in the one place it can be changed.
 *
 * The extras are optional and absent by default, which is what keeps each list
 * honest. The agenda views have no drag because nothing hands them a handle,
 * not because a flag switched it off; the project list has no badge because it
 * would be the same word on every row.
 *
 * `hidesOnComplete` is the third: only the list knows whether ticking a box
 * takes the row away. In a project it does — the task leaves for a collapsed
 * Done — and the undo toast is the way back. In Today it does not, and a toast
 * for a row still on the screen is noise.
 */
import { setTaskDone, deleteTask } from '../lib/repo'
import { formatDue, isOverdue } from '../lib/dates'
import { pushUndo } from '../lib/undo'
import type { Task } from '../lib/schema'

export function TaskRow({
  task,
  onOpen,
  badge,
  handle,
  hidesOnComplete = false,
}: {
  task: Task
  onOpen: (id: string) => void
  /** The project's name, in views that span more than one project. */
  badge?: string
  /** dnd-kit's grip props, in the list that can be reordered. */
  handle?: Record<string, unknown>
  /** Whether ticking the box takes the row off this screen. */
  hidesOnComplete?: boolean
}) {
  const done = task.completed_at !== null
  const due = formatDue(task.due_on, task.due_time)
  // A completed task is not overdue, however late it was.
  const overdue = !done && isOverdue(task.due_on, task.due_time)

  return (
    <div className="group flex items-center gap-3 rounded-xl px-1 py-1">
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-1">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) =>
            void setTaskDone(task.id, e.target.checked, {
              toast: hidesOnComplete && e.target.checked,
            }).then(pushUndo)
          }
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
        {due !== null && (
          <span
            className={
              'ml-2 whitespace-nowrap text-xs ' +
              (overdue
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-400 dark:text-neutral-500')
            }
          >
            {due}
          </span>
        )}
        {badge !== undefined && (
          <span className="ml-2 whitespace-nowrap text-xs text-neutral-400 dark:text-neutral-500">
            {badge}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => void deleteTask(task.id).then(pushUndo)}
        aria-label={`Delete ${task.title}`}
        className="min-h-11 px-2 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 dark:text-neutral-600"
      >
        &times;
      </button>
      {handle !== undefined && (
        <button
          type="button"
          {...handle}
          aria-label={`Reorder ${task.title}`}
          className="flex min-h-11 shrink-0 cursor-grab items-center pl-1 pr-2 text-lg leading-none text-neutral-300 dark:text-neutral-600"
        >
          &#10287;
        </button>
      )}
    </div>
  )
}
