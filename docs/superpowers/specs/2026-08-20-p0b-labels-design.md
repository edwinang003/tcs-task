# P0b slice 8 — labels

**Date:** 2026-08-20
**Status:** approved
**SPEC:** §4 (the five nouns), §4.1 (`labels`, `task_labels`), §4.4 (what
happens when a parent goes away), §6 (labels with colours; filter by label),
§9.1 (row plus outbox entry), §9.2 (push in referential order), §13 (P0b), §15
(full sync column set from day one)

## Why this slice exists

§13 lists labels in P0b and §6 puts "labels with colours; filter by label" in
the must-have set. §4 gives the reason they are a noun at all: a task is in
exactly one project and one section, so **labels handle everything
cross-cutting**. Without them the model has no answer for "waiting on Bob's
reply" — §4's table of awkward cases says so outright, and calls it "what
labels are for".

The slice 7 design named what this one costs, while explaining why checklist
items went first:

> Labels would have taught the same lesson and a harder one at once:
> `task_labels` is a many-to-many with a composite identity, and §9.2 puts it
> last in the push order for a reason.

That harder lesson is now the point. `task_labels` is the app's first
many-to-many, and a join row is the one row shape where two devices editing
offline can independently invent the *same fact*. Getting its identity right is
this slice's real work; the UI around it is ordinary.

## What ships

Split into two plans against one design. **8a is independently useful and
shippable; 8b is useless without it.**

**8a — tagging**

- `labels` and `task_labels` tables, at database version 5, with sync columns.
- `repo/labels.ts`: create, rename, recolour, delete, tag, untag — each
  returning the `UndoStep` that reverses it.
- `labelling.ts`, pure: the palette, colour assignment, and the task → labels
  map.
- A `Labels` row in the task sheet: a picker that creates on the fly.
- Coloured dots on the task row, in the list, the board and both agenda views.
- Deleting a task tombstones its `task_labels` in the same transaction.

**8b — browsing**

- Labels listed in the drawer, below the two views, each with its colour.
- Rename, recolour and delete a label from the drawer.
- A `label` route: every task carrying it, across projects, rendered like
  Today.
- Deleting a label tombstones its `task_labels`; the tasks are untouched.

## The decisions this design rests on

### 1. A `task_labels` row has a deterministic id

§4.1 lists the table as `workspace_id · task_id · label_id` with no `id`
column. It needs one anyway: the outbox keys every entry by `row_id`, and §9.2
upserts by row id on the server. The question is where that id comes from.

**It is computed, not generated: `` `${task_id}.${label_id}` ``.**

The case that decides it is two devices offline. Both tag "Call the plumber"
with `waiting-on`; both come back online. With a generated UUIDv7 the workspace
now holds two live join rows asserting one fact, every read has to dedupe, and
P1 needs a cleanup path for a duplicate that is not wrong, merely redundant.
With a computed id both devices produce the *same row id*, the push upserts one
onto the other, and the duplicate never exists.

This is not a new rule in this codebase. It is the one `db.ts` already follows
for the seeded workspace:

> Every device generates the same ids here, which is harmless — push upserts by
> row id, so the second device collapses onto the first.

A join row is the only other place in the schema where the same reasoning
applies, because it is the only row whose identity is fully determined by what
it points at. Every other table has a `title` or a `name` — user-authored
content that two devices genuinely can differ on, and where collapsing rows
would lose an edit.

The rejected third option was a composite primary key `[task_id+label_id]` and
no `id` at all, which is closest to §4.1's literal column list. It breaks the
outbox's `row_id: string` contract, so it would force a change to `outbox.ts` —
the one layer this slice should be able to leave completely alone. That the
outbox needs no change is the evidence that the layer was built right.

### 2. Untagging tombstones; re-tagging resurrects

Decision 1 has a direct consequence worth stating rather than discovering.
Because the id is a function of the pair, untag and re-tag address the same
row: untagging sets `deleted_at`, and tagging again clears it on that same id
instead of inserting a new one.

So `tagTask` is an upsert, not an insert, and its three cases are all real:
no row yet, a live row (a no-op), and a tombstone to revive. The last is the
one a test has to cover explicitly, because it is also the path taken after
`deleteLabel` tombstones a whole label's join rows and someone re-applies the
label to a task that used to carry it.

### 3. `color` stores a palette key, not a hex

The column is `color` and the obvious value is `#e11d48`. It stores `'rose'`
instead.

Two reasons, and the second is the binding one. A hex is a single colour, but
every colour in this app is a *pair* — the dot that reads on a white background
is not the one that reads on `#111`, which is why the palette resolves to a
Tailwind class per theme rather than to a value. And Tailwind's compiler only
emits classes it can see in the source, so a class name assembled at runtime
from stored data is purged from the build and silently renders unstyled. A
fixed key mapped through a literal lookup keeps every class spelled out where
the compiler can find it.

The cost is that the palette becomes a migration surface: renaming a key means
touching stored rows. That is why the keys are colour names rather than
positions — `'rose'` survives a palette reordering that `'3'` would not.

An unknown key — a row from a future build, or a hand-edited database — falls
back to a neutral grey rather than throwing. A label that renders plainly is a
much better failure than a list that will not render.

### 4. Colour is assigned, not chosen

Creating a label takes the next colour automatically. There is no swatch picker
on the create path.

The slice's fast path is typing `errand` into the sheet's picker and carrying
on; a colour decision in the middle of that is a decision nobody wants to make
about a label they are inventing in passing. §5's whole quick-add design is
this argument applied to tasks, and it applies here for the same reason.

Assignment is the least-used colour in the palette, ties broken by palette
order — deterministic, so it is a pure function `labelling.ts` can test, and it
spreads colours instead of repeating one until the palette wraps. Recolouring
is available afterwards from the drawer, which is where someone who cares about
a label's colour will be anyway.

### 5. The row shows dots, not chips

A task row at 390px already carries a checkbox, a title, `Today`, a `1/3`
checklist counter and — in the agenda views — its project name. Named chips are
what most task apps show, and they are what would wrap that row onto a second
line.

So the row gets one small coloured dot per label and no text. The dot answers
the question a scan actually asks — *is this tagged, and roughly how* — while
the name lives in the sheet and in the drawer, one tap away in both directions.

This leans on decision 3: dots are only legible because the palette is small,
fixed and theme-aware. It also caps at three dots with no overflow marker,
because a fourth dot on a phone row is noise rather than information, and
someone with four labels on one task is served by opening it.

### 6. Labels are a route, not a filter

"Filter by label" could narrow the current project in place. It opens a
cross-project view instead, listed in the drawer beside Today and Upcoming.

§4 calls labels "cross-project tags", and the question they exist to answer —
"what am I waiting on?" — is never scoped to one project. An in-project filter
answers a question nobody asked, and would need its own affordance in both the
list and the board.

The route is a third arm on `nav.ts`'s existing union, and the view is
`AgendaList`'s shape: tasks from anywhere, each row naming the project it came
from. Both already exist.

### 7. One index, and therefore one read path

`task_labels` carries one access-path index, `[workspace_id+task_id]`, beside
the sync pair every table has — exactly mirroring `checklist_items` at version
4.

The label route wants "every task carrying label X", which reads like it wants
`[workspace_id+label_id]`. It does not, because the dots need *every* join row
in the workspace already: that live query is running for the list on screen
whether or not the route is open. Adding a second index would add a second read
path to keep consistent, to serve a filter over data the app is holding in
memory regardless.

The table is small by construction — one row per task-label pair, and labels
are only useful while there are few enough to remember. If that ever
stops being true, the index is one line and the read path behind it is already
isolated in `labelling.ts`.

### 8. Deleting a label leaves the tasks alone

§4.4 decides this one outright: "Delete a label → `task_labels` rows tombstone;
tasks are untouched." Deleting a task tombstoning its `task_labels` is the
unstated half, and it follows the same reasoning slice 7 used for checklist
items: a join row whose task is gone is unreachable, and leaving it live means
P1 pushes rows for a row the server has been told to forget.

Both cascades are one transaction with the parent delete, and both are covered
by the parent's single `UndoStep` — one undo restores a task with its labels,
exactly as it now restores a task with its checklist.

## Architecture

### `schema.ts` — two rows, and the push order

```ts
/** SPEC §4.1 — `labels`. */
export interface Label extends SyncColumns {
  name: string
  /** A palette key from `labelling.ts`, not a hex — see the design, §3. */
  color: string
}

/** SPEC §4.1 — `task_labels`. The id is derived; see the design, §1. */
export interface TaskLabel extends SyncColumns {
  task_id: string
  label_id: string
}
```

`PUSHABLE_TABLES` gains `'labels'` and `'task_labels'`, in that order, at the
end. §9.2's chain — `workspaces → projects → sections → tasks →
checklist_items → labels → task_labels` — is then complete, and the list stops
being a prefix of the spec's for the first time.

### Database version 5

Two `stores` calls and no `upgrade`, the same shape as version 4: tables that
have never existed have no rows to backfill.

```ts
db.version(5).stores({
  labels: 'id, [workspace_id+name], [workspace_id+updated_at], deleted_at',
  task_labels:
    'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
})
```

`[workspace_id+name]` on `labels` is the drawer's read order and the picker's
lookup for "does this name already exist" — the check that keeps
create-on-the-fly from producing two labels called `errand`.

`createDb`'s `ceiling` parameter widens to `1 | 2 | 3 | 4 | 5`, so the
migration test can still open a genuine version 4 database and step it forward.

### `repo/labels.ts` — the writes

Six mutations, each returning its `UndoStep`, each going through `write.ts`'s
existing primitives:

| Mutation | Reversed by |
| --- | --- |
| `createLabel(name)` | tombstone the label |
| `renameLabel(id, name)` | restore the previous name |
| `setLabelColor(id, key)` | restore the previous key |
| `deleteLabel(id)` | clear `deleted_at` on the label and its join rows |
| `tagTask(taskId, labelId)` | `untagTask` |
| `untagTask(taskId, labelId)` | `tagTask` |

`tagTask` is the upsert from decision 2. `deleteLabel` is a `batch` across
`labels` and `task_labels`, the same shape `deleteTask`'s cascade already has.

Both cascades tombstone **only the join rows that were live when they ran**, and
build their `UndoStep` from exactly those. This matters because untag is itself
a tombstone: a task someone untagged last week must not come back tagged because
the label was deleted today. `deleteTask` already gets this right by reading
`listChecklistItems` — live rows only — before writing, and the label cascades
read the same way. 8a also widens `deleteTask`'s `batch` list from
`['tasks', 'checklist_items']` to include `'task_labels'`; a table absent from
that list cannot be written in the transaction.

`createLabel` refuses an empty name and returns null, matching
`renameChecklistItem` — the sheet's picker drops its draft on commit, so the
refusal is visible rather than silent.

### `labelling.ts` — pure

```ts
export const PALETTE = ['rose', 'amber', 'lime', 'teal',
                        'sky', 'indigo', 'violet', 'slate'] as const

export function nextColor(existing: Label[]): string
export function labelsByTask(links: TaskLabel[], labels: Label[]):
  Map<string, Label[]>
export function tasksWithLabel(links: TaskLabel[], labelId: string):
  Set<string>
export function dotClasses(color: string): string
```

`labelsByTask` sorts each task's labels by palette order so the dots on a row
do not reshuffle when an unrelated label is renamed. `dotClasses` is the
literal lookup decision 3 requires, with the grey fallback.

### `useLabels.ts` — the React seam

Two live queries — every label, every join row — memoized into what the callers
need. Called once per list, never per row, for the reason `useProgress` says:
a hook inside `TaskRow` would be one live query per visible task.

### `nav.ts` — a third arm

```ts
export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'label'; labelId: string }
```

The stored form needs care. Today a bare uuid means a project, so a label uuid
would parse as one. Labels store as `` `label:${id}` ``, a form no existing
value can collide with, and `parseStored` gains one branch ahead of its uuid
fallback. A route pointing at a deleted label resolves to Inbox through the
same reasoning `resolveProject` already uses.

`captureTarget` gains a case: a task typed while a label route is open lands in
Inbox, undated — and **is not tagged**. Auto-tagging is defensible and is
deliberately not done here. `nav.ts` already refuses to guess a date for a task
typed into Upcoming, on the grounds that silently attaching metadata someone did
not ask for is worse than attaching none; a label is the same bet, and the sheet
is one tap away.

### Components

- `LabelDots.tsx` — the row's dots. Presentational, takes `Label[]`.
- `LabelPicker.tsx` — the sheet's row: current labels, a filter field, and
  `Create "errand"` when nothing matches. Uses `useLiveQuery` for the same
  reason `Checklist` does — undo has to be able to put a label back on a sheet
  that is still open — with a draft string protecting the field's cursor.
- `TaskRow.tsx` — one optional `labels` prop, exactly as it took `progress`.
- `Drawer.tsx` — a labels list below the views, reusing the rename affordance
  projects and sections already have.

## Data flow

Tagging a task, end to end:

1. `LabelPicker` calls `tagTask(taskId, labelId)`.
2. `repo/labels.ts` computes `` `${taskId}.${labelId}` ``, and in one
   transaction upserts the join row and appends its outbox entry.
3. Dexie fires; `useLabels`' live query re-reads every join row.
4. `labelsByTask` rebuilds the map; the sheet shows the new label and the row
   behind it grows a dot.
5. The `UndoStep` goes to `pushUndo`, and the toast offers it above the sheet —
   the `z-40` slice 7 already paid for.

## Error handling

The picker's create path clears its field optimistically, so a failed write
hands the words back and reports through `reportProblem`, matching `Checklist`
and `QuickAdd`.

A join row referencing a label deleted on another device is dropped on read
rather than rendered as a blank dot — `labelsByTask` builds from the label
list, so an unresolvable `label_id` simply contributes nothing. This is §4.4's
"sync must never silently discard a row because its parent moved" read the only
way it can be for a join row: the row survives as a tombstone candidate for
P1, but it draws nothing.

## Testing

Unit-tested without a DOM, per §11.3 rule 2 — no jsdom, no
`@testing-library/react`:

- `labelling.ts` — `nextColor` spreading and its tie-break, `labelsByTask`
  ordering and the missing-label case, `dotClasses`' fallback.
- `repo/labels.ts` — each mutation's row and outbox entry in one transaction,
  each `UndoStep`, the three `tagTask` cases including tombstone revival, and
  both cascades.
- `db.ts` — version 5's stores, and a version 4 database stepped forward.
- `nav.ts` — `label:` parsing, the uuid fallback it must not break, and
  `captureTarget`'s new case.

The components are verified in a real browser at 390×844 and 1280×900, with
zero console errors and zero warnings — the standing bar.

## Out of scope

- **Filtering a project by label in place.** Decision 6.
- **Multi-label filtering** (`waiting-on` AND `errand`). One label per route;
  the intersection is §5's search bar, with its `@name` token.
- **Reordering labels.** They sort by palette order, which is stable and
  needs no `position` column. Adding one later is a migration, not a redesign.
- **`@name` in quick add.** §5's parser is search's slice, not this one.
- **A label's own colour beyond the palette.** Decision 3.
