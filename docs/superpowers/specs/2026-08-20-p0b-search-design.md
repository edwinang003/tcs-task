# P0b slice 9 — search

**Date:** 2026-08-20
**Status:** approved
**SPEC:** §5 (views, and why search is deliberately dumb), §5.1 (why a guess
that hides itself is worse than no guess), §6 (Inbox / Today / Upcoming /
Search in the must-have set), §9 (works fully offline), §11.3 (dependency
policy, and rule 2 on jsdom), §13 (P0b)

## Why this slice exists

§6 puts "Inbox / Today / Upcoming / Search" in the must-have set and §13 names
search as the last item in P0b's scope line. Everything else on that line has
shipped. This is what closes P0b.

It is also the last view that answers a different *kind* of question. A project
answers "what is in here", Today answers "what should I do", a label answers
"what am I waiting on" — each of them a place you keep things. Search answers
"where did I put that", which is the question you ask when the organisation has
already failed you. §5's principle is that capture beats organisation, and an
app that makes capture cheap accumulates tasks nobody filed. Search is the
other half of that bargain.

§5 also decides the implementation before this design starts:

> **Search is local and deliberately dumb.** IndexedDB has no full-text engine,
> and at personal scale it needs none: a case-insensitive substring scan over
> titles and notes across a few thousand rows is single-digit milliseconds.
> Build that, not an index.

So the interesting work here is not the matching. It is what is in the corpus,
how a match is explained on screen, and where the view lives — and the third
one is the reason a third cross-project view finally earns the extraction the
first two did not.

## What ships

Split into two plans against one design, as slice 8 was. **9a is independently
useful and shippable; 9b is useless without it.**

**9a — text**

- `search.ts`, pure: term splitting, the match rule, the two bands, the
  excerpt.
- A `search` route in `nav.ts`, and a **Search** row at the top of the drawer.
- `useCrossProject.ts` and `CrossProjectRows.tsx`, extracted from the two
  existing cross-project views and adopted by them.
- `SearchList.tsx`: the field, the count, the hits, and both empty states.
- An optional `excerpt` line on `TaskRow`.

**9b — filters**

- Filter chips beneath the field: by project, by label, by date.
- Multi-label filtering — the intersection the slice 8 design deferred here.
- Chips combine with the text query by AND, and each is removable.

9b is named here so the seams are cut for it, and specified in its own plan.

## The decisions this design rests on

### 1. Search is a route, not an overlay

The alternative was a palette over whatever you were looking at — a magnifier
in the header, Escape to dismiss, never persisted. It is the better shape in an
app with a keyboard at its centre, and it is not this app yet.

**It is a route, listed in the drawer above Today.**

Three reasons. `nav.ts` is the single place that knows where you are, and it
was built to be exactly that — "one string holds it", read through
`useSyncExternalStore`, no router. A palette would be a second navigation
concept living in component state next to the first, with its own rules about
what dismisses it and what happens to the route underneath. Second, the drawer
is already the answer to "where else could I be", and search is a where. Third,
a route survives a reload and a cold start of the installed app, which on a
phone is not a detail: the app is killed by the OS constantly, and a view you
cannot return to is a view you stop using.

What this costs is searching *without losing your place*, which the palette
gives for free. Returning is one tap on the drawer, and P2's keyboard shortcuts
can put a palette over this later — the matching core is a pure function and
does not care what renders it.

### 2. The route persists; the query does not

`nav.ts` writes the route to `localStorage` on every change. The query is not
written anywhere: it lives in `SearchList`'s own state and dies when you
navigate away.

Reopening the app on the search route therefore gives an empty field, not
yesterday's results. Restoring the text would present a stale answer as a
current one — the results are recomputed live, so a query typed on Tuesday
would silently repopulate on Thursday against different data, under a heading
that says nothing about when it was asked. §5.1's rule for the quick-add parser
is the same rule: a guess that hides itself is worse than no guess.

### 3. Terms are ANDed; the query is not one literal substring

The query is trimmed, lowercased and split on whitespace. A task matches when
**every** term appears somewhere in its title or its notes.

A literal substring scan is simpler and wrong in the common case: you remember
*that there was a task about calling the plumber*, you type `call plumber`, and
a literal match finds nothing because the title reads "call the plumber". The
words you recall are rarely contiguous and rarely in order. ANDing the terms
makes typing more words narrow the result, which is what the gesture means
everywhere else.

An empty query — or one that is only whitespace — matches **nothing**, rather
than everything. A field that dumps the entire workspace the moment it is
focused reads as broken, and the count line would open at a number that means
nothing.

### 4. A title match outranks a notes match, in bands rather than by score

Results are one flat list in two bands: tasks whose **title alone** satisfies
the whole query, then tasks that needed their notes. Within a band, the
workspace position order that `listAllTasks` already returns is preserved.

Not a relevance score. A score invites tuning — term frequency, field weights,
proximity — and none of it is explainable at the size of a row. Two bands is a
rule that can be stated in one sentence and predicted before you type. It is
also the only distinction that reliably matters: a title hit is what you meant
nearly every time, and everything below that line is one undifferentiated pile
of "mentioned somewhere".

Position order within a band, rather than by due date or recency, follows
`LabelList`'s reasoning: a result set that spans projects has no natural
priority, and imposing one claims a meaning the query did not carry.

### 5. Completed tasks are in the corpus; archived projects are not

`agenda.ts`'s `visible` excludes both — archived projects because the archive
would otherwise leak, and completed tasks because an agenda answers "what
should I do". Search inherits the first rule and breaks the second.

**Completed tasks are findable.** Half the reason to search is to find
something you already did: what you called that task, what its notes said, when
you finished it. A ticked task is also already on screen in its project's Done
section, so surfacing it here reveals nothing new — it is the same row in a
different order. It renders ticked, exactly as it does in its project.

**Archived projects stay out.** The corpus is built from the same
`listProjects` the drawer reads, so archiving remains one rule with one source
rather than a rule the archive has to re-argue in every view. §4.4 makes
archiving the safe default; a view that quietly ignores it would make it the
default that does not work.

Tombstones are dropped by `search` itself, even though `listAllTasks` has
already dropped them by the time it is called. That is `progressByTask`'s
precedent and its reasoning: the function is handed rows and is honest about
them on its own, so a caller that reaches past the reader cannot get an answer
that includes deleted rows.

### 6. A notes-only hit shows a plain-text excerpt

A row reading "call the agent" in a result list for `rent` looks like a bug in
the search. The row grows a second, dimmer line: the matching stretch of the
notes, ellipses where it was clipped, and newlines and runs of whitespace
collapsed to single spaces so a multi-paragraph note cannot break the row's
height.

The window is **80 characters, beginning up to 24 before the match** — enough
lead-in to read as a sentence rather than starting mid-word, and short enough
to fit one line at 390px without the truncation doing the clipping instead. It
anchors on the **earliest occurrence in the notes of any term**, not on the
first term in the query: with `call plumber` against a note that mentions the
plumber two paragraphs above the call, the useful excerpt is the one that comes
first on the page, and the order the words were typed in carries no meaning.

**Plain text, with no highlight markup.** Marking the term inside a string that
has already been clipped means splitting on match boundaries, escaping, and
deciding what happens when the window cuts a highlight in half — a real amount
of machinery for emphasis that a phone row renders at 13px. The excerpt already
answers the question the line exists to answer: *this is why you are seeing
this row*.

Title-band hits carry no excerpt. The title is the explanation.

### 7. No index, and no debounce

§5 rules out the index outright, and names the alternative for the day it stops
being true: an in-memory inverted index built at load, never a server round
trip, because a search that fails offline would violate the app's central
promise. Nothing here forecloses that — `search()` is a pure function over an
array, and its innards can be replaced without touching a caller.

No debounce either. The rows are already in memory, delivered by the same
`useLiveQuery` every other view uses; the scan touches two strings per task.
`useMemo` on `[query, tasks, projects]` keeps a re-render that changed neither
from re-scanning. A debounce would add latency to the one interaction whose
whole value is feeling instant.

### 8. Three cross-project views share a hook and a rows component

`AgendaList` and `LabelList` are already near-duplicates: the same four
subscriptions, the same loading guard, the same project-name map, the same
`<ul>` of `TaskRow`. They differ in grouping and in empty text. A search view
makes it three, and three is where the pattern has proven itself.

It extracts as **two** pieces rather than one, and the reason is worth stating
because the obvious single component does not work: `AgendaList` computes its
groups *from* `tasks` and `projects`, so it needs the query results in hand
before it can render anything. A component that owned the subscriptions could
only hand them back through a render prop.

So the data is a hook and the rows are a component — the same split as
`progress.ts`/`useProgress.ts` and `labelling.ts`/`useLabels.ts`, for the same
reason those exist.

## Architecture

### `search.ts` — pure

```ts
export interface Hit {
  task: Task
  /** The matching stretch of notes, for a notes-band hit. Null in the title band. */
  excerpt: string | null
}

export function search(query: string, tasks: Task[], projects: Project[]): Hit[]
export function terms(query: string): string[]
export function excerptAround(notes: string, terms: string[]): string | null
```

`terms` and `excerptAround` are exported to be tested directly: the clipping
window, the ellipses and the whitespace collapsing are fiddly enough to deserve
their own cases rather than being asserted through whole result sets.

`search` returns `[]` for an empty term list before it touches the task array,
which is decision 3's rule and also the cheapest path through the common state
of the view — an open field with nothing typed in it.

### `nav.ts` — a fourth arm

```ts
export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'label'; labelId: string }
  | { kind: 'search' }
```

Stored as the bare word `search`, exactly as `today` and `upcoming` are, and
parsed by one more branch beside theirs — ahead of the uuid fallback, which
would otherwise read the word as a project id. `openView` widens from
`'today' | 'upcoming'` to include it, which is also the whole of the drawer's
change: the array those rows are mapped from gains one word.

`captureTarget` needs **no new branch**. Its `project` case returns early and
everything else falls through to Inbox-undated, dating only on `today`. That is
the right answer — search has no date to assume and guessing one is §5.1's
silent mis-dating — but it is right by inheritance rather than by intent, so it
gets a test that pins it there.

`resolveProject` and `resolveLabel` are untouched: a search route names nothing
that can be deleted underneath it.

### `useCrossProject.ts` — the React seam

```ts
export interface CrossProject {
  tasks: Task[]
  projects: Project[]
  /** project id → name, for the row badge. */
  names: Map<string, string>
  progress: Map<string, Progress>
  labels: Map<string, Label[]>
  /** False until the tasks and projects reads have both answered. */
  loaded: boolean
}

export function useCrossProject(): CrossProject
```

The two live queries plus `useProgress` and `useLabels`, with the names map
memoized on the projects read. `loaded` is the guard all three views already
implement identically — blank rather than a spinner, because the read resolves
in a frame or two and a flash of spinner reads as slow.

### `CrossProjectRows.tsx` — the rows

```tsx
<CrossProjectRows
  tasks={hits}
  cx={cx}
  onOpen={onOpen}
  excerpts={excerpts}   // optional: task id → excerpt, search only
/>
```

The `<ul>` of `TaskRow`, with the badge, progress and labels wired from the
hook's maps, and `hidesOnComplete` left at its default — a ticked row stays on
screen in every cross-project view, because none of them has a Done section to
move it into and a row vanishing under the thumb is what that prop exists to
prevent. No empty state and no heading: an empty list renders nothing, and
each caller draws its own message and its own headings around it. That keeps
`AgendaList`'s per-group heading where it is today.

### `SearchList.tsx`

The field, `autoFocus`, with the query in `useState`. Beneath it a count line,
then one `CrossProjectRows`. Three body states:

| State | What it draws |
| --- | --- |
| No query typed | `Search titles and notes.` |
| Query, no hits | `Nothing matches “rent”.` |
| Query with hits | `3 tasks`, then the rows |

The field takes focus on mount, which raises the keyboard on a phone. That is
the right default for a view you deliberately navigated to — the alternative is
arriving at a search view and having to tap once more to search — and it is
called out for the device pass to overturn if it feels wrong in the hand.

### The rest

- `TaskRow.tsx` — one optional `excerpt` prop, exactly as it took `progress`
  and `labels`. A second line, dimmer, truncated to one.
- `Drawer.tsx` — `search` joins the mapped array above `today`. No icon: these
  rows are plain words, and one row carrying a glyph reads as a different kind
  of thing.
- `App.tsx` — `TITLES` gains `search: 'Search'`, and the body gains the branch.
  The header's Rename, Archive and Board buttons are already gated on
  `route.kind === 'project'` and need no change. Quick add stays, as it does
  everywhere.
- `AgendaList.tsx`, `LabelList.tsx` — adopt the hook and the rows component.
  Their grouping, ordering and empty text are unchanged, which is what their
  existing tests and the device pass confirm.

## Data flow

Typing `rent` into the field:

1. `SearchList` sets its query state; nothing is written anywhere.
2. `useCrossProject`'s subscriptions have already delivered every live task and
   project — the same reads Today and the label view are built on.
3. `search('rent', tasks, projects)` splits the term, drops tasks whose project
   is not live, keeps the rest whose title or notes contain it, sorts the title
   band above the notes band, and attaches an excerpt to each notes-band hit.
4. `CrossProjectRows` draws the hits, each badged with its project's name.
5. Ticking a hit calls `setTaskDone` through the repository, exactly as it does
   in every other view: the row and its outbox entry in one transaction, an
   `UndoStep` to the toast. The live query fires, the scan re-runs, and the row
   stays where it is — its title did not change, so it still matches.

## Error handling

Search writes nothing, so it has no failure of its own: no outbox entry, no
`reportProblem` path, no optimistic state to hand back. What it has is three
edges worth naming.

**Before the reads answer**, `loaded` is false and the body is blank — not a
"no results" message, which would be a wrong answer rather than a missing one.

**A task renamed out of its own result set** disappears from under the thumb.
This is accepted: renaming happens in the task sheet, which covers the list on
a phone, so the row is gone before it is visible again. The same is true of a
project archived on another device mid-search.

**A hit whose project vanished** cannot render a badge. It cannot happen —
the corpus is built from the same project list the badge is read from, so a
task whose project left the list is not a hit in the first place.

## Testing

Unit-tested without a DOM, per §11.3 rule 2 — no jsdom, no
`@testing-library/react`:

- `terms` — splitting on runs of whitespace, trimming, lowercasing, and an
  empty or whitespace-only query yielding no terms at all.
- `search.ts` — case folding both ways; multi-term AND, including terms split
  across title and notes; a term matching mid-word; the title band ordering
  above the notes band and position order within each; an excerpt on a
  notes-only hit and none on a title hit; a completed task found; an archived
  project's task not found; a tombstone not found; empty, whitespace-only and
  no-match queries returning `[]`.
- `excerptAround` — the window around a match at the start, the middle and the
  end of a long note; ellipses only where it clipped; newlines and repeated
  spaces collapsed; a note shorter than the window returned whole.
- `nav.ts` — `search` parses, round-trips through storage, and does not fall
  through to the project branch; `openView('search')`; `captureTarget` on a
  search route landing in Inbox, undated.

The components are verified in a real browser at 390×844 and 1280×900, with
zero console errors and zero warnings — the standing bar. The pass covers:
navigating in from the drawer and the field taking focus; typing and watching
hits narrow; a notes-only hit showing its excerpt; tapping a hit to open the
sheet; ticking a hit and seeing it stay put with the undo toast; both empty
states; a reload keeping the route and clearing the field; and Today, Upcoming
and a label route rendering unchanged after the extraction.

## Out of scope

- **Filters — by project, label or date.** Slice 9b, specified above.
- **Highlight markup inside the excerpt.** Decision 6.
- **Checklist item text in the corpus.** §5 scopes matching to title and notes.
  Items are sub-steps of a task that already matched on its own words, and
  including them would put rows in the list whose visible text contains nothing
  you typed.
- **`@label`, `#project` and date tokens in the query.** §5.1's parser is P2,
  and it must "show its work" to be worth having; 9b's chips are the honest
  version of the same filtering.
- **Ctrl+K, or search from anywhere.** P2's keyboard shortcuts. Decision 1
  leaves the door open.
- **An inverted index, MiniSearch, or any dependency.** Decision 7, and §5.
- **Sorting results by due date or recency.** Decision 4.
