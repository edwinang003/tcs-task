# P0b slice 7 — checklist items

**Date:** 2026-08-20
**Status:** approved
**SPEC:** §4 (the five nouns), §4.1 (`checklist_items`), §4.4 (what happens
when a parent goes away), §9.1 (row plus outbox entry), §9.2 (push in
referential order), §13 (P0b), §15 (full sync column set from day one)

## Why this slice exists

§13 lists checklist items in P0b, and §6 puts them in the must-have set beside
notes. But the reason to build them now, ahead of labels and search, is the
part that has nothing to do with checklists: **`checklist_items` is the first
new table since the outbox existed.**

Every table in the database today was created before or alongside `outbox.ts`.
Adding one now exercises the thing SPEC §15 says P0b exists to prove — that a
new row type can arrive with its full sync column set, its outbox wiring and
its place in §9.2's push order, without anything else in the app changing. If
that turns out to be awkward, it is much cheaper to find out here, on a table
with four columns and no relationships, than in P1 under a transport.

Labels would have taught the same lesson and a harder one at once: `task_labels`
is a many-to-many with a composite identity, and §9.2 puts it last in the push
order for a reason. Checklist items are the same lesson with one parent and one
foreign key.

## What ships

- A `checklist_items` table, at database version 4, carrying the sync columns.
- A checklist inside the task sheet: add, tick, rename, delete, each undoable.
- A `2/5` progress counter on the task row, in the list, the board and both
  agenda views.
- Deleting a task tombstones its checklist items in the same transaction.

## The decisions this design rests on

### 1. The row row shows `2/5`

A checklist you cannot see from the outside is a checklist you forget you
wrote. §2 takes "a card can open into detail — notes, checklist, labels —
without demanding it" from Trello, and the counter is the half of that sentence
that does the work: it is how the card *offers* the detail without opening.

The cost is honest and worth naming. The badge needs counts for every visible
task, which is a second live query over the whole `checklist_items` table,
joined to tasks in memory. That is the same shape `grouping.ts` already uses to
put tasks into sections, and the table is small by construction — items have no
detail view, so nobody accumulates thousands of them.

The rejected variant was showing the badge only when a checklist is *partly*
done, to keep untouched and finished rows quiet. It makes "no badge" mean two
opposite things — no checklist at all, and a checklist you have finished — and
those are the two states a person most wants told apart.

### 2. No drag-reordering this slice

Items get real fractional positions (§4.2) and append in order, so the data
supports reordering whenever the UI wants to. The UI does not want to yet.

The sheet is a bottom sheet, and on a phone the sheet *is* the scroller. A
vertical drag inside it competes with the scroll it lives in — which is the
exact fight that forced the task list to grow a dedicated grip with
`touch-action: none`. Paying that cost again, inside a panel, for a list that
is usually four items long, is not obviously worth it. It is easy to add later
and impossible to remove once someone relies on it.

### 3. Deleting a task tombstones its items

§4.4 decides the cascades one level up: deleting a project tombstones its
sections, tasks and checklist items. It does not spell out the task → items
case, because a task delete was not one of the awkward ones. The same reasoning
applies unchanged: an item whose task is gone is unreachable, and leaving it
live means P1 pushes `checklist_items` rows for a row the server has been told
to forget.

The alternative — leave them and filter by parent on read — is less code and
worse in one specific way: the outbox has no idea the parent is gone, so the
rows sit there as pending pushes forever.

### 4. Ticking every item does nothing to the task

§4 is explicit that "checklist items are not tasks", and the temptation here is
to be clever: all five ticked, so complete the task. It is delightful exactly
once. Thereafter you tick the last sub-step to record that you did it, and the
task leaves the screen before you meant it to — the silent state change §5.1
warns about, wearing a friendly hat.

There is a middle option — offer it in a toast — which was rejected because
`Toast` is currently the undo surface and nothing else. Giving it a second
meaning means every toast now has to be read before it is dismissed.

### 5. `done` is a boolean, not a timestamp

§4.1 spells the column `done`, while `tasks` carries `completed_at`. The
asymmetry is deliberate and worth keeping rather than "fixing" for consistency:
a task's completion time is data — P2's completed log reads it, and §4's done
section binding preserves it across a move — whereas an item has no history
because it has no detail view to show one in.

## Architecture

### `schema.ts` — the row, and the push order

```ts
/** SPEC §4.1 — `checklist_items`. */
export interface ChecklistItem extends SyncColumns {
  task_id: string
  title: string
  /**
   * SPEC §4.1 spells this `done`, where `tasks` carries `completed_at`. An
   * item has no completed log and no detail view, so there is nothing for a
   * timestamp to be read by.
   */
  done: boolean
  /** Fractional index, a string (SPEC §4.2). */
  position: string
}
```

`PUSHABLE_TABLES` gains `'checklist_items'`, and the array is reordered into
§9.2's push order: `projects → sections → tasks → checklist_items`. The order
is functionally inert — it is a whitelist, and the real push order comes from
the outbox's `seq` — but §9.2's dependency chain has to be written down
somewhere that cannot drift away from the schema, and the whitelist is the one
list of tables the app already keeps.

### Database version 4

```ts
if (ceiling >= 4) {
  db.version(4).stores({
    checklist_items:
      'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
  })
}
```

No `.upgrade()`: a table that has never existed has no rows to backfill. That
is the exact mirror of version 3, which was an `.upgrade()` with no `stores()`
because `default_view` was not indexed. Between them the two versions
demonstrate both halves of a Dexie migration, which is worth a comment in the
file.

`[workspace_id+task_id]` serves both access paths on its own. One task's items
is an equality read; every item in the workspace — which is what the row badges
need — is a range between `[workspace_id, MIN_KEY]` and `[workspace_id,
MAX_KEY]`, exactly the trick `listAllTasks` uses over `[workspace_id+position]`.
There is no index on `position` because ordering only ever matters within one
task's handful of items, and an in-memory sort of four strings does not need
one.

`ceiling` widens to `1 | 2 | 3 | 4`, defaulting to 4.

### `repo/checklist.ts` — the writes

```ts
listChecklistItems(taskId: string): Promise<ChecklistItem[]>
listAllChecklistItems(): Promise<ChecklistItem[]>
addChecklistItem(taskId: string, title: string): Promise<{ id: string; undo: UndoStep }>
setChecklistItemDone(id: string, done: boolean): Promise<UndoStep | null>
renameChecklistItem(id: string, title: string): Promise<UndoStep | null>
deleteChecklistItem(id: string): Promise<UndoStep | null>
```

Nothing new architecturally, which is the finding this slice is looking for:
`create`, `write` and `batch` already do the atomic row-plus-outbox work, and
every mutation returns the `UndoStep` that reverses it for the caller to push.
`addChecklistItem` mirrors `addTask` — the position is derived *inside* the
transaction that writes it, because the add field keeps focus and the next item
can be submitted before this one has landed.

Both list functions filter tombstones in the reader, never in the query, for
the reason `listAllTasks` states: deletions are soft and the rows that sync are
not the rows that render.

### `positions.ts` — a sibling, not a parameter

```ts
export async function appendItemPositionIn(taskId: string): Promise<string>
```

Six lines beside `appendPositionIn`, rather than making the existing function
polymorphic over table-and-parent. The generic version saves four lines and
costs both call sites their readability: `appendPositionIn(section.id)` says
what it does, and `appendPositionIn('tasks', 'section_id', section.id)` does
not. The two rules the file's header already states apply unchanged — call it
inside the transaction that writes the key, and count tombstones.

### The cascade in `deleteTask`

```ts
export async function deleteTask(id: string): Promise<UndoStep | null> {
  return batch(['tasks', 'checklist_items'], async () => {
    const items = await liveItemsOf(id)
    const stamp = now()
    const steps = [
      await write('tasks', id, { deleted_at: stamp }, 'Task deleted', true),
      ...(await Promise.all(
        items.map((item) =>
          write('checklist_items', item.id, { deleted_at: stamp }, 'Task deleted'),
        ),
      )),
    ]
    return composite('Task deleted', steps, true)
  })
}
```

One transaction forward, so a task cannot be tombstoned without its items.
`composite` reverses newest-first, so an undo restores the items and then the
task; the order is immaterial here — clearing `deleted_at` is order-free — but
it is the order `deleteSection` established and there is no reason to differ.

`write()` refuses a row that is already a tombstone unless the change touches
`deleted_at` itself, which this one does, so a task deleted twice is a no-op
rather than a duplicated push.

### `progress.ts` — the counting, pure

```ts
export interface Progress {
  done: number
  total: number
}

export function progressByTask(items: ChecklistItem[]): Map<string, Progress>
```

A `Map`, and a task with no items is simply absent from it — which is what lets
`TaskRow` render nothing without a `total > 0` check spread across two callers.
Pure and DOM-free, so it is tested the way `agenda.ts` and `grouping.ts` are.

Named `progress.ts` rather than `lib/checklist.ts` on purpose: `repo/checklist.ts`
already exists in this design, and two files named checklist that do opposite
things is a coin-flip every time someone opens one.

### `useProgress.ts` — the React seam

```ts
export function useProgress(): Map<string, Progress>
```

`useLiveQuery(() => listAllChecklistItems(), [])` fed through `progressByTask`,
memoized on the query result. The same split as `view.ts`/`useView.ts` and
`nav.ts`/`useRoute.ts`, for the same reason: the logic worth testing is on the
other side of the seam, where no DOM is needed to reach it.

`TaskList` and `AgendaList` each call it once and pass
`progress={progress.get(task.id)}` down. Once per list, not once per row — a
hook per row would be one live query per visible task.

### `TaskRow` — one optional prop

`progress?: Progress`, rendered beside `badge`, and only when `total > 0`. It
joins `badge`, `handle` and `hidesOnComplete` as an extra that is absent by
default, which is the rule that file's header sets out: a list that does not
pass it does not get it, and nothing has to be switched off.

The board gets the counter for nothing, because a board card *is* a `TaskRow`
(slice 6, decision 3).

### `Checklist.tsx` — the editor

Its own file, rendered inside `TaskSheet` below Notes. Three parts: a header
carrying `Checklist` and the same `2/5`, the items, and an add field.

**The items come from `useLiveQuery`**, which is a deliberate departure from
the rule stated at the top of `TaskSheet.tsx` — "it deliberately does not use
`useLiveQuery`: a live value would fight the cursor mid-word". That rule exists
to protect *the draft*, not the row set, and here the two can be separated:

- The live query drives **which items exist and whether they are ticked**. It
  has to, because undo is an ordinary new mutation against the database — an
  item deleted and then restored has to reappear on a sheet that is still open,
  and a sheet holding a snapshot would show a stale list.
- A `drafts` map keyed by item id drives **the characters in the input**:
  `value={drafts[item.id] ?? item.title}`. On commit the draft is dropped, and
  the live value that replaces it is the string we just wrote — an identical
  value, which React does not treat as a change, so the cursor stays put.

Commit on blur and on the 500ms pause the sheet already uses, through the same
per-field timer discipline: one timer per item id, not one for the checklist,
for the reason `TaskSheet` learned the hard way — a single timer means
committing one field silently drops another field's pending edit.

**The add field** sits at the foot, submits on Enter, and keeps focus, which is
QuickAdd's idiom because a checklist is typed in bursts rather than one item at
a time. Empty input is refused silently, as `addTask` does.

Each item is a checkbox, a text input and a delete button, each with its own
44px target — this is a phone-first sheet and three controls on one line is
already the most that fits.

## Data flow

```
add an item     Checklist → addChecklistItem → create() → row + outbox entry
                                              → pushUndo
                useLiveQuery(listChecklistItems) → the item appears
                useLiveQuery(listAllChecklistItems) → the row badge increments

tick an item    Checklist → setChecklistItemDone → write() → row + outbox
                the badge moves 1/5 → 2/5 in every view showing that task

delete a task   TaskRow/TaskSheet → deleteTask → batch(tasks, checklist_items)
                → composite step, toast → undo restores the task and its items
```

The badge and the sheet read the same rows through two different queries, and
both are live, so they cannot disagree about a count.

## Error handling

Every write goes through `repo/`, so a failed transaction rolls back the row
and its outbox entry together (§9.1) and surfaces through the write-failure
path added in an earlier slice. Nothing here introduces a new failure mode.

Three specific cases:

- **An empty or whitespace-only item title** is refused before the write, like
  `addTask`. `renameChecklistItem` on an empty string returns `null` rather
  than storing `''`, matching `renameTask`.
- **A checklist item whose task was deleted on another device** is not a case
  P0b can produce, and §4.4's rule for tasks arriving with a missing parent
  does not extend to items — there is no "first remaining task" to land in. The
  reader filters by `task_id`, so an orphan item is invisible rather than
  crashing; P1's pull is where a real answer belongs.
- **A write landing after the sheet closes** is already handled: `write()`
  refuses a tombstone, so a debounced rename that fires after Delete is a
  no-op.

## Testing

Currently 196 passing across 19 files. New and changed:

- `progress.test.ts` — counts, an all-done task, tombstones excluded, a task
  with no items absent from the map.
- `repo/checklist.test.ts` — add writes a full sync column set (§15); the
  outbox entry names `checklist_items`; positions append in order; tick,
  rename and delete each return a step that reverses; an empty title is
  refused.
- `repo/tasks.test.ts` — deleting a task tombstones its items, and the undo
  brings back both.
- `migration.test.ts` — a v3 database opens at v4 with the table present, and
  the migration writes no outbox entries (it has no rows to enqueue).
- `db.test.ts` — `verno` is 4, with five tables.

No test needs a DOM. `Checklist.tsx` is verified in the browser, as every
component in this project is — §11.3 rule 2 rejects jsdom and
`@testing-library/react`.

## Out of scope

- **Drag-reordering items** — decision 2.
- **Auto-completing the parent task** — decision 4.
- **Per-item due dates, labels or notes** — §4 forbids these outright: "they
  have no due date, no labels, no detail view. This is what stops the app
  growing into a project-management tool."
- **Nesting** — §4, "one level of nesting. No subtask trees."
- **The project-delete cascade** in §4.4 — `deleteProject` does not exist yet;
  only `archiveProject` does, and archiving deletes nothing.
- **Converting an item into a task** — a P2-shaped idea, and one that needs a
  position and a section to land in.
