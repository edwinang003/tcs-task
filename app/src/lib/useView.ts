/**
 * List or board — the React seam.
 *
 * `view.ts` stores the choice and `resolveView` interprets its absence; this is
 * the hook between them. It lives here rather than in `view.ts` so `view.ts`
 * stays framework-free and its tests keep running without a DOM, which is the
 * same split as `nav.ts` / `useRoute.ts`.
 */
import { useSyncExternalStore } from 'react'
import { subscribe, getViews, setView, resolveView } from './view'
import type { ViewMode } from './view'
import type { Project } from './schema'

/**
 * Tailwind's `lg` — the same width at which the drawer stops being an overlay
 * and becomes a sidebar. Subscribed rather than read once, so that rotating a
 * tablet re-resolves a project that has no stored choice of its own.
 */
const WIDE = '(min-width: 1024px)'

function subscribeWidth(listener: () => void): () => void {
  const query = matchMedia(WIDE)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function isWide(): boolean {
  return matchMedia(WIDE).matches
}

export function useView(project: Project | undefined): {
  view: ViewMode
  setView: (mode: ViewMode) => void
} {
  const views = useSyncExternalStore(subscribe, getViews, getViews)
  const wide = useSyncExternalStore(subscribeWidth, isWide, isWide)

  const id = project?.id
  return {
    view: resolveView(
      id === undefined ? undefined : views[id],
      wide,
      project?.default_view ?? 'list',
    ),
    // Before `listProjects` answers there is no project to remember a choice
    // against, and the toggle is not on screen either.
    setView: (mode: ViewMode) => {
      if (id !== undefined) setView(id, mode)
    },
  }
}
