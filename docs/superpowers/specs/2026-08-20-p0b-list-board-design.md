# P0b slice 6 — the same project as a list or a board

**Status:** approved, not yet implemented
**Date:** 2026-08-20
**Spec references:** SPEC §4.1, §4.4, §5, §8, §11.3, §13, §15

## Why this slice exists

SPEC §5 states the product's central claim in one line:

> The same project is viewable as **either a list or a board**, toggled, over
> identical data. A column in board view is a section header in list view. This
> is the core idea of the product, and it's the thing neither reference app
> does.

Everything needed to honour it is already built and none of it is used twice.
Sections exist. Fractional positions exist. `dropTaskAt` moves a task to a
section and a slot in one transaction. `groupBySection` and `resolveDrop` were
written pure and reason about group membership rather than geometry, precisely
so a second layout could reuse them without a second data path.

This slice is also what the touch-drag spike was paying for. SPEC §13 ordered
that spike before the board "because dragging a card across a narrow phone
screen may simply not be good enough — and if it isn't, board view becomes
tablet-and-desktop-only and a chunk of P0b disappears." The spike passed on the
phone, so the chunk stays.

## What ships

| | |
|---|---|
| **Board layout** | Sections become columns, tasks become cards, at every width |
| **Toggle** | A header control on project routes, per project, remembered |
| **Drag** | Cards move within and between columns, onto the same `dropTaskAt` |
| **Done** | The last column; dropping a card into it completes the task |
| **Phone** | Columns are ~85vw with scroll-snap — one fills the screen, you swipe |
| **Schema** | `projects.default_view`, the workspace-wide initial value (§4.1) |

## The decisions this design rests on

### 1. The board exists on the phone, but a project opens as a list there

SPEC §8 rule 6 says to "default to list view at phone widths. The tablet is
wide enough for board view; the phone mostly isn't." SPEC §16 open question 5
asks *how much* the board matters on the phone and says the touch-drag spike
answers it "empirically rather than by argument".

Hiding the toggle below `lg` would answer it by argument. So the toggle is
present at every width and the default is width-aware: a project you have never
toggled opens as a list on a phone and honours `default_view` above `lg`. Once
you choose, your choice is what is remembered — the width rule only ever
supplies a first answer, never overrides one.

### 2. Done is the last column

In list view Done is a collapsed header, because a project used for a month is
mostly history. A column costs no vertical space, and it scrolls off the right
on a phone until you go looking for it — which is the same practical effect as
being collapsed.

Keeping it earns the gesture SPEC §4 calls the product's whole thesis: the
binding is two-way, and *dragging a card into Done to complete it* reads far
more naturally as a column than as a drop onto a collapsed strip.

### 3. A card is a `TaskRow`

One row component, two layouts around it. The two views cannot then disagree
about what a task shows, which is the same reason `orderSections` is shared
between the list and the sheet's Section picker. A board-specific card is a
second component to keep in step with the first, for a visual difference the
column border already supplies.

### 4. Capture stays in one place

No per-column add field. SPEC §3 puts capture ahead of organization, and a
capture field that first asks which column you meant inverts that. A new task
lands in the project's first open section, as it does today, and the board's
whole job is that moving it is one drag.

### 5. One component, two layouts

`TaskList.tsx` takes a `view` prop rather than a `Board.tsx` existing beside it.
SPEC §5 is explicit that "list ⇄ board is a rendering choice, not a data
choice", and a single component makes that structurally true rather than merely
intended: there is one `onDrop`, one `describe`, one place the toast rule lives.

The cost is a file that grows to roughly 200 lines carrying both layouts. The
alternative — a `useProjectTasks` hook with two thin layout files — is the right
move the moment the board grows something the list does not have (column
collapse, per-column limits). It does not have one today, so YAGNI wins.

### 6. `default_view` lands on the row now, even though nothing writes it

SPEC §4.1 is careful here, and the care is easy to misread:

> **`default_view` is a per-device preference and is deliberately NOT synced.**
> It lives in local storage, not in Postgres, despite appearing on `projects`
> above as the workspace-wide *initial* value.

Both halves are true and they describe different things. The **toggle** — what
*this* device is showing *this* project right now — is local storage, and
syncing it would mean switching to board on the tablet silently switches the
phone. The **column** is the workspace-wide starting point a new device inherits
before it has an opinion of its own.

SPEC §15's standing constraint is that "every row is created with its full sync
column set (§4.1)" so that P1 implements a transport rather than a migration.
The column is one field, defaulted to `'list'`, read by `resolveView` and
written by nothing in this slice. Leaving it out is a known gap to close later,
under sync, which is the worst time to close it.

## Architecture

### `view.ts` — the preference, framework-free

The third module of this shape, after `undo.ts` and `nav.ts`: a module
singleton over `localStorage`, read through `useSyncExternalStore`. One key,
`lane.view`, holding a JSON map of project id to mode.

```ts
export type ViewMode = 'list' | 'board'

export function getViews(): Record<string, ViewMode>   // stable identity
export function subscribe(listener: () => void): () => void
export function setView(projectId: string, mode: ViewMode): void

/**
 * Stored choice wins. Absent one, width decides: a phone opens a list
 * whatever the project's initial value says.
 */
export function resolveView(
  stored: ViewMode | undefined,
  wide: boolean,
  initial: ViewMode,
): ViewMode
```

A map under one key rather than a key per project, so that reading is one parse
and a corrupt or absent value has exactly one place to be handled. Unparseable
JSON resolves to `{}` rather than throwing: a display preference is never worth
a blank screen.

### `useView.ts` — the React seam

Mirrors `nav.ts` / `useRoute.ts`, and exists for the same reason: `view.ts`
stays free of React so its tests keep running without a DOM (SPEC §11.3 rule 2
bans jsdom from this project).

```ts
export function useView(project: Project | undefined): {
  view: ViewMode
  setView: (mode: ViewMode) => void
}
```

`wide` comes from `matchMedia('(min-width: 1024px)')` — Tailwind's `lg`, the
same breakpoint at which the drawer stops being an overlay — subscribed through
`useSyncExternalStore` so that rotating a tablet re-resolves a project that has
no stored choice.

### `TaskList.tsx` — one component, two layouts

The data half is untouched: same `useLiveQuery` reads, same `groupBySection`,
same `resolveDrop`, same `dropTaskAt`. The view prop changes four things.

| | list | board |
|---|---|---|
| Wrapper | `mx-auto max-w-2xl` | `flex gap-3 overflow-x-auto snap-x snap-mandatory` |
| Section | full width, stacked | `w-[85vw] shrink-0 snap-start lg:w-72`, min height |
| Done | collapsed, toggleable | an ordinary column |
| `+ Section` | a field below the list | a trailing column |

The min height on a column is not cosmetic: `DragGroup` is already a droppable,
so an empty column accepts a drop, but an empty one with no height is not
something a thumb can hit.

### The toast rule follows Done being visible

`Toast.tsx`'s rule is unchanged and unchallenged — an undo toast means *the row
left the screen*. What changes is that in board view it never did:

```ts
const showsDone = view === 'board' || doneOpen
const vanished = target.sectionId === done?.id && !showsDone
```

Dropping a card into a Done column completes the task in front of you. Offering
to undo something you can still see is the noise slice 5 removed from Today.

### `DraggableList.tsx` — one conditional modifier

The only view-specific thing in the drag seam is `restrictToVerticalAxis`,
which becomes a `vertical` prop on `DragArea`. `verticalListSortingStrategy`
stays: cards still sort vertically *within* a column, and cross-column moves go
through `DragGroup`'s droppable exactly as cross-section moves do today.

`closestCenter` collision detection is kept unless browser verification shows it
misaims between columns, in which case `closestCorners` is the documented
board-shaped alternative. That is a one-line change and a comment, not a design
fork.

### `projects.default_view` and database version 3

`Project` gains `default_view: 'list' | 'board'`, non-optional. Three writers
have to agree: `addProject` in `repo/projects.ts`, `seedWorkspace` in `db.ts`
(whose project literal is untyped, so the compiler will not catch it), and a
Dexie version 3 upgrade that backfills `'list'` onto every existing row.

The field is not indexed, so version 3 declares no `stores` — only an upgrade
handler. `createDb`'s `ceiling` parameter widens to `1 | 2 | 3` so the migration
test can still open a genuine older database without importing Dexie.

**The backfill writes no outbox entries**, and this is a deliberate departure
from version 2's upgrade. Version 2 enqueued tasks because those rows had never
been enqueued at all — SPEC §9.1's "never drop an entry". Here the value written
is identical to the column's default on the server, so there is nothing for a
server to learn, and enqueuing would push a column to say what it already says.

## Data flow

Nothing new. A drop in either view produces a `DropTarget` from `resolveDrop`
and calls `dropTaskAt(id, sectionId, beforeId)`, which writes the task row and
its outbox entry in one transaction (SPEC §9.1) and returns an undo step. The
board is a second reader of state the list already reads.

Toggling the view writes `localStorage` and notifies subscribers. It touches
neither IndexedDB nor the outbox, which is the whole point of §4.1's carve-out.

## Error handling

The toggle cannot fail in a way worth reporting: `localStorage` writes are
wrapped, and a failure leaves the view switched for this session and
unremembered for the next. Reporting "your view preference was not saved"
through `reportProblem` would be noise of exactly the kind slice 5 removed —
that channel is for writes that lost your data.

Drag failures are unchanged: `dropTaskAt` rejects, `reportProblem` says so, and
the live query re-renders the row where it actually is.

## Testing

Unit, in the existing Vitest node environment — no jsdom, per SPEC §11.3 rule 2.

- `view.test.ts` — `resolveView` as a table: stored wins over both width and
  initial; absent stored resolves `wide ? initial : 'list'`; a narrow screen
  gets a list even when `default_view` is `'board'`. Store round-trips per
  project, one project's choice does not disturb another's, unparseable JSON
  resolves to no stored choice rather than throwing, and `getViews` keeps a
  stable identity between writes so `useSyncExternalStore` cannot loop.
- `repo/projects.test.ts` — `addProject` writes `default_view: 'list'`.
- `migration.test.ts` — a version 2 database with a project row opens at
  version 3 with `default_view: 'list'` backfilled, and its outbox is unchanged
  in length.

Behaviour that only exists in a browser is verified in a browser, as in slices 4
and 5: toggling, column layout at three widths, a card dragged between columns,
a card dragged into Done completing it with no toast, and the preference
surviving a reload.

## What the phone has to answer

Dragging a card into a column that is scrolled off-screen requires horizontal
autoscroll mid-drag. This is the same class of unknown the original spike
existed to answer and it may be poor on Android.

The fallback is already built and is required by SPEC §8 rule 6 — "always offer
a non-drag *Move to…* fallback" — as the sheet's Section select. If autoscroll
disappoints, the board remains a good viewing and within-column reordering
surface on the phone, and that gets reported as the empirical answer to open
question 5 rather than smoothed over.

## Out of scope

- **Collapsing open sections in list view.** SPEC §5 calls list sections
  "collapsible headers"; today only Done collapses. It is a real gap, unrelated
  to the board, and belongs with its own state and its own persistence.
- **Reordering columns by dragging their headers.** Sections have positions and
  it would work, but the drag seam moves tasks today and column drag is a
  second drag type on the same surface.
- **Column WIP limits, swimlanes, multiple boards.** SPEC §5.4 lists all three
  as non-goals.
- **Drag to reschedule in Upcoming.** Deferred out of slice 5 and still deferred.
