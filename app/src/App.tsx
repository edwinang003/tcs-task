import { InstallButton } from './components/InstallButton'
import { QuickAdd } from './components/QuickAdd'
import { TaskList } from './components/TaskList'
import { UndoToast } from './components/Toast'
import { UpdatePrompt } from './components/UpdatePrompt'

/**
 * P0a — the walking skeleton (SPEC §13).
 *
 * One hardcoded list, add a task, complete a task, persisted in Dexie. It
 * exists to answer three questions before the other 90% is built: does an
 * installed PWA feel like an app, is the update flow tolerable, and is typing
 * a task genuinely faster than Google Tasks.
 */
export default function App() {
  return (
    <div className="flex h-full flex-col bg-white text-[15px] dark:bg-ink">
      <UpdatePrompt />
      <header
        className="border-b border-black/5 px-4 pb-3 dark:border-white/10"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Lane
          </h1>
          <InstallButton />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <TaskList />
      </main>

      <QuickAdd />
      <UndoToast />
    </div>
  )
}
