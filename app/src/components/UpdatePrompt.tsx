/**
 * The update flow.
 *
 * SPEC §13, P0a: one of the three questions this skeleton exists to answer is
 * "is the update flow tolerable?" — so it is visible from the first build
 * rather than bolted on later. SPEC §9.8: a PWA cannot force an update, so the
 * user is asked rather than swapped underneath.
 *
 * SPEC §11.3 rule 1: the only file importing the plugin's runtime.
 */
import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-3 top-3 z-20 flex items-center gap-3 rounded-xl border border-black/10 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-800/95">
      <span className="flex-1 text-neutral-700 dark:text-neutral-200">
        A new version of Lane is ready.
      </span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="rounded-lg bg-accent px-3 py-1.5 font-medium text-ink"
      >
        Reload
      </button>
    </div>
  )
}
