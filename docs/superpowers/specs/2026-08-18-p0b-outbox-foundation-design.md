# P0b slice 1 — the outbox foundation

**Status:** approved, not yet implemented
**Date:** 2026-08-18
**Spec references:** SPEC §4.1, §9.1, §9.2, §11.3, §12.3, §13

## Why this slice exists

P0a shipped a working local app whose write path is a deliberate stub. SPEC §13
attaches a constraint to P0b:

> even with nothing to sync to, every write in P0b goes through a repository
> layer that writes the row and appends an outbox entry in one transaction
> (§9.1), and every row is created with its full sync column set (§4.1). P1 then
> implements a *transport* against an outbox that already exists. Skip this and
> P1 rewrites every write path in the app — which is the single most common way
> local-first projects stall.

This slice satisfies that constraint and nothing else. It changes no pixels. The
four call sites in `repo.ts` already carry `// P0b: appendOutboxEntry(...)`
comments marking where the work lands.

P0b's remaining slices — task CRUD with undo, projects and sections UI,
Inbox/Today/Upcoming, search, and the board with touch drag — all write through
what this slice builds. The board and drag slice is additionally gated on a
Cloudflare deploy, because touch drag on a narrow screen can only be judged on a
real phone.

## Scope

**In:**

1. `projects` and `sections` tables, with the full §4.1 sync column set.
2. An `outbox` table: atomic with the row write, ordered, coalesced by dirty
   column set, idempotent, and carrying a per-entry verdict field.
3. A Dexie v1→v2 migration that materializes the Inbox project and its sections
   and backfills outbox entries for rows created during P0a.
4. `repo.ts` restructured around two internal helpers so that writing a row
   without its outbox entry is not expressible.

**Out, and where it goes instead:**

| Deferred | Why | Lands in |
|---|---|---|
| The done-section move on completion (§4) | Unchecking needs a section to restore to, and no section UI exists yet | Slice 3, with the sections UI |
| "N pending" indicator (§9.1) | With no transport the number only ever rises; it reads as broken | P1 |
| Retry, backoff, the state machine over `status` | There is nothing to retry against | P1 |
| Reconciliation function and its harness (§9.9) | Belongs with the transport it reconciles for | P1 |
| Any UI change | This slice is invisible by design | Slices 2+ |

## Schema

Dexie version 2. Both new tables carry `updated_at`, `deleted_at` and
`client_id` alongside the columns SPEC §4.1 lists:

```
projects   id · workspace_id · name · color · icon · position · archived_at
           + updated_at · deleted_at · client_id
sections   id · workspace_id · project_id · name · position · is_done_section
           + updated_at · deleted_at · client_id
outbox     ++seq · table · row_id · columns[] · status · reason · created_at
```

Indexes:

```
projects  'id, [workspace_id+position], [workspace_id+updated_at], deleted_at'
sections  'id, [workspace_id+project_id], [workspace_id+updated_at], deleted_at'
outbox    '++seq, [table+row_id], status'
```

`[workspace_id+updated_at]` mirrors P0a's choice on `tasks`: it is what P1's push
scans for dirty rows (§12.2).

### Two schema decisions worth stating

**`projects.default_view` is not in Dexie.** SPEC §4.1 is explicit that it is a
per-device preference that must not sync — switching the tablet to board view
should not switch the phone. It lives in localStorage, read at render time.

**The outbox has no `op` column.** Creates, updates and deletes are all upserts
by row id on the server (§9.1, idempotency), and a soft delete is simply
`deleted_at` appearing in the dirty column set. Adding `op` would introduce a
second source of truth about what a push means.

### The outbox entry

```ts
interface OutboxEntry {
  seq: number                        // Dexie auto-increment; the push order
  table: 'tasks' | 'projects' | 'sections'
  row_id: string
  columns: string[]                  // the dirty set, not a delta log
  status: 'pending' | 'parked'
  reason: string | null              // set with status 'parked'
  created_at: string
}
```

`status` and `reason` exist now and are never written to anything but `pending`
by this slice. SPEC §9.1 warns that retrofitting rejectability "means auditing
every write path in the app"; the field costs nothing today, and the state
machine that reads it is P1's.

## Coalescing and ordering

Appending an entry for `(table, row_id)`:

1. Look for an existing entry on `[table+row_id]` with `status = 'pending'`.
2. If found, union the new column names into `columns` and **leave `seq`
   unchanged**.
3. If not found, insert a new entry with the next `seq`.

Keeping the original `seq` is what preserves referential order (§9.2): a project
created before the task inside it keeps its lower sequence number no matter how
many times the task is subsequently edited, so the push cannot send a task ahead
of its parent.

Parked entries are never coalesced into. A new edit to a row whose entry was
rejected creates a fresh `pending` entry, leaving the parked one and its reason
intact for the user to see.

## Migration, v1 → v2

`workspace.ts` pins the workspace, project and section to fixed UUIDs precisely
so that rows created before a server exists line up with what P1 creates. The
migration exploits that:

1. Insert a `projects` row named "Inbox" at the existing `LOCAL_PROJECT_ID`.
2. Insert a `sections` row at the existing `LOCAL_SECTION_ID`, and a done section
   at a new fixed `LOCAL_DONE_SECTION_ID` constant with `is_done_section = true`.
3. **Backfill the outbox for every pre-existing task** with its full column set.
4. Enqueue the three new rows too.

No task row is rewritten — every task already points at the right project and
section ids.

Step 3 is the one that is easy to omit and expensive to discover. Tasks typed
during P0a were written before an outbox existed. Without a backfill, P1's first
push would send the Inbox project and none of the tasks in it, and the omission
would be invisible until a second device showed an empty list.

Every device generates the same fixed ids for these rows. That is harmless:
push upserts by row id, so the second device's Inbox collapses onto the first.

## The write seam

Everything in `repo.ts` goes through two internal helpers, and nothing outside
`repo.ts` touches `db` (SPEC §11.3 rule 1):

```ts
async function create<T extends SyncColumns>(table: TableName, row: T): Promise<void>
async function write(table: TableName, id: string, changes: Partial<Task & SyncColumns>): Promise<void>
```

- `create` inserts the row and appends an entry carrying its full column set.
- `write` stamps `updated_at` and `client_id`, applies `changes`, and appends an
  entry carrying exactly the changed column names.
- Both open one Dexie transaction spanning the data table and `outbox`. §9.1:
  "A row written without its outbox entry is a silently lost change — this
  atomicity is the single most important detail in the sync engine."

The public functions collapse to one line each, and no component changes:

```ts
export const renameTask = (id: string, title: string) =>
  write('tasks', id, { title: title.trim() })
```

P1's pull deliberately bypasses both helpers — rows arriving from the server must
not be re-enqueued. That is a separate function, added when the transport is.

## Testing

Test-driven, with the invariants as the test list:

**Outbox**
- appending twice for one row produces one entry with the union of both column sets
- a coalesced append keeps the original `seq`
- `seq` is monotonically increasing across different rows
- an entry with `status: 'parked'` is not coalesced into; a new `pending` entry appears
- a write that throws leaves neither the row change nor the outbox entry (atomicity)

**Migration**
- upgrading a v1 database containing tasks yields the Inbox project, both sections, and one outbox entry per pre-existing task
- pre-existing tasks' `project_id` and `section_id` are unchanged
- upgrading an empty v1 database yields the project and sections with no task entries

**Repository**
- each public function appends exactly the columns it changed
- `deleteTask` appends `deleted_at` rather than removing the row

### One new dependency

`fake-indexeddb`, as a devDependency, so Dexie transactions run under vitest in
Node. Test-only and never shipped. Flagged explicitly against SPEC §11.3 rather
than slipped in: it is the first addition since P0a, it is pinned exactly like
everything else, and it is imported in the vitest setup file alone.

## Done when

`npm test` covers every invariant above, `npm run lint` and `npm run build` are
clean, the app behaves exactly as it did before, and a database created under
P0a upgrades in place with its tasks intact and enqueued.
