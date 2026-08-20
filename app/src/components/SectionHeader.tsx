/**
 * A section's name, and the two things you can do to it.
 *
 * Both live behind a … rather than beside the name. Rename and Delete were
 * on screen on every section of every project, in grey and in red, around
 * maybe a dozen tasks — eight words of chrome for two actions you use about
 * twice a month. `TaskRow` hides its × on hover, which is the same
 * instinct, but hover does not exist on a phone and these two have to stay
 * reachable there, so the trigger stays and the actions are what hides.
 *
 * Only the done section collapses: one affordance and one piece of state, and
 * an open section has no reason to hide. The count sits next to the name for
 * the same reason a collapsed Done needs one — it is the only way to see how
 * much is behind it.
 */
import { renameSection, deleteSection } from '../lib/repo'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
import { Menu, MenuItem } from './Menu'
import type { Section } from '../lib/schema'

export function SectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  deletable,
}: {
  section: Section
  count: number
  collapsed: boolean | null
  onToggle: () => void
  deletable: boolean
}) {
  const rename = useInlineRename(section.name, async (name) => {
    pushUndo(await renameSection(section.id, name))
  })

  if (rename.renaming) {
    return (
      <input
        {...rename.inputProps}
        aria-label="Section name"
        className="mt-4 min-h-11 w-full bg-transparent px-2 text-xs font-medium uppercase tracking-wide text-neutral-500 outline-none dark:text-neutral-400"
      />
    )
  }

  const label = (
    <>
      {collapsed === null ? '' : collapsed ? '▸ ' : '▾ '}
      {section.name}
      {count > 0 && (
        <span className="ml-2 text-neutral-400 dark:text-neutral-500">
          {count}
        </span>
      )}
    </>
  )

  return (
    <div className="mt-4 flex items-center gap-2 px-2">
      {collapsed === null ? (
        <h2 className="min-h-11 flex-1 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </h2>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="min-h-11 flex-1 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          {label}
        </button>
      )}
      <Menu label={`Actions for ${section.name}`}>
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
            {deletable && (
              <MenuItem
                danger
                onClick={async () => {
                  close()
                  try {
                    pushUndo(await deleteSection(section.id))
                  } catch {
                    // The row is already gone — a second tap before the
                    // live query caught up. The user asked for it deleted
                    // and it is deleted; there is nothing to say.
                  }
                }}
              >
                Delete
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </div>
  )
}
