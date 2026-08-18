/**
 * The list, divided by section.
 *
 * SPEC §4: completing a task moves it into the project's done section, so the
 * row genuinely leaves the group you were looking at. The done section is
 * collapsed by default and is the only one that collapses — a project you have
 * used for a month is mostly history, and the completed log is P2's job.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listTasks, listSections, setTaskDone, deleteTask, addSection,
} from '../lib/repo'
import { groupBySection } from '../lib/grouping'
import { formatDue, isOverdue } from '../lib/dates'
import { useOpenProject } from '../lib/useOpenProject'
import { pushUndo } from '../lib/undo'
import { SectionHeader } from './SectionHeader'

export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
  const { projectId } = useOpenProject()
  const tasks = useLiveQuery(() => listTasks(projectId), [projectId])
  const sections = useLiveQuery(() => listSections(projectId), [projectId])
  const [doneOpen, setDoneOpen] = useState(false)
  const [adding, setAdding] = useState('')

  if (tasks === undefined || sections === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups = groupBySection(sections, tasks)
  const openSections = sections.filter((s) => !s.is_done_section).length

  async function addNewSection(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setAdding('')
    pushUndo((await addSection(projectId, name)).undo)
  }

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {groups.map((group) => {
        const isDone = group.section.is_done_section
        const collapsed = isDone ? !doneOpen : null
        return (
          <section key={group.section.id}>
            <SectionHeader
              section={group.section}
              count={group.tasks.length}
              collapsed={collapsed}
              onToggle={() => setDoneOpen((open) => !open)}
              // SPEC §4.4: the done section is never deletable, and neither is
              // the last open one.
              deletable={!isDone && openSections > 1}
            />
            {collapsed !== true && (
              <ul>
                {group.tasks.map((task) => {
                  const done = task.completed_at !== null
                  const due = formatDue(task.due_on, task.due_time)
                  // A completed task is not overdue, however late it was.
                  const overdue = !done && isOverdue(task.due_on, task.due_time)
                  return (
                    <li
                      key={task.id}
                      className="group flex items-center gap-3 rounded-xl px-1 py-1"
                    >
                      <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-1">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={(e) =>
                            void setTaskDone(task.id, e.target.checked).then(pushUndo)
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
            )}
          </section>
        )
      })}

      <form onSubmit={addNewSection} className="mt-4">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ Section"
          aria-label="New section"
          enterKeyHint="done"
          className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </form>
    </div>
  )
}
