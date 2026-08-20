/**
 * The chips under the search field.
 *
 * Presentational and stateless: it renders the row and reports the next
 * `Filters`. It owns no subscriptions — `SearchList` already holds every row
 * it needs, and a hook in here would be a fourth copy of a query two hooks
 * already run.
 *
 * Every chip is visible rather than behind a menu (design, decision 5). The
 * drawer settled that preference for this app: a list you can see beats a
 * menu you have to open, and dropdowns would want a popover with its own
 * dismiss and focus rules that nothing here has needed yet. Deriving the
 * chips from the current results instead — only what would match, with
 * counts — is the tempting third option, and it reflows the row on every
 * keystroke, so the chip you are reaching for moves out from under your
 * thumb mid-tap.
 *
 * The row scrolls sideways when it outgrows the screen. At the scale the
 * eight-colour palette assumes labels stay within, that is rare.
 */
import { dotClasses } from '../lib/labelling'
import type { DatePreset, Filters } from '../lib/filters'
import type { Label, Project } from '../lib/schema'

const DATES: { key: DatePreset; text: string }[] = [
  { key: 'overdue', text: 'Overdue' },
  { key: 'today', text: 'Today' },
  { key: 'week', text: 'This week' },
  { key: 'none', text: 'No date' },
]

/**
 * One toggle.
 *
 * `aria-pressed` carries the state; the fill only shows it. `min-h-11` is
 * every other tap target in this app, and a chip is no easier to hit for
 * being small.
 */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ' +
        (on
          ? 'bg-accent/15 font-medium text-neutral-900 dark:text-neutral-100'
          : 'bg-black/5 text-neutral-600 dark:bg-white/10 dark:text-neutral-300')
      }
    >
      {children}
    </button>
  )
}

/** A `Set` with one member added or removed. Nothing here mutates state. */
function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

export function FilterChips({
  filters,
  onChange,
  projects,
  labels,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  projects: Project[]
  /** The flat workspace list, not the by-task map `applyFilters` takes. */
  labels: Label[]
}) {
  return (
    <div
      role="group"
      aria-label="Filters"
      // Bled to the screen edges past the page's own padding, because a
      // horizontal scroller that stops short of the edge reads as clipped
      // rather than as scrollable. The scrollbar is hidden on the platforms
      // that draw one over the content.
      className="-mx-3 flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {DATES.map((preset) => (
        <Chip
          key={preset.key}
          on={filters.date === preset.key}
          onClick={() =>
            onChange({
              ...filters,
              // Single-select: the lit one clears, another replaces. The
              // presets overlap — Today sits inside This week — so any
              // combination is either redundant or contradictory.
              date: filters.date === preset.key ? null : preset.key,
            })
          }
        >
          {preset.text}
        </Chip>
      ))}

      {labels.map((label) => (
        <Chip
          key={label.id}
          on={filters.labels.has(label.id)}
          onClick={() =>
            onChange({ ...filters, labels: toggle(filters.labels, label.id) })
          }
        >
          {/* Decoration: the name is right beside it. */}
          <span
            aria-hidden="true"
            className={'size-2 shrink-0 rounded-full ' + dotClasses(label.color)}
          />
          {label.name}
        </Chip>
      ))}

      {projects.map((project) => (
        <Chip
          key={project.id}
          on={filters.projects.has(project.id)}
          onClick={() =>
            onChange({
              ...filters,
              projects: toggle(filters.projects, project.id),
            })
          }
        >
          {project.name}
        </Chip>
      ))}
    </div>
  )
}
