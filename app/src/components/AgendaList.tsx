/**
 * Today and Upcoming — the two views that span every project.
 *
 * Its own component rather than a mode of `TaskList`, because the two differ in
 * affordances and not merely in data: no sections, no section CRUD, no drag,
 * and one thing the project list must never show — which project a task came
 * from. What belongs in which group is decided by `lib/agenda.ts`, which is
 * pure and tested; this file only draws the answer.
 */
import { todayAgenda, upcomingAgenda } from '../lib/agenda'
import { useCrossProject } from '../lib/useCrossProject'
import { CrossProjectRows } from './CrossProjectRows'

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
  const cx = useCrossProject()

  if (!cx.loaded) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups =
    kind === 'today'
      ? todayAgenda(cx.tasks, cx.projects)
      : upcomingAgenda(cx.tasks, cx.projects)

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
          <CrossProjectRows tasks={group.tasks} cx={cx} onOpen={onOpen} />
        </section>
      ))}
    </div>
  )
}
