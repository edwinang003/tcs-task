/**
 * Where you are, and where else you could be.
 *
 * An overlay on a phone; pinned open at `lg` and wider, where there is room
 * for it to be a sidebar. Today and Upcoming sit above the project list. Inbox
 * is not among them: it is a project, and making it a second kind of thing
 * would give the app two spellings of one concept.
 *
 * Project rename and archive live in the header rather than on these rows, so
 * the drawer stays a place you pass through rather than a control panel.
 */
import { useState } from 'react'
import { addProject } from '../lib/repo'
import { openProject, openView } from '../lib/nav'
import { useRoute } from '../lib/useRoute'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'

export function Drawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { route, projects } = useRoute()
  const openId = route.kind === 'project' ? route.projectId : null
  const [adding, setAdding] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setAdding('')
    let id: string
    try {
      const created = await addProject(name)
      id = created.id
      pushUndo(created.undo)
    } catch (error) {
      setAdding(name)
      reportProblem('Project not added', error)
      return
    }
    openProject(id)
    onClose()
  }

  return (
    <div
      className={
        'fixed inset-0 z-20 lg:static lg:z-auto lg:block ' +
        (open ? 'block' : 'hidden')
      }
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 lg:hidden"
      />
      <nav
        aria-label="Views and projects"
        className="relative flex h-full w-72 flex-col border-r border-black/5 bg-white px-2 dark:border-white/10 dark:bg-ink"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <ul className="pb-2">
          {(['today', 'upcoming'] as const).map((kind) => (
            <li key={kind}>
              <button
                type="button"
                aria-current={route.kind === kind ? 'page' : undefined}
                onClick={() => {
                  openView(kind)
                  onClose()
                }}
                className={
                  'min-h-11 w-full truncate rounded-xl px-3 text-left capitalize ' +
                  (route.kind === kind
                    ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-300')
                }
              >
                {kind}
              </button>
            </li>
          ))}
        </ul>
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Projects
        </p>
        <ul className="flex-1 overflow-y-auto">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                aria-current={project.id === openId ? 'page' : undefined}
                onClick={() => {
                  openProject(project.id)
                  onClose()
                }}
                className={
                  'min-h-11 w-full truncate rounded-xl px-3 text-left ' +
                  (project.id === openId
                    ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-300')
                }
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="border-t border-black/5 py-2 dark:border-white/10">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="+ Project"
            aria-label="New project"
            enterKeyHint="done"
            className="min-h-11 w-full rounded-xl bg-transparent px-3 text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </form>
      </nav>
    </div>
  )
}
