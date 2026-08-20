# P0b slice 9b — search filters

**Date:** 2026-08-20
**Status:** approved
**SPEC:** §4 (labels are cross-project tags and nothing else), §4.1 (a due
date is a date, not a timestamp), §5 (search is local and deliberately
dumb), §5.1 (a guess that hides itself is worse than no guess), §11.3
(dependency policy, and rule 2 on jsdom), §13 (P0b)
**Follows:** `2026-08-20-p0b-search-design.md`, which shipped 9a and named
this slice without specifying it

## Why this slice exists

9a answered "where did I put that" with words. This answers it when you do
not have the words.

The 9a design put the case plainly: search exists because capture beats
organisation, and an app that makes capture cheap accumulates tasks nobody
filed. But the query you actually have is rarely a clean phrase. It is
"the thing I was waiting on, from a while back" — a label you remember, a
date range you half-remember, and no title you could reproduce. Text
search cannot reach that. Chips can.

It also settles a debt. The slice 8 labels design deferred multi-label
filtering to this slice by name: a label route shows one label, and
"waiting-on **and** urgent" had nowhere to live. It lives here.

This closes P0b's scope line.

## What ships

- `filters.ts`, pure: the filter model, the combination rules, the four
  date presets.
- `FilterChips.tsx`: one scrolling row of chips under the search field.
- A contract change to `search`: no words now means no text constraint.
- `useLabels` widened to hand back the flat label list it already reads.
- One new empty state, for a query made of chips and no words.
- `app/README.md` brought up to date, as every slice before this one did.

## The decisions this design rests on

### 1. A chip is a query, not a refinement

The cheaper design is chips that only narrow words you already typed: no
words, no results, exactly as 9a behaves today. It is a smaller change —
`search` keeps its early return, the prompt state is untouched, and the
chips are a pure post-filter over hits that already exist.

**Rejected. A chip alone runs a query.**

The cheap version makes the most natural gesture unreachable. "Show me
everything labelled waiting-on that is overdue" is a question with no
words in it, and it is precisely the question a person asks when the
organisation has failed them — which the 9a design identified as the whole
reason this view exists. A filter that can only ever narrow a phrase you
already remembered serves the case where you needed help least.

It also overlaps badly. The label route already shows one label's tasks;
if a label chip could not stand alone, the chips would be a weaker copy of
a route that already exists rather than the thing that route cannot do.

What this costs is spelled out in decision 2: `search` has to stop
treating an empty query as "no results".

### 2. `search` gains no text constraint, not a second code path

With chips able to stand alone, there are two ways for a filter-only query
to reach the screen. Either the component branches — run `search` when
there are words, and some other listing function when there are not — or
`search` itself learns that an empty query constrains nothing.

**`search('')` now returns every task, in the title band, with a null
excerpt.**

This is a real change to a tested contract. The 9a design's test list
committed to "empty, whitespace-only and no-match queries returning `[]`",
and those tests are rewritten here rather than worked around. The new
contract reads: *the tasks whose title or notes contain every word — and
with no words, every task.*

The branching alternative was the first instinct and is worse in a
specific way. `search` does not only match text. It also drops tombstones
and tasks whose project is archived, and the 9a design chose to put those
rules inside `search` rather than in the reader, following
`progressByTask`'s precedent. A second listing path would have to
reimplement both, and the failure mode when it drifts is an archived
project's tasks appearing in one kind of query but not the other. One
entry point means the liveness rules are enforced once.

The ordering that makes this work is filters first, then text:

```
applyFilters(cx.tasks, filters, cx.labels)  →  search(query, narrowed, cx.projects)
                          ^ the by-task map
```

`search` keeps its two bands, its position ordering and its excerpt logic
untouched; it simply sees fewer rows. `filters.ts` never learns what a
band is.

### 3. The combination rules are asymmetric, and arithmetic decides it

| | Within a kind | Across kinds |
|---|---|---|
| Projects | **OR** | AND |
| Labels | **AND** | AND |
| Date | single-select | AND |

Two projects OR because a task belongs to exactly one project. ANDing them
would return the empty set every time — a control whose second use can
only ever be wrong. Two labels AND because §4 makes labels cross-project
tags a task carries many of, so the intersection is a question with
answers in it, and it is the one slice 8 deferred here by name.

The asymmetry is invisible from the user's side, which is the test it has
to pass: tapping a second project widens, tapping a second label narrows,
and in both cases the result is the set a person would have described.
Consistency between the two would mean picking a rule that is wrong for
one of them.

Date is single-select because the presets overlap — Overdue and Today are
adjacent, Today sits inside This week — so a multi-select would offer
combinations that are either redundant or contradictory. Tapping a second
preset replaces the first.

### 4. Four date presets, no picker

The presets, and the whole of their implementation:

```
overdue     due_on <  today
today       due_on == today
week        today <= due_on <= today+6
none        due_on == null
```

All four are string comparisons on `YYYY-MM-DD`, which is what §4.1 buys:
a due date is a date, so a task due Tuesday stays due Tuesday wherever you
are, and comparing two of them is comparing two strings. `dates.ts`
already has `todayLocal`, and `at` is injected the way `agenda.ts` and
`dates.ts` inject it — so "overdue, read at one minute past midnight" is a
unit test rather than a clock mock.

A from/to range was the alternative. It is strictly more expressive and
answers "what was due in July", which presets cannot. It costs two pieces
of state, a validity rule for `from > to`, and a native date input on a
phone — a heavy, modal interaction for a control whose value is flicking
on and off. P0b has very little historical use to serve.

`none` is the preset that earns its place hardest. Finding the tasks you
captured and never scheduled is exactly the failure this view exists to
repair, and it is the one question no other view in the app can answer:
Today and Upcoming both require a date to show a row at all.

Week uses `today+6` rather than a calendar week. A calendar week means
"this week" shrinks to nothing by Saturday, which is when you are most
likely to ask.

### 5. Every chip visible, in one scrolling row

Two alternatives were weighed.

**Dropdown chips** — `Project ▾`, `Label ▾`, `Date ▾`, each opening a
menu. Compact, and it scales to hundreds of projects. It costs a popover
or a sheet the app has never needed, with its own dismiss rules and focus
handling. The drawer already settled this preference: this app shows you a
list rather than making you open a menu.

**Facets derived from the results** — only chips for labels and projects
present in the current hits, with counts, so a filter can never return
nothing. Genuinely better at teaching you your own structure. Rejected
because the chips reflow on every keystroke, so the chip you are reaching
for moves out from under your thumb mid-tap. A moving target on a phone is
worse than a slightly long row.

**One horizontally-scrolling row: the four date presets, then every label
with its dot, then every project.** Tap toggles, tap again clears. The
label dots make the row scannable rather than a wall of words, which is
what makes showing everything viable at all. At personal scale — which the
eight-colour palette already assumes labels stay within — the row is short
enough to read at a glance, and when it is not, it degrades into a scroll
rather than a bug.

Each chip is a `<button type="button" aria-pressed>` inside a
`role="group" aria-label="Filters"`, so the state is announced rather than
carried by fill colour alone.

There is no clear-all. With every chip visible and its state on its face,
un-tapping is direct, and leaving the view resets everything anyway —
which is decision 6.

### 6. Chips are not persisted

The route persists; the query does not. `SearchList` already explains why:
results are recomputed live, and a query typed on Tuesday would silently
repopulate on Thursday against different data — §5.1's rule that a guess
which hides itself is worse than no guess.

**Chips are part of the query, so they clear with it** — on reload, and on
a cold start of the installed app.

The counter-argument is real and worth recording, because it nearly wins:
a chip is *not* hidden. It is on screen with its state visible, so a
persisted filter could not silently mislead you the way a persisted text
query could. What decides it is the cold start. The OS kills this app
constantly, and returning to Search to find three chips lit that you do
not remember setting means your first interaction is undoing state you did
not create. A view that starts empty every time is one you can trust
without reading it first.

## Architecture

### `lib/filters.ts` (new, pure)

```ts
export type DatePreset = 'overdue' | 'today' | 'week' | 'none'

export interface Filters {
  projects: Set<string>
  labels: Set<string>
  date: DatePreset | null
}

export const NO_FILTERS: Filters
export function hasAny(filters: Filters): boolean
export function applyFilters(
  tasks: Task[],
  filters: Filters,
  labelsByTask: Map<string, Label[]>,
  at?: Date,
): Task[]
```

DOM-free, like `agenda.ts`, `labelling.ts` and `search.ts`, so every rule
in it is tested by calling it. It takes the by-task label map
`useCrossProject` already holds rather than the raw link rows, because the
grouping is done once per list and re-deriving it per filter pass would be
the nested scan `tasksWithLabel` was written to avoid.

`date: null` and `date: 'none'` are different states and the names are
close enough to be worth spelling out: `null` means no date filter is on
at all, and `'none'` means filter *to* the tasks that have no date. The
chip row's fourth button writes the second one.

`NO_FILTERS` is a module-level frozen constant, not a factory. It is the
initial state of every `SearchList`, and a fresh object per render would
invalidate the memo that depends on it on every keystroke.

`hasAny` exists so the component can ask "is this query active at all"
without three length checks at the call site.

### `components/FilterChips.tsx` (new)

Props: `{ filters, onChange, projects: Project[], labels: Label[] }` —
`labels` here is the flat workspace list, not the by-task map
`applyFilters` takes. Presentational and
stateless — it renders the row and reports the next `Filters`. It owns no
subscriptions: `SearchList` already holds every row it needs, and a hook
in here would be a fourth copy of a query two hooks already run.

### `lib/search.ts` (modified)

One change, in `search`: an empty term list stops returning `[]` early and
instead lets every task through the text test into the title band. The
liveness rules — tombstone, archived project — run before it, unchanged,
so they still apply to a filter-only query. The file header's note that
`@label` and `#project` tokens "start here" is updated to point at
`filters.ts` as the shipped answer.

### `lib/useLabels.ts` (modified)

Returns `{ byTask, all }`. It already runs `listLabels()` and discards the
flat list after grouping; the chip row needs exactly that list. The
alternative was a second `useLiveQuery` on the same table inside
`useCrossProject`, which is one subscription too many for a value already
in hand. Two call sites move: `useCrossProject` and `TaskList`.

### `lib/useCrossProject.ts` (modified)

Gains `allLabels: Label[]` on `CrossProject`, passed straight through.
Today and Upcoming ignore it; it costs them nothing, because the
subscription behind it was already running.

### `components/SearchList.tsx` (modified)

Holds `filters` in `useState` beside `query`, composes the two pure
functions, renders `FilterChips` under the field, and gains one empty
state.

## Data flow

```
useCrossProject ─┬─ tasks ────────┐
                 ├─ labels ───────┤
                 ├─ allLabels ──┐ │
                 └─ projects ─┐ │ │
                              │ │ ▼
                    FilterChips◄┘ applyFilters(tasks, filters, labels)
                          │              │
                    onChange              ▼ narrowed
                          │        search(query, narrowed, projects)
                          ▼              │
                    setFilters           ▼ hits → CrossProjectRows
```

Every keystroke and every tap recomputes both, from rows already in
memory. §5 is explicit that this needs no index, and 9a demonstrated the
scan costs nothing at this scale. No debounce, for the reason 9a gives:
latency in the one interaction whose value is feeling instant.

## What the screen says

| State | Body |
|---|---|
| No words, no chips | `Search titles and notes.` (unchanged) |
| Active, reads pending | Blank `min-h-32` (unchanged) |
| Words, no hits | `Nothing matches “<query>”.` (unchanged) |
| Chips only, no hits | `Nothing matches these filters.` (new) |
| Hits | `N tasks` + rows (unchanged) |

"Active" is `terms(query).length > 0 || hasAny(filters)`. The chips-only
message names no chip: listing them would mean composing a sentence from
up to three kinds of filter, and the chips are already on screen above the
message with their state on their face.

## Error handling

There is nothing to fail. Every input is already in memory, both new
functions are pure and total, and neither reads nor writes the database —
so there is no path to `reportProblem` here. A label deleted on another
device while its chip is lit simply stops appearing in `allLabels` and its
id stops matching anything, which narrows the results to nothing and shows
the chips-only empty state. That is the honest answer, and it needs no
special case.

An unknown `DatePreset` cannot occur: the type is a closed union and the
only writer is the chip row.

## Testing

Unit tests, by calling the functions — no jsdom, no
`@testing-library/react` (§11.3 rule 2):

- `applyFilters`, dates — each preset at its boundary with an injected
  `at`: overdue read at one minute past midnight; `today` excluding
  yesterday and tomorrow; `week` including `today+6` and excluding
  `today+7`; `none` finding a task that has never had a date and excluding
  one that has.
- `applyFilters`, labels — a single label; two labels intersecting, where
  a task carrying only one of them is excluded; a task carrying neither
  excluded; a task carrying both plus a third included.
- `applyFilters`, projects — a single project; two projects unioning.
- `applyFilters`, combined — a project, a label and a date preset together,
  where a task failing exactly one of the three is excluded.
- `NO_FILTERS` returning every task, and returning them in the order given.
- `hasAny` — false for `NO_FILTERS`, true for each kind on its own.
- `search`, rewritten — an empty query returning every live task in
  position order with null excerpts; a whitespace-only query doing the
  same; both still dropping a tombstone and an archived project's task.

Browser-verified at 390×844 and 1280×900, zero console errors and zero
warnings — the standing bar. The pass covers: a label chip alone
producing results with no words typed; two label chips narrowing rather
than widening; two project chips widening; each date preset against
seeded data straddling its boundary; a date preset replacing another
rather than adding to it; chips combined with typed words; the chips-only
empty state; the row scrolling horizontally at 390px without the page
scrolling with it; `aria-pressed` reflecting state; a reload clearing
every chip while keeping the route; and Today, Upcoming and a label route
rendering unchanged after the `useLabels` change.

## Out of scope

- **Saved searches.** Nothing in P0b's scope line asks for them, and
  decision 6 has just argued that filter state should not outlive the
  visit.
- **A clear-all button.** Decision 5.
- **Chips on any other view.** Today, Upcoming and a label route each
  answer one question by construction; a filter row would make three views
  into one view with a mode.
- **`@label` and `#project` tokens in the query text.** Still P2's parser,
  which §5.1 requires to "show its work". These chips are the honest
  version, exactly as the 9a design predicted.
- **Counts on the chips.** That is the facet design decision 5 rejected,
  arriving by another door — the counts are what force the reflow.
- **Sorting results.** The two bands are the whole ordering, per 9a's
  decision 4.
