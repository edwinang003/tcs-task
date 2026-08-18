# P0b slice 2 — task CRUD and undo

**Status:** approved, not yet implemented
**Date:** 2026-08-18
**Spec references:** SPEC §3, §4.1, §4.5, §6, §8, §9.1, §9.4, §11.3, §13

## Why this slice exists

Slice 1 built the write seam and changed no pixels. This slice is the first one
the user can see: it turns a task from a title and a checkbox into a row with
notes, a due date and a priority, and it gives every mutation a way back.

SPEC §6 lists under must-have (P0–P1):

> Create / edit / complete / delete tasks; undo for destructive actions
> Due dates and times; overdue state
> Notes (plain text or lightweight markdown) and checklist items

Checklist items are a separate noun and get their own slice. Everything else on
those three lines lands here.

Due dates are also a dependency, not just a feature. Slice 4 builds Today and
Upcoming, and until something in the app can set `due_on`, those views have
nothing to show. Building them in the other order would mean shipping two empty
screens and then filling them.

## Scope

**In:**

1. An undo subsystem: a single in-memory step, session-scoped, reapplied as an
   ordinary new mutation (§4.5).
2. `repo.ts` mutations return an `UndoStep`, with the previous values captured
   inside the transaction that changes them.
3. A bottom-sheet task editor: title, notes, `due_on`, `due_time`, priority.
4. Auto-save on every field. No Save button.
5. A due chip on the list row, with an overdue state.
6. An undo toast on delete, and Ctrl/Cmd+Z for everything else.

**Out, and where it goes instead:**

| Deferred | Why | Lands in |
|---|---|---|
| `reminder_at` computation | Needs `workspaces.timezone` and a reminder pipeline (§10) | P1 |
| The done-section move on completion (§4) | Still no section UI to restore a task to | Slice 3 |
| A toast on completion | Nothing leaves the screen until the done-section move exists | Slice 3 |
| Labels, checklist items | Their own nouns, their own slices | Later P0b |
| Natural-language parsing in the due field | §5.1: "the trustworthy version is the only one worth shipping" | P2 |
| Component tests | See *Testing* below — three dependencies for logic that is already pure | Revisit if the UI grows branches |

## Undo

### The mechanism

SPEC §4.5 is the whole specification:

> It is **local, session-scoped, and single-level per action**: the previous
> value of the changed columns is held in memory and reapplied as an ordinary
> new mutation. It is not a sync operation and it never rewinds the outbox — an
> undo that shipped after its own edit already pushed would race the server.

Three consequences, each of which the implementation has to earn:

- **Held in memory.** The undo store is a module singleton, not a table. It dies
  with the tab, by design.
- **Reapplied as an ordinary new mutation.** `apply()` goes back through
  `write()`, so the restore gets its own outbox entry, its own `updated_at`, its
  own `client_id`. Nothing special-cases it.
- **Never rewinds the outbox.** The entry the original edit enqueued stays
  exactly where it was. This is a test, not a comment.

### Where the previous value is captured

Inside the transaction that changes it:

```ts
async function write(
  table: TableName,
  id: string,
  changes: Record<string, unknown>,
  label: string,
): Promise<UndoStep | null> {
  const stamped = { ...changes, updated_at: now(), client_id: clientId() }
  let previous: Record<string, unknown> | null = null
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const row = await db.table(table).get(id)
    if (row === undefined) return
    previous = pick(row, Object.keys(changes))
    await db.table(table).update(id, stamped)
    await appendOutbox(table, id, Object.keys(stamped))
  })
  if (previous === null) return null
  return { label, apply: () => write(table, id, previous!, label) }
}
```

The alternative — components holding the old row and calling repo again to
restore it — was rejected on two counts. The capture would sit outside the
transaction, so a second write landing between the read and the restore would be
silently reverted. And a list row that only rendered a title has no old row to
hold; only the repo layer always has one.

**It captures the columns in `changes`, not the columns in `stamped`.** Restoring
a previous `updated_at` would push a server-owned column backwards (§4.1), and
the restore is a new write that deserves its own stamp anyway.

### Who pushes the step

The repo returns it; the component pushes it. The repo layer is the sync seam
and holds no session state; the undo store is session state and belongs with the
UI. There are five call sites, all inside three components.

The cost is real and worth naming: a future call site can forget to push, and
nothing will complain. The mitigation is that `UndoStep` is in the return type
of every mutation, so the omission is visible at the call site rather than
buried.

### Single-level, and why undo does not stack

`undoLast()` runs the step, discards the `UndoStep` its own write returns, and
clears the store. Without that discard, undo would push a redo, the redo would
push an undo, and Ctrl+Z would toggle forever between two states instead of
doing nothing the second time. §4.5 says single-level; this is what single-level
costs.

### What each mutation's undo is

| Mutation | Undo |
|---|---|
| `addTask` | A soft delete — a tombstone rather than a row removal, so the deletion is a normal syncable fact like any other (§9) |
| `renameTask` | The previous title |
| `setTaskDone` | The previous `completed_at` |
| `deleteTask` | Clearing `deleted_at` — "which is why soft deletes make this cheap" (§4.5) |
| `setTaskNotes`, `setTaskDue`, `setTaskPriority` | The previous value of those columns |

## The sheet

`TaskSheet.tsx`, mounted from `App` with an `openTaskId` in state. No router:
SPEC §11.3 rejects React Router, and one overlay does not need one.

Draft state is local to the sheet and keyed by task id, so opening a different
task remounts it clean rather than merging two tasks' drafts. It deliberately
does not use `useLiveQuery` — a live field would fight the cursor while typing,
and there is no second writer in P0b.

**Auto-save, no Save button.** Title and notes commit on blur and on a 500ms
debounce; due and priority commit on pick; "Done" only closes the sheet. This
follows §3 principle 1 — the UI never waits — and it is affordable because the
outbox coalesces per row and dirty column set (§9.1), so a debounced notes field
produces one entry, not thirty.

Due date uses native `<input type="date">` and `<input type="time">`. Android
Chrome renders real pickers, which is the platform that matters for capture (§8
consequence 4), and it costs no dependency at all (§11.3 rule 2). `due_on` is
`YYYY-MM-DD` and `due_time` is `HH:MM`, which map exactly onto the Postgres
`date` and `time` columns §4.1 specifies.

Priority is four radio-style buttons, 0–3, where 0 is a real zero and not a
sentinel (§4.1).

## The list row

The row gains a due chip, red when overdue. Without it a due date can be set and
then never seen again until slice 4 ships Today and Upcoming, which is worse
than having no due dates: it looks like the field did nothing.

`src/lib/dates.ts` holds the formatting and the overdue predicate as pure
functions, so the boundary cases — due today is not overdue, due today at a time
already past is — are unit tests rather than something to squint at in a
browser.

## The toast

Hand-rolled, roughly forty lines, six-second timer, `aria-live="polite"`, an
Undo button sized for a thumb. §11.3 rule 2: prefer forty lines you own to a
package.

**A toast appears when the result is not visible on screen.** A delete makes the
row vanish, so it gets one. A title edit, a due date, a priority and a
completion all stay in view and are reversible with the same control that made
them, so they do not. A toast on every checkbox tick would train the eye to
ignore toasts, which is exactly when the delete one needs to be read.

Ctrl/Cmd+Z covers the rest: one window-level `keydown` listener that ignores
events whose target is an `input`, `textarea` or `contenteditable`, so native
text undo still works inside the notes field.

Slice 3 revisits this. Once checking a task moves it into the done section, a
completion does leave the screen, and it earns a toast then.

## Testing

Unit tests, on the modules that hold the logic:

- `undo.test.ts` — push, undo, clear; single-level (undoing twice is a no-op);
  subscribers are notified.
- `repo.test.ts` additions — each mutation returns a step that restores exactly
  the previous columns; the restore enqueues its own outbox entry; **the
  original entry survives the undo**, which is the §4.5 guarantee stated as an
  assertion.
- `dates.test.ts` — overdue boundaries and formatting.

**No component test harness in this slice.** Adding one means jsdom plus
`@testing-library/react` plus its peer, against a test environment that is
currently `node` with a hand-written `localStorage` (§11.3 rule 2 is why it is
hand-written). That is three dependencies for a slice whose logic lives in pure
modules that are already covered. The sheet, the toast and the keyboard path get
verified in a real browser with Playwright, the same way the v1→v2 migration was
verified rather than trusted to a fake IndexedDB.

This is a decision to revisit, not a principle. When a component grows real
branching — the section-move logic in slice 3 is the likely trigger — the
harness earns its keep.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/undo.ts` | new — the single-step store and its `useSyncExternalStore` subscription |
| `src/lib/dates.ts` | new — due-date formatting and the overdue predicate, pure |
| `src/lib/repo.ts` | modified — `write()` captures previous values; mutations return `UndoStep`; three new field setters |
| `src/components/TaskSheet.tsx` | new — the bottom sheet editor |
| `src/components/Toast.tsx` | new — the undo toast |
| `src/components/TaskList.tsx` | modified — tap to open, due chip |
| `src/App.tsx` | modified — sheet state, keyboard listener, toast mount |
