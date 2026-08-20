/**
 * Where you are, and where else you could be.
 *
 * An overlay on a phone; pinned open at `lg` and wider, where there is room
 * for it to be a sidebar. Search, Today and Upcoming sit above the project
 * list. Inbox is not among them: it is a project, and making it a second kind
 * of thing would give the app two spellings of one concept.
 *
 * Labels sit below the projects, and every row of both lists carries a …
 * holding rename and the rest. This file used to say the opposite — that
 * those belonged in the header, so the drawer would stay "a place you pass
 * through rather than a control panel" — and that rule was aimed at
 * something real: a sidebar where every row carries visible buttons stops
 * being navigation. A menu closed by default is not that, and the header it
 * protected had grown to ☰, the title, a board toggle, Rename, Archive and
 * Install across 390px, which truncated the project's own name to make room.
 */
import { useState } from 'react'
import { addProject } from '../lib/repo'
import { openProject, openView } from '../lib/nav'
import { useRoute } from '../lib/useRoute'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'
import { LabelRow } from './LabelRow'
import { ProjectRow } from './ProjectRow'

export function Drawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { route, projects, labels } = useRoute()
  const openId = route.kind === 'project' ? route.projectId : null
  const openLabelId = route.kind === 'label' ? route.labelId : null
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
          {(['search', 'today', 'upcoming'] as const).map((kind) => (
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
            <ProjectRow
              key={project.id}
              project={project}
              current={project.id === openId}
              onNavigate={onClose}
            />
          ))}
        </ul>
        {labels.length > 0 && (
          <>
            <p className="px-3 pb-2 pt-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Labels
            </p>
            {/* Capped, and scrollable past the cap, for the same reason the
                projects list is: the drawer is a fixed-height column and
                whichever list grows without limit pushes the other off it. */}
            <ul className="max-h-48 shrink-0 overflow-y-auto">
              {labels.map((label) => (
                <LabelRow
                  key={label.id}
                  label={label}
                  current={label.id === openLabelId}
                  onNavigate={onClose}
                />
              ))}
            </ul>
          </>
        )}
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
