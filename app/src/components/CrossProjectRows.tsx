/**
 * The rows a cross-project view draws, and nothing else.
 *
 * No empty state and no headings: each caller has its own words for "nothing
 * here", and only the agenda has headings at all. An empty list draws
 * nothing, and the caller draws its message around it.
 *
 * `hidesOnComplete` is deliberately left at its default. No view that spans
 * projects has a Done section to move a ticked row into, so the row stays
 * where it is — which is exactly what that prop exists to control.
 */
import { TaskRow } from './TaskRow'
import type { CrossProject } from '../lib/useCrossProject'
import type { Task } from '../lib/schema'

export function CrossProjectRows({
  tasks,
  cx,
  onOpen,
  excerpts,
}: {
  tasks: Task[]
  cx: CrossProject
  onOpen: (id: string) => void
  /** Task id → why it matched, in search. Absent everywhere else. */
  excerpts?: Map<string, string>
}) {
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            onOpen={onOpen}
            badge={cx.names.get(task.project_id)}
            progress={cx.progress.get(task.id)}
            labels={cx.labels.get(task.id)}
            excerpt={excerpts?.get(task.id)}
          />
        </li>
      ))}
    </ul>
  )
}
