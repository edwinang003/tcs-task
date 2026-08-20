/**
 * One project in the drawer: where it goes, and what you can do to it.
 *
 * A component rather than a `<li>` inside a `.map()` because renaming
 * happens in place and `useInlineRename` is a hook. `LabelRow` is the same
 * shape for the same reason.
 *
 * Archive navigates nowhere. `resolveProject` sends a route whose project
 * is archived to Inbox, exactly as it did when this button was in the
 * header — so there is nothing to do here but write the row and push the
 * undo step.
 */
import { renameProject, archiveProject } from '../lib/repo'
import { openProject } from '../lib/nav'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
import { Menu, MenuItem } from './Menu'
import type { Project } from '../lib/schema'

export function ProjectRow({
  project,
  current,
  onNavigate,
}: {
  project: Project
  /** Whether the open route is this project's. */
  current: boolean
  onNavigate: () => void
}) {
  const rename = useInlineRename(project.name, async (name) => {
    pushUndo(await renameProject(project.id, name))
  })

  if (rename.renaming) {
    return (
      <li>
        <input
          {...rename.inputProps}
          aria-label="Project name"
          className="min-h-11 w-full rounded-xl bg-transparent px-3 text-neutral-900 outline-none dark:text-neutral-100"
        />
      </li>
    )
  }

  return (
    <li className="flex items-center">
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={() => {
          openProject(project.id)
          onNavigate()
        }}
        // `min-w-0` so the name truncates rather than pushing the … off the
        // row: a flex item defaults to `min-width: auto`.
        className={
          'min-h-11 min-w-0 flex-1 truncate rounded-xl px-3 text-left ' +
          (current
            ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300')
        }
      >
        {project.name}
      </button>
      <Menu label={`Actions for ${project.name}`}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                close()
                rename.start()
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close()
                pushUndo(await archiveProject(project.id))
              }}
            >
              Archive
            </MenuItem>
          </>
        )}
      </Menu>
    </li>
  )
}
