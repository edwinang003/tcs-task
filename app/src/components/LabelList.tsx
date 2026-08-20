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
import { listAllTaskLabels } from '../lib/repo'
import { tasksWithLabel } from '../lib/labelling'
import { useCrossProject } from '../lib/useCrossProject'
import { CrossProjectRows } from './CrossProjectRows'

export function LabelList({
  labelId,
  onOpen,
}: {
  labelId: string
  onOpen: (id: string) => void
}) {
  const cx = useCrossProject()
  // The one subscription this view needs that the other two do not: which
  // tasks carry this label. `useLabels` reads the same table for the dots but
  // exposes only the grouped map, and reaching through it would make the
  // route's membership rule depend on how a row draws itself.
  const links = useLiveQuery(() => listAllTaskLabels(), [])

  if (!cx.loaded || links === undefined) {
    return <div className="min-h-32" />
  }

  const carrying = tasksWithLabel(links, labelId)
  // `cx.tasks` is position-ordered across the workspace, and this keeps that
  // order rather than imposing one of its own: a label spans projects, and
  // any ordering by due date or name would claim a priority it does not have.
  const shown = cx.tasks.filter((task) => carrying.has(task.id))

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {shown.length === 0 && (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Nothing carries this label.
        </p>
      )}
      <CrossProjectRows tasks={shown} cx={cx} onOpen={onOpen} />
    </div>
  )
}
