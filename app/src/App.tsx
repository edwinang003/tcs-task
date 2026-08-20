import { useState } from 'react'
import { InstallButton } from './components/InstallButton'
import { QuickAdd } from './components/QuickAdd'
import { TaskList } from './components/TaskList'
import { UndoToast } from './components/Toast'
import { ProblemToast } from './components/ProblemToast'
import { TaskSheet } from './components/TaskSheet'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Drawer } from './components/Drawer'
import { AgendaList } from './components/AgendaList'
import { LabelList } from './components/LabelList'
import { renameProject, archiveProject } from './lib/repo'
import { useRoute } from './lib/useRoute'
import { useView } from './lib/useView'
import { useInlineRename } from './lib/useInlineRename'
import { pushUndo } from './lib/undo'

/** The two views that are not projects, and the header they cannot use. */
const TITLES = { today: 'Today', upcoming: 'Upcoming' }

/**
 * P0b slice 6 — the same project as a list or a board (SPEC §5, §13).
 *
 * The drawer is an overlay on a phone and a pinned sidebar from `lg` up, which
 * is why the layout is a flex row rather than the single column P0a had.
 *
 * Rename and Archive leave the header on an agenda route rather than being
 * disabled there: a button that never enables is worse than an absent one.
 */
export default function App() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { route, project, label, loaded } = useRoute()
  const { view, setView } = useView(project)

  const rename = useInlineRename(project?.name ?? '', async (name) => {
    if (project === undefined) return
    pushUndo(await renameProject(project.id, name))
  })

  const title =
    route.kind === 'project'
      ? loaded
        ? (project?.name ?? 'Lane')
        : ''
      : route.kind === 'label'
        ? // Blank rather than 'Lane' until the label's own query answers:
          // the name arrives in a frame or two, and a placeholder that
          // flashes a different word first reads as the wrong page.
          (label?.name ?? '')
        : TITLES[route.kind]

  async function archive() {
    if (project === undefined) return
    pushUndo(await archiveProject(project.id))
  }

  return (
    <div className="flex h-full bg-white text-[15px] dark:bg-ink">
      <UpdatePrompt />
      <ProblemToast />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="border-b border-black/5 px-4 pb-3 dark:border-white/10"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button
              type="button"
              aria-label="Projects"
              onClick={() => setDrawerOpen(true)}
              className="-ml-2 min-h-11 px-2 text-neutral-500 lg:hidden dark:text-neutral-400"
            >
              ☰
            </button>
            {route.kind === 'project' && rename.renaming && project !== undefined ? (
              <input
                {...rename.inputProps}
                aria-label="Project name"
                className="min-h-11 flex-1 bg-transparent text-lg font-semibold tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
              />
            ) : (
              <h1
                onDoubleClick={route.kind === 'project' ? rename.start : undefined}
                className="flex-1 truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {title}
              </h1>
            )}
            {route.kind === 'project' && (
              <>
                <button
                  type="button"
                  onClick={() => setView(view === 'board' ? 'list' : 'board')}
                  // A toggle button, not two: the phone header already carries
                  // ☰, the title, Rename, Archive and Install. `aria-pressed`
                  // is why the label stays "Board" in both states — a label
                  // that flipped to "List" would read as a different button to
                  // a screen reader that was just told the state.
                  aria-pressed={view === 'board'}
                  // Named by the label rather than the text, because the text
                  // is a glyph on a phone: five words across a 390px header
                  // truncated the project's own name to "P…".
                  aria-label="Board"
                  className={
                    'min-h-11 rounded-lg px-2 text-sm ' +
                    (view === 'board'
                      ? 'bg-accent/15 text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-500 dark:text-neutral-400')
                  }
                >
                  <span aria-hidden="true" className="lg:hidden">
                    ▥
                  </span>
                  <span className="hidden lg:inline">Board</span>
                </button>
                <button
                  type="button"
                  onClick={rename.start}
                  disabled={rename.renaming}
                  className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={archive}
                  className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
                >
                  Archive
                </button>
              </>
            )}
            <InstallButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {route.kind === 'project' ? (
            <TaskList
              projectId={route.projectId}
              view={view}
              onOpen={setOpenTaskId}
            />
          ) : route.kind === 'label' ? (
            <LabelList labelId={route.labelId} onOpen={setOpenTaskId} />
          ) : (
            <AgendaList kind={route.kind} onOpen={setOpenTaskId} />
          )}
        </main>

        <QuickAdd />
      </div>

      <UndoToast />
      {openTaskId !== null && (
        // Keyed by id so switching tasks remounts with a clean draft rather
        // than merging two tasks' edits.
        <TaskSheet
          key={openTaskId}
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  )
}
