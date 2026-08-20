/**
 * A task's labels, as dots on its row.
 *
 * A row at 390px already carries a checkbox, a title, `Today`, a `1/3`
 * counter and — in the agenda views — its project name. Named chips are what
 * most task apps show and what would wrap that row onto a second line, so this
 * shows colour only: enough to answer "is this tagged, and roughly how", with
 * the names one tap away in the sheet.
 *
 * The names still reach a screen reader, and the browser's tooltip, through
 * the wrapper — the dots themselves are decoration.
 */
import { dotClasses } from '../lib/labelling'
import type { Label } from '../lib/schema'

/**
 * Three, with no overflow marker. A fourth dot on a phone row is noise rather
 * than information, and someone with four labels on one task is served by
 * opening it.
 */
const SHOWN = 3

export function LabelDots({ labels }: { labels?: Label[] }) {
  if (labels === undefined || labels.length === 0) return null
  const names = labels.map((label) => label.name).join(', ')

  return (
    <span
      role="img"
      aria-label={names}
      title={names}
      className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle"
    >
      {labels.slice(0, SHOWN).map((label) => (
        <span
          key={label.id}
          aria-hidden="true"
          className={'size-2 rounded-full ' + dotClasses(label.color)}
        />
      ))}
    </span>
  )
}
