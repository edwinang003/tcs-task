import { useState } from 'react'
import { InstallButton } from './components/InstallButton'
import { QuickAdd } from './components/QuickAdd'
import { TaskList } from './components/TaskList'
import { UndoToast } from './components/Toast'
import { ProblemToast } from './components/ProblemToast'
import { TaskSheet } from './components/TaskSheet'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Drawer } from './components/Drawer'
import { renameProject, archiveProject } from './lib/repo'
import { useOpenProject } from './lib/useOpenProject'
import { useInlineRename } from './lib/useInlineRename'
import { pushUndo } from './lib/undo'

/**
 * P0b slice 3 — projects and sections (SPEC §13).
 *
 * The drawer is an overlay on a phone and a pinned sidebar from `lg` up, which
 * is why the layout is a flex row rather than the single column P0a had.
 */
export default function App() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { project, loaded } = useOpenProject()

  const rename = useInlineRename(project?.name ?? '', async (name) => {
    if (project === undefined) return
    pushUndo(await renameProject(project.id, name))
  })

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
            {rename.renaming && project !== undefined ? (
              <input
                {...rename.inputProps}
                aria-label="Project name"
                className="min-h-11 flex-1 bg-transparent text-lg font-semibold tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
              />
            ) : (
              <h1
                onDoubleClick={rename.start}
                className="flex-1 truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {loaded ? (project?.name ?? 'Lane') : ''}
              </h1>
            )}
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
            <InstallButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <TaskList onOpen={setOpenTaskId} />
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
