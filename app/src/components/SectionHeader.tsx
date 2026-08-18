/**
 * A section's name, and the two things you can do to it.
 *
 * Only the done section collapses: one affordance and one piece of state, and
 * an open section has no reason to hide. The count sits next to the name for
 * the same reason a collapsed Done needs one — it is the only way to see how
 * much is behind it.
 */
import { renameSection, deleteSection } from '../lib/repo'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
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
      <button
        type="button"
        onClick={rename.start}
        aria-label={`Rename ${section.name}`}
        className="min-h-11 px-2 text-xs text-neutral-400 dark:text-neutral-500"
      >
        Rename
      </button>
      {deletable && (
        <button
          type="button"
          onClick={async () => {
            try {
              pushUndo(await deleteSection(section.id))
            } catch {
              // The row is already gone — a second tap before the live query
              // caught up. The user asked for it deleted and it is deleted;
              // there is nothing to say.
            }
          }}
          aria-label={`Delete ${section.name}`}
          className="min-h-11 px-2 text-xs text-red-600 dark:text-red-400"
        >
          Delete
        </button>
      )}
    </div>
  )
}
