/**
 * Today and Upcoming — the two views that span every project.
 *
 * Its own component rather than a mode of `TaskList`, because the two differ in
 * affordances and not merely in data: no sections, no section CRUD, no drag,
 * and one thing the project list must never show — which project a task came
 * from. What belongs in which group is decided by `lib/agenda.ts`, which is
 * pure and tested; this file only draws the answer.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTasks, listProjects } from '../lib/repo'
import { todayAgenda, upcomingAgenda } from '../lib/agenda'
import { TaskRow } from './TaskRow'

const EMPTY = {
  today: 'Nothing due today.',
  upcoming: 'Nothing in the next 7 days.',
}

export function AgendaList({
  kind,
  onOpen,
}: {
  kind: 'today' | 'upcoming'
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listAllTasks(), [])
  const projects = useLiveQuery(() => listProjects(), [])

  if (tasks === undefined || projects === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups =
    kind === 'today' ? todayAgenda(tasks, projects) : upcomingAgenda(tasks, projects)
  const names = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {groups.length === 0 && (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          {EMPTY[kind]}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.key}>
          <h2
            className={
              'px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide ' +
              // Overdue is the one heading that is not neutral: SPEC §5 asks
              // for it "pinned at top and visually distinct".
              (group.key === 'overdue'
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-400 dark:text-neutral-500')
            }
          >
            {group.title}
          </h2>
          <ul>
            {group.tasks.map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  onOpen={onOpen}
                  badge={names.get(task.project_id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
