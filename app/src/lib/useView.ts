/**
 * List or board — the React seam.
 *
 * `view.ts` stores the choice and `resolveView` interprets its absence; this
 * is the hook between them. It lives here rather than in `view.ts` so
 * `view.ts` stays framework-free and its tests keep running without a DOM,
 * which is the same split as `nav.ts` / `useRoute.ts`.
 *
 * It used to subscribe to a `(min-width: 1024px)` media query as well, to
 * resolve a project with no stored choice differently on a phone. The board
 * is now the default at every width, so there is no second question to ask.
 */
import { useSyncExternalStore } from 'react'
import { subscribe, getViews, setView, resolveView } from './view'
import type { ViewMode } from './view'
import type { Project } from './schema'

export function useView(project: Project | undefined): {
  view: ViewMode
  setView: (mode: ViewMode) => void
} {
  const views = useSyncExternalStore(subscribe, getViews, getViews)

  const id = project?.id
  return {
    view: resolveView(id === undefined ? undefined : views[id]),
    // Before `listProjects` answers there is no project to remember a choice
    // against, and the toggle is not on screen either.
    setView: (mode: ViewMode) => {
      if (id !== undefined) setView(id, mode)
    },
  }
}
