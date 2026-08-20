/**
 * One label's tasks, across every project.
 *
 * `AgendaList`'s shape rather than `TaskList`'s: no sections, no section CRUD,
 * no drag, and every row names the project it came from — because the question
 * a label answers ("what am I waiting on?") is never scoped to one project.
 *
 * Its own component rather than a third `kind` on `AgendaList`, for the reason
 * that file gives for not being a mode of `TaskList`: the two differ in
 * affordances and not merely in data. An agenda is grouped by day and a label
 * is not grouped at all — there is no day to group by, and inventing one would
 * be the silent mis-dating SPEC §5.1 warns about.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTasks, listProjects, listAllTaskLabels } from '../lib/repo'
import { tasksWithLabel } from '../lib/labelling'
import { TaskRow } from './TaskRow'
import { useProgress } from '../lib/useProgress'
import { useLabels } from '../lib/useLabels'

export function LabelList({
  labelId,
  onOpen,
}: {
  labelId: string
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listAllTasks(), [])
  const projects = useLiveQuery(() => listProjects(), [])
  const links = useLiveQuery(() => listAllTaskLabels(), [])
  const progress = useProgress()
  const labels = useLabels()

  if (tasks === undefined || projects === undefined || links === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const carrying = tasksWithLabel(links, labelId)
  // `listAllTasks` is position-ordered across the workspace, and this keeps
  // that order rather than imposing one of its own: a label spans projects,
  // and any ordering by due date or name would claim a priority the label
  // does not have.
  const shown = tasks.filter((task) => carrying.has(task.id))
  const names = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {shown.length === 0 && (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Nothing carries this label.
        </p>
      )}
      <ul>
        {shown.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              onOpen={onOpen}
              badge={names.get(task.project_id)}
              progress={progress.get(task.id)}
              labels={labels.get(task.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
