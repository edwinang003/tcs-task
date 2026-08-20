/**
 * Search — the field, and what it found.
 *
 * The query lives here and nowhere else. `nav.ts` persists the *route*, so
 * reopening the installed app comes back to this view; it deliberately does
 * not persist the text, because results are recomputed live and a query typed
 * on Tuesday would silently repopulate on Thursday against different data.
 * §5.1's rule for the quick-add parser is the same rule: a guess that hides
 * itself is worse than no guess.
 *
 * The chips are the same query and clear the same way. A chip is *not*
 * hidden the way a stale text query is, which nearly argues for persisting
 * them; what decides it is the cold start. The OS kills this app
 * constantly, and coming back to three lit chips you do not remember
 * setting means your first interaction is undoing state you did not create.
 *
 * No debounce. The rows are already in memory from the same live queries
 * Today reads, the scan touches two strings per task, and §5 is explicit that
 * this needs no index. A debounce would add latency to the one interaction
 * whose whole value is feeling instant.
 */
import { useMemo, useState } from 'react'
import { search, terms } from '../lib/search'
import { applyFilters, hasAny, NO_FILTERS } from '../lib/filters'
import type { Filters } from '../lib/filters'
import { useCrossProject } from '../lib/useCrossProject'
import { CrossProjectRows } from './CrossProjectRows'
import { FilterChips } from './FilterChips'

export function SearchList({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const cx = useCrossProject()

  // Filters first, then text (design, decision 2). `search` keeps its bands,
  // its ordering and the tombstone and archived-project rules; it simply
  // sees fewer rows. `applyFilters` never learns what a band is.
  //
  // `at` is left at its default here, the way `AgendaList` leaves it: the
  // date presets are recomputed on every keystroke and every tap, and the
  // view is remounted on every cold start, so the only way to hold a stale
  // "today" is to sit on this screen through midnight touching nothing.
  const narrowed = useMemo(
    () => applyFilters(cx.tasks, filters, cx.labels),
    [cx.tasks, filters, cx.labels],
  )
  const hits = useMemo(
    () => search(query, narrowed, cx.projects),
    [query, narrowed, cx.projects],
  )
  const excerpts = useMemo(() => {
    const map = new Map<string, string>()
    for (const hit of hits) {
      if (hit.excerpt !== null) map.set(hit.task.id, hit.excerpt)
    }
    return map
  }, [hits])

  const words = terms(query).length > 0
  // A chip alone is a query (decision 1), so "is there anything to show" is
  // no longer "did they type".
  const active = words || hasAny(filters)

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Focused on arrival: this is a view you navigated to on purpose, and
        // asking for one more tap before you can type is a poor greeting. On
        // a phone it raises the keyboard, which is the intent.
        autoFocus
        type="search"
        placeholder="Search titles and notes"
        aria-label="Search"
        enterKeyHint="search"
        className="min-h-11 w-full rounded-xl bg-black/5 px-3 text-neutral-900 outline-none placeholder:text-neutral-400 dark:bg-white/10 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />

      <FilterChips
        filters={filters}
        onChange={setFilters}
        projects={cx.projects}
        labels={cx.allLabels}
      />

      {!active ? (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Search titles and notes.
        </p>
      ) : !cx.loaded ? (
        // The reads have not answered. Blank rather than "nothing matches",
        // which would be a wrong answer rather than a missing one.
        <div className="min-h-32" />
      ) : hits.length === 0 ? (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          {words ? (
            <>Nothing matches “{query.trim()}”.</>
          ) : (
            // Naming the chips here would mean composing a sentence out of
            // up to three kinds of filter, and they are already on screen
            // above this line with their state on their faces.
            <>Nothing matches these filters.</>
          )}
        </p>
      ) : (
        <>
          <p className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {hits.length} {hits.length === 1 ? 'task' : 'tasks'}
          </p>
          <CrossProjectRows
            tasks={hits.map((hit) => hit.task)}
            cx={cx}
            onOpen={onOpen}
            excerpts={excerpts}
          />
        </>
      )}
    </div>
  )
}
