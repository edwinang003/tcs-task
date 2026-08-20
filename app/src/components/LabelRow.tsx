/**
 * One label in the drawer: where it goes, and what you can do to it.
 *
 * A component rather than a `<li>` inside a `.map()` because renaming
 * happens in place and `useInlineRename` is a hook. Each row owning its own
 * session is also the fix for a whole class of bug: two rows cannot both
 * think they are the one being renamed.
 *
 * Delete navigates nowhere. `resolveLabel` sends a route whose label is
 * gone to Inbox, so tombstoning the row moves the app on its own — and
 * undoing the delete brings the label and the route back together.
 */
import { useState } from 'react'
import { renameLabel, setLabelColor, deleteLabel } from '../lib/repo'
import { openLabel } from '../lib/nav'
import { PALETTE, dotClasses } from '../lib/labelling'
import { useInlineRename } from '../lib/useInlineRename'
import { pushUndo } from '../lib/undo'
import { Menu, MenuItem } from './Menu'
import type { Label } from '../lib/schema'
import type { InlineRename } from '../lib/useInlineRename'

export function LabelRow({
  label,
  current,
  onNavigate,
}: {
  label: Label
  /** Whether the open route is this label's. */
  current: boolean
  onNavigate: () => void
}) {
  const rename = useInlineRename(label.name, async (name) => {
    pushUndo(await renameLabel(label.id, name))
  })

  if (rename.renaming) {
    return (
      <li>
        <input
          {...rename.inputProps}
          aria-label="Label name"
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
          openLabel(label.id)
          onNavigate()
        }}
        // `min-w-0` so the name truncates rather than pushing the … off the
        // row: a flex item defaults to `min-width: auto`.
        className={
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left ' +
          (current
            ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300')
        }
      >
        <span
          aria-hidden="true"
          className={'size-2 shrink-0 rounded-full ' + dotClasses(label.color)}
        />
        <span className="truncate">{label.name}</span>
      </button>
      <Menu label={`Actions for ${label.name}`}>
        {(close) => <LabelMenu label={label} rename={rename} close={close} />}
      </Menu>
    </li>
  )
}

/**
 * The menu's two faces.
 *
 * `picking` lives here rather than on the row so that closing the menu
 * unmounts it: the next open starts at the item list again without anything
 * having to remember to reset it.
 */
function LabelMenu({
  label,
  rename,
  close,
}: {
  label: Label
  rename: InlineRename
  close: () => void
}) {
  const [picking, setPicking] = useState(false)

  if (picking) {
    return (
      // A row of eight, not a colour picker: the palette is a fixed set, so
      // every choice is one tap. Cycling on tap would be smaller and would
      // cost seven taps to reach one colour.
      <div role="group" aria-label="Label colour" className="flex gap-1 p-1">
        {PALETTE.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              close()
              void setLabelColor(label.id, key).then(pushUndo)
            }}
            aria-label={key}
            aria-pressed={key === label.color}
            className={
              'size-6 rounded-full ' +
              dotClasses(key) +
              (key === label.color ? ' ring-2 ring-accent ring-offset-2' : '')
            }
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <MenuItem
        onClick={() => {
          close()
          rename.start()
        }}
      >
        Rename
      </MenuItem>
      <MenuItem onClick={() => setPicking(true)}>Colour</MenuItem>
      <MenuItem
        danger
        onClick={() => {
          close()
          void deleteLabel(label.id).then(pushUndo)
        }}
      >
        Delete
      </MenuItem>
    </>
  )
}
