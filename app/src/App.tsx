import { useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { InstallButton } from './components/InstallButton'
import { QuickAdd } from './components/QuickAdd'
import { TaskList } from './components/TaskList'
import { UndoToast } from './components/Toast'
import { TaskSheet } from './components/TaskSheet'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Drawer } from './components/Drawer'
import { listProjects, renameProject, archiveProject } from './lib/repo'
import { subscribe, getRoute, resolveProject } from './lib/nav'
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
  const [renaming, setRenaming] = useState(false)
  // Escape unmounts the focused rename input, and unmounting a focused input
  // fires a native blur — which would otherwise run the same commit path as a
  // real blur and rename the project. This flag lets Escape discard instead.
  const cancelingRename = useRef(false)

  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])
  const openId = resolveProject(projects ?? [], route)
  const project = (projects ?? []).find((p) => p.id === openId)

  function startRenaming() {
    cancelingRename.current = false
    setRenaming(true)
  }

  async function archive() {
    if (project === undefined) return
    pushUndo(await archiveProject(project.id))
  }

  return (
    <div className="flex h-full bg-white text-[15px] dark:bg-ink">
      <UpdatePrompt />
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
            {renaming && project !== undefined ? (
              <input
                defaultValue={project.name}
                autoFocus
                aria-label="Project name"
                onBlur={async (e) => {
                  setRenaming(false)
                  if (cancelingRename.current) {
                    cancelingRename.current = false
                    return
                  }
                  const name = e.target.value.trim()
                  // A no-op edit should not push an undo step for a write that
                  // changed nothing — `renameProject` does not check this
                  // itself, so it is checked here.
                  if (name === project.name) return
                  pushUndo(await renameProject(project.id, name))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    cancelingRename.current = true
                    setRenaming(false)
                  }
                }}
                className="min-h-11 flex-1 bg-transparent text-lg font-semibold tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
              />
            ) : (
              <h1
                onDoubleClick={startRenaming}
                className="flex-1 truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {project?.name ?? 'Lane'}
              </h1>
            )}
            <button
              type="button"
              onClick={startRenaming}
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
