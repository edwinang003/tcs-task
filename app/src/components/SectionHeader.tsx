/**
 * A section's name, and the two things you can do to it.
 *
 * Only the done section collapses: one affordance and one piece of state, and
 * an open section has no reason to hide. The count sits next to the name for
 * the same reason a collapsed Done needs one — it is the only way to see how
 * much is behind it.
 */
import { useRef, useState } from 'react'
import { renameSection, deleteSection } from '../lib/repo'
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
  const [renaming, setRenaming] = useState(false)
  // Escape unmounts the focused rename input, and unmounting a focused input
  // fires a native blur — which would otherwise run the same commit path as a
  // real blur and rename the section. This flag lets Escape discard instead.
  // Same fix as the project rename in App.tsx.
  const cancelingRename = useRef(false)

  if (renaming) {
    return (
      <input
        defaultValue={section.name}
        autoFocus
        aria-label="Section name"
        onBlur={async (e) => {
          setRenaming(false)
          if (cancelingRename.current) {
            cancelingRename.current = false
            return
          }
          const name = e.target.value.trim()
          // A no-op edit should not push an undo step for a write that
          // changed nothing — `renameSection` does not check this itself, so
          // it is checked here, same as the project rename in App.tsx.
          if (name === section.name) return
          pushUndo(await renameSection(section.id, name))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelingRename.current = true
            setRenaming(false)
          }
        }}
        className="mt-4 min-h-11 w-full bg-transparent px-2 text-xs font-medium uppercase tracking-wide text-neutral-500 outline-none dark:text-neutral-400"
      />
    )
  }

  return (
    <div className="group/section mt-4 flex items-center gap-2 px-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={collapsed === null}
        aria-expanded={collapsed === null ? undefined : !collapsed}
        className="min-h-9 flex-1 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 disabled:cursor-default dark:text-neutral-400"
      >
        {collapsed === null ? '' : collapsed ? '▸ ' : '▾ '}
        {section.name}
        {count > 0 && (
          <span className="ml-2 text-neutral-400 dark:text-neutral-500">
            {count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setRenaming(true)}
        aria-label={`Rename ${section.name}`}
        className="min-h-9 px-2 text-xs text-neutral-400 opacity-0 transition-opacity group-hover/section:opacity-100 focus:opacity-100 dark:text-neutral-500"
      >
        Rename
      </button>
      {deletable && (
        <button
          type="button"
          onClick={async () => pushUndo(await deleteSection(section.id))}
          aria-label={`Delete ${section.name}`}
          className="min-h-9 px-2 text-xs text-red-600 opacity-0 transition-opacity group-hover/section:opacity-100 focus:opacity-100 dark:text-red-400"
        >
          Delete
        </button>
      )}
    </div>
  )
}
