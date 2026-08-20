/**
 * What you can do to the label you are looking at.
 *
 * In the header, not on the drawer row, because that is where a project's
 * rename and archive live and `Drawer.tsx` says why: "the drawer stays a place
 * you pass through rather than a control panel."
 *
 * Delete navigates nowhere. `resolveLabel` sends a route whose label is gone
 * to Inbox, so tombstoning the row moves the app on its own — and undoing the
 * delete brings the label and the route back together.
 */
import { useState } from 'react'
import { setLabelColor, deleteLabel } from '../lib/repo'
import { PALETTE, dotClasses } from '../lib/labelling'
import { pushUndo } from '../lib/undo'
import type { Label } from '../lib/schema'
import type { InlineRename } from '../lib/useInlineRename'

export function LabelHeader({
  label,
  rename,
}: {
  label: Label
  rename: InlineRename
}) {
  const [picking, setPicking] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setPicking((open) => !open)}
        aria-expanded={picking}
        aria-label={`Colour ${label.name}`}
        className="min-h-11 shrink-0 px-2"
      >
        <span
          aria-hidden="true"
          className={'block size-3 rounded-full ' + dotClasses(label.color)}
        />
      </button>
      <button
        type="button"
        onClick={rename.start}
        disabled={rename.renaming}
        className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => void deleteLabel(label.id).then(pushUndo)}
        className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
      >
        Delete
      </button>
      {picking && (
        // A row of eight, not a colour picker: the palette is a fixed set
        // (design, decision 3), so every choice is one tap. Cycling on tap
        // would be smaller and would cost seven taps to reach one colour.
        <div
          role="group"
          aria-label="Label colour"
          className="absolute right-2 top-full z-30 mt-1 flex gap-1 rounded-xl border border-black/10 bg-white p-2 shadow-lg dark:border-white/15 dark:bg-ink"
        >
          {PALETTE.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPicking(false)
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
      )}
    </>
  )
}
