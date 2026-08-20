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
 * No debounce. The rows are already in memory from the same live queries
 * Today reads, the scan touches two strings per task, and §5 is explicit that
 * this needs no index. A debounce would add latency to the one interaction
 * whose whole value is feeling instant.
 */
import { useMemo, useState } from 'react'
import { search } from '../lib/search'
import { useCrossProject } from '../lib/useCrossProject'
import { CrossProjectRows } from './CrossProjectRows'

export function SearchList({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const cx = useCrossProject()

  const hits = useMemo(
    () => search(query, cx.tasks, cx.projects),
    [query, cx.tasks, cx.projects],
  )
  const excerpts = useMemo(() => {
    const map = new Map<string, string>()
    for (const hit of hits) {
      if (hit.excerpt !== null) map.set(hit.task.id, hit.excerpt)
    }
    return map
  }, [hits])

  const typed = query.trim().length > 0

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

      {!typed ? (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Search titles and notes.
        </p>
      ) : !cx.loaded ? (
        // The reads have not answered. Blank rather than "nothing matches",
        // which would be a wrong answer rather than a missing one.
        <div className="min-h-32" />
      ) : hits.length === 0 ? (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Nothing matches “{query.trim()}”.
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
