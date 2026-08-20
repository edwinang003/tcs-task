# P0b slice 7 — checklist items: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add checklist items to tasks — a new `checklist_items` table with its
sync columns and outbox wiring, an editor in the task sheet, and a `2/5`
counter on every task row.

**Architecture:** `checklist_items` is the first table added since the outbox
existed, so the slice is mostly a test of the layers already built: `create` /
`write` / `batch` handle the atomic row-plus-outbox write unchanged, and the
only genuinely new code is a pure counter (`progress.ts`), its React seam
(`useProgress.ts`), and one component (`Checklist.tsx`). Reading splits the
same way every other feature in this app does: a framework-free module holds
the logic, a `use*` file holds the `useLiveQuery`.

**Tech Stack:** React 19.2.8 · Vite 8.2.1 · TypeScript 6.0.3 · Tailwind 4.3.3 ·
Dexie 4.4.5 · dexie-react-hooks 4.4.0 · Vitest 4.1.10 (`environment: 'node'`) ·
fake-indexeddb 6.2.5 · oxlint 1.78.0

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-checklist-items-design.md`

## Global Constraints

- **SPEC §11.3 rule 1** — every dependency that could churn is imported in
  exactly one file. Dexie only in `lib/db.ts`; dnd-kit only in
  `components/DraggableList.tsx`. This slice adds no dependency.
- **SPEC §11.3 rule 2** — no jsdom, no `@testing-library/react`. Components are
  verified in a real browser; only DOM-free modules get unit tests. "Prefer ~40
  lines you own to a package."
- **SPEC §11.3 rule 3** — dependencies are pinned exactly, no ranges.
- **SPEC §9.1** — every local mutation writes the row **and** appends an outbox
  entry **in the same IndexedDB transaction**. Nothing outside `lib/repo/`
  writes to the database, and nothing inside it except `write.ts` opens a
  transaction.
- **SPEC §4.1** — server-owned columns (`updated_at`, `reminder_sent_at`) are
  never pushed. Dates are `YYYY-MM-DD` strings, never timestamps.
- **SPEC §4.2** — ordering is a fractional index, a string. Position keys are
  always derived *inside* the transaction that writes them.
- **SPEC §4.5** — undo is single-step, local, and reapplied as an ordinary new
  mutation. Every `repo/` mutation returns the `UndoStep` that reverses it; the
  caller pushes it.
- **SPEC §15** — every row is created with its full sync column set, so P1
  implements a transport rather than a migration.
- **Touch targets are at least 44px** (`min-h-11`), because SPEC §8 makes
  Android the primary device.
- **Commits**: imperative subject, body explaining *why*, and
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never commit to `main`.** This work is on branch `p0b-7-checklist`.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/src/lib/schema.ts` *(modify)* | Add `ChecklistItem`; add `'checklist_items'` to `PUSHABLE_TABLES` in §9.2's push order |
| `app/src/lib/db.ts` *(modify)* | `LaneDb` gains the table; database version 4; `ceiling` widens to 4 |
| `app/src/lib/repo/positions.ts` *(modify)* | `appendItemPositionIn(taskId)` beside `appendPositionIn(sectionId)` |
| `app/src/lib/repo/checklist.ts` *(create)* | The six checklist mutations and reads — the only write path for items |
| `app/src/lib/repo/index.ts` *(modify)* | Re-export `./checklist` |
| `app/src/lib/repo/tasks.ts` *(modify)* | `deleteTask` cascades to the task's items in one transaction |
| `app/src/lib/progress.ts` *(create)* | Pure: `progressByTask(items) → Map<taskId, {done, total}>` |
| `app/src/lib/useProgress.ts` *(create)* | The React seam — one `useLiveQuery`, memoized |
| `app/src/components/TaskRow.tsx` *(modify)* | Optional `progress` prop, rendered as `2/5` |
| `app/src/components/TaskList.tsx` *(modify)* | Call `useProgress()` once, pass per row (serves list **and** board) |
| `app/src/components/AgendaList.tsx` *(modify)* | Same, for Today and Upcoming |
| `app/src/components/Checklist.tsx` *(create)* | The editor inside the sheet: items, inline rename, add field |
| `app/src/components/TaskSheet.tsx` *(modify)* | Render `<Checklist>` below Notes |
| `app/src/components/Toast.tsx` *(modify)* | `z-20` → `z-40`, so undo is visible over the sheet |
| `app/README.md` *(modify)* | Status line and the layout map |

**Test files:** `app/src/lib/db.test.ts` *(modify)*,
`app/src/lib/migration.test.ts` *(modify)*,
`app/src/lib/repo/checklist.test.ts` *(create)*,
`app/src/lib/repo/tasks.test.ts` *(modify)*,
`app/src/lib/progress.test.ts` *(create)*.

**Test count checkpoints:** starts at **196 passed (19 files)**. After Task 1:
**198**. After Task 2: **207 (20 files)**. After Task 3: **210**. After Task 4:
**215 (21 files)**. Task 5 adds none — it is a component, verified in the
browser per §11.3 rule 2.

All commands run from `app/`.

---

### Task 1: The table, the row shape, and database version 4

**Files:**
- Modify: `app/src/lib/schema.ts`
- Modify: `app/src/lib/db.ts`
- Test: `app/src/lib/db.test.ts`, `app/src/lib/migration.test.ts`

**Interfaces:**
- Consumes: `SyncColumns` (`id`, `workspace_id`, `updated_at`, `deleted_at`,
  `client_id`) from `schema.ts`; `createDb(name?: string, ceiling?: 1|2|3|4)`
  from `db.ts`.
- Produces:
  - `interface ChecklistItem extends SyncColumns { task_id: string; title: string; done: boolean; position: string }`
  - `TableName` now includes `'checklist_items'`
  - `db.checklist_items: EntityTable<ChecklistItem, 'id'>`
  - `createDb(name, ceiling: 1 | 2 | 3 | 4 = 4)`

- [ ] **Step 1: Write the failing schema test**

In `app/src/lib/db.test.ts`, replace the existing `it('is at version 3, with
the four tables', ...)` block entirely with:

```ts
  it('is at version 4, with the five tables', async () => {
    // Version 4 is a pure `stores` bump — a table that has never existed has
    // no rows to backfill. The exact mirror of version 3, which was an
    // `upgrade` with no `stores` because `default_view` is not indexed.
    const db = createDb('lane-schema-test')
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(4)
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'checklist_items',
      'outbox',
      'projects',
      'sections',
      'tasks',
    ])
  })
```

- [ ] **Step 2: Write the failing migration tests**

In `app/src/lib/migration.test.ts`, append at the end of the file:

```ts
/**
 * A database as the previous build left it: version 3, no `checklist_items`.
 * Returns the outbox length, so the v4 test can prove the migration enqueues
 * nothing.
 */
async function seedV3(name: string) {
  const v3 = createDb(name, 3)
  await v3.open()
  const outboxLength = await v3.outbox.count()
  v3.close()
  return outboxLength
}

describe('v3 → v4 migration', () => {
  it('adds checklist_items to a database that never had it', async () => {
    const name = 'lane-migration-checklist-table'
    await seedV3(name)
    const db = createDb(name)
    await db.open()

    expect(db.verno).toBe(4)
    expect(db.tables.map((t) => t.name)).toContain('checklist_items')
    expect(await db.checklist_items.count()).toBe(0)
    db.close()
  })

  it('adds the table without enqueuing anything to push', async () => {
    // Unlike v2, which backfilled outbox entries for P0a tasks that had never
    // been enqueued at all (SPEC §9.1: never drop an entry). A brand-new table
    // has no rows, so there is nothing for a server to be told.
    const name = 'lane-migration-checklist-outbox'
    const before = await seedV3(name)
    const db = createDb(name)
    await db.open()

    expect(await db.outbox.count()).toBe(before)
    db.close()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/db.test.ts src/lib/migration.test.ts`
Expected: FAIL — `expected 3 to be 4`, and `Property 'checklist_items' does not
exist on type 'LaneDb'`.

- [ ] **Step 4: Add the row shape to `schema.ts`**

In `app/src/lib/schema.ts`, insert after the `Section` interface and before the
`OutboxEntry` doc comment:

```ts
/** SPEC §4.1 — `checklist_items`. */
export interface ChecklistItem extends SyncColumns {
  task_id: string
  title: string
  /**
   * SPEC §4.1 spells this `done`, where `tasks` carries `completed_at`. The
   * asymmetry is deliberate: a task's completion time is data — P2's completed
   * log reads it, and §4's done-section binding preserves it across a move —
   * whereas an item has no detail view for a timestamp to be shown in.
   */
  done: boolean
  /** Fractional index, a string (SPEC §4.2). */
  position: string
}
```

- [ ] **Step 5: Add the table to the push whitelist**

In `app/src/lib/schema.ts`, replace the `PUSHABLE_TABLES` declaration (keeping
the doc comment above it) with:

```ts
/**
 * Tables the client may push. SPEC §9.11 item 3 — the push handler validates
 * against an explicit whitelist, so adding a server-owned table later is a
 * one-line change rather than a security review.
 *
 * Listed in SPEC §9.2's push order — `workspaces → projects → sections → tasks
 * → checklist_items → labels → task_labels` — minus the tables that do not
 * exist yet. The order is inert today: this is a whitelist, and the real push
 * order comes from the outbox's `seq`. But §9.2's dependency chain has to be
 * written down somewhere it cannot drift away from the schema, and this is the
 * one list of tables the app already keeps.
 */
export const PUSHABLE_TABLES = [
  'projects',
  'sections',
  'tasks',
  'checklist_items',
] as const
```

This reorder is provably inert: `PUSHABLE_TABLES` has exactly one consumer in
the codebase, the `TableName` union on the next line, and a union does not care
about order. Verify with `grep -rn "PUSHABLE_TABLES" src/` before committing —
it should print only the two lines in `schema.ts`.

- [ ] **Step 6: Add the table to `db.ts`**

Three edits in `app/src/lib/db.ts`:

a) The type import — replace

```ts
import type { Task, Project, Section, OutboxEntry } from './schema'
```

with

```ts
import type { Task, Project, Section, ChecklistItem, OutboxEntry } from './schema'
```

b) The `LaneDb` type — replace

```ts
export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}
```

with

```ts
export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  checklist_items: EntityTable<ChecklistItem, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}
```

c) The signature and the new version — replace

```ts
export function createDb(name: string = DB_NAME, ceiling: 1 | 2 | 3 = 3): LaneDb {
```

with

```ts
export function createDb(
  name: string = DB_NAME,
  ceiling: 1 | 2 | 3 | 4 = 4,
): LaneDb {
```

and insert, immediately after the closing brace of the `if (ceiling >= 3)`
block and before `return db`:

```ts
  if (ceiling >= 4) {
    // The mirror of version 3: that one was an `upgrade` with no `stores`,
    // because `default_view` is not indexed and only the data moved. This one
    // is a `stores` with no `upgrade`, because a table that has never existed
    // has no rows to backfill. Between them they are both halves of a Dexie
    // migration.
    //
    // `[workspace_id+task_id]` serves both access paths on its own: one task's
    // items is an equality read, and every item in the workspace — what the row
    // counters need — is a range across the whole second component, the same
    // trick `listAllTasks` uses over `[workspace_id+position]`.
    db.version(4).stores({
      checklist_items:
        'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
    })
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/db.test.ts src/lib/migration.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **198 passed (198)**, 19 files. Clean build, clean lint.

- [ ] **Step 9: Commit**

```bash
git add src/lib/schema.ts src/lib/db.ts src/lib/db.test.ts src/lib/migration.test.ts
git commit -m "feat: a checklist_items table, at database version 4

The first table added since the outbox existed, which is the reason to
build this slice before labels: SPEC §15 promises a new row type can
arrive with its sync columns and its place in §9.2's push order without
anything else changing, and this is the cheapest possible test of that.

Version 4 is a pure stores bump with no upgrade — a table that has never
existed has no rows to backfill — which is the exact mirror of version 3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `repo/checklist.ts` — the write path

**Files:**
- Modify: `app/src/lib/repo/positions.ts`
- Create: `app/src/lib/repo/checklist.ts`
- Modify: `app/src/lib/repo/index.ts`
- Test: `app/src/lib/repo/checklist.test.ts` *(create)*

**Interfaces:**
- Consumes: `ChecklistItem` and `TableName` from `../schema`; `create`, `write`,
  `batch`, `now` from `./write`; `uuidv7` from `../ids`; `clientId` from
  `../device`; `activeWorkspace` from `../workspace`; `db`, `MIN_KEY`, `MAX_KEY`
  from `../db`; `generateKeyBetween` from `../fractional-indexing`.
- Produces:
  - `appendItemPositionIn(taskId: string): Promise<string>` (from `./positions`)
  - `listAllChecklistItems(): Promise<ChecklistItem[]>`
  - `listChecklistItems(taskId: string): Promise<ChecklistItem[]>` — position order
  - `addChecklistItem(taskId: string, title: string): Promise<{ id: string; undo: UndoStep }>`
  - `setChecklistItemDone(id: string, done: boolean): Promise<UndoStep | null>`
  - `renameChecklistItem(id: string, title: string): Promise<UndoStep | null>`
  - `deleteChecklistItem(id: string): Promise<UndoStep | null>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/repo/checklist.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  addTask,
  addChecklistItem,
  listChecklistItems,
  listAllChecklistItems,
  setChecklistItemDone,
  renameChecklistItem,
  deleteChecklistItem,
} from './index'
import { activeWorkspace } from '../workspace'

const inbox = activeWorkspace().projectId

async function entriesFor(rowId: string) {
  return db.outbox
    .where('[table+row_id]')
    .equals(['checklist_items', rowId])
    .toArray()
}

describe('checklist items', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Opening seeds the Inbox project and its sections, each with an entry.
    await db.outbox.clear()
  })

  it('creates an item with its full sync column set', async () => {
    // SPEC §15: "every row is created with its full sync column set", so that
    // P1 implements a transport rather than a migration.
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    expect(await db.checklist_items.get(id)).toMatchObject({
      task_id: taskId,
      title: 'passport',
      done: false,
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })
  })

  it('enqueues the item under checklist_items, without server-owned columns', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')
    const [entry] = await entriesFor(id)

    expect(entry.table).toBe('checklist_items')
    expect(entry.columns).toContain('task_id')
    expect(entry.columns).toContain('position')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('appends items in the order they were typed', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    await addChecklistItem(taskId, 'passport')
    await addChecklistItem(taskId, 'tickets')
    await addChecklistItem(taskId, 'chargers')

    expect((await listChecklistItems(taskId)).map((i) => i.title)).toEqual([
      'passport',
      'tickets',
      'chargers',
    ])
  })

  it('lists only the items of the task asked about', async () => {
    const { id: trip } = await addTask('pack for the trip', inbox)
    const { id: other } = await addTask('write the report', inbox)
    await addChecklistItem(trip, 'passport')
    await addChecklistItem(other, 'outline')

    expect((await listChecklistItems(trip)).map((i) => i.title)).toEqual(['passport'])
    expect(await listAllChecklistItems()).toHaveLength(2)
  })

  it('refuses an item with no title', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    await expect(addChecklistItem(taskId, '   ')).rejects.toThrow()
    expect(await listChecklistItems(taskId)).toHaveLength(0)
  })

  it('ticks an item, and the step unticks it', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await setChecklistItemDone(id, true)
    expect((await db.checklist_items.get(id))?.done).toBe(true)

    await step?.apply()
    expect((await db.checklist_items.get(id))?.done).toBe(false)
  })

  it('renames an item, and the step puts the old title back', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await renameChecklistItem(id, 'passport + visa')
    expect((await db.checklist_items.get(id))?.title).toBe('passport + visa')

    await step?.apply()
    expect((await db.checklist_items.get(id))?.title).toBe('passport')
  })

  it('refuses to rename an item to nothing', async () => {
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    // Null, not a thrown error: the sheet commits on a pause and on blur, so
    // an empty field is a normal intermediate state rather than a failure.
    expect(await renameChecklistItem(id, '  ')).toBeNull()
    expect((await db.checklist_items.get(id))?.title).toBe('passport')
  })

  it('deletes softly, and the step brings the item back', async () => {
    // SPEC §9: deletions are soft, so a device offline for a week learns about
    // the deletion instead of resurrecting the row.
    const { id: taskId } = await addTask('pack for the trip', inbox)
    const { id } = await addChecklistItem(taskId, 'passport')

    const step = await deleteChecklistItem(id)
    expect(await db.checklist_items.get(id)).toBeDefined()
    expect(await listChecklistItems(taskId)).toHaveLength(0)

    await step?.apply()
    expect(await listChecklistItems(taskId)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/repo/checklist.test.ts`
Expected: FAIL — `addChecklistItem` is not exported from `./index`.

- [ ] **Step 3: Add the position helper**

In `app/src/lib/repo/positions.ts`, append at the end of the file:

```ts
/**
 * The key for an item appended to a task's checklist.
 *
 * A sibling of `appendPositionIn` rather than a parameter on it. The generic
 * version — a table name and a parent column — saves four lines and costs both
 * call sites their readability: `appendPositionIn(section.id)` says what it
 * does and `appendPositionIn('tasks', 'section_id', section.id)` does not.
 *
 * The same two rules apply: call it inside the transaction that writes the key
 * it returns, and count tombstones, because a delete is undoable for the
 * length of the toast.
 */
export async function appendItemPositionIn(taskId: string): Promise<string> {
  const items = await db.checklist_items.toArray()
  const positions = items
    .filter((item) => item.task_id === taskId)
    .map((item) => item.position)
    .sort()
  return generateKeyBetween(positions.at(-1) ?? null, null)
}
```

- [ ] **Step 4: Write `repo/checklist.ts`**

Create `app/src/lib/repo/checklist.ts`:

```ts
/**
 * Checklist items — sub-steps on a task, and nothing more.
 *
 * SPEC §4: "Checklist items are not tasks. They have no due date, no labels,
 * no detail view. This is what stops the app growing into a project-management
 * tool." So this file is deliberately smaller than `tasks.ts` and stays that
 * way: an item is a title, a boolean and a position.
 *
 * `done` is a boolean where a task carries `completed_at`, which is SPEC §4.1's
 * asymmetry, not an oversight — see the comment on the type.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { create, write, batch, now } from './write'
import { appendItemPositionIn } from './positions'
import type { ChecklistItem } from '../schema'
import type { UndoStep } from '../undo'

/**
 * Every live item in the workspace.
 *
 * One index read serves this and `listChecklistItems` both, exactly as
 * `listAllTasks` does for tasks: the row counters span every task on screen,
 * so a second index keyed by task would be a second thing to keep correct for
 * no measured gain.
 */
export async function listAllChecklistItems(): Promise<ChecklistItem[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.checklist_items
    .where('[workspace_id+task_id]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((item) => item.deleted_at === null)
}

/** One task's items, in the order they will be drawn. */
export async function listChecklistItems(taskId: string): Promise<ChecklistItem[]> {
  const rows = await listAllChecklistItems()
  return rows
    .filter((item) => item.task_id === taskId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))
}

export async function addChecklistItem(
  taskId: string,
  title: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a checklist item with no title')

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()

  // The position is derived inside the transaction that writes it, like
  // `addTask`: the add field keeps focus, so the next item can be submitted
  // before this one has landed, and read outside both would see the same key.
  const undo = await batch(['checklist_items'], async () => {
    const row: ChecklistItem = {
      id,
      workspace_id: workspaceId,
      task_id: taskId,
      title: trimmed,
      done: false,
      position: await appendItemPositionIn(taskId),
      updated_at: now(),
      deleted_at: null,
      client_id: clientId(),
    }
    return create('checklist_items', row, 'Item added')
  })

  return { id, undo }
}

/**
 * Ticking an item does nothing to the task it belongs to, even when it is the
 * last one. SPEC §4: checklist items are not tasks. Completing the parent on
 * your behalf is delightful once and wrong thereafter — you tick the last
 * sub-step to record that you did it and the task leaves the screen.
 */
export function setChecklistItemDone(
  id: string,
  done: boolean,
): Promise<UndoStep | null> {
  return write('checklist_items', id, { done }, done ? 'Item ticked' : 'Item unticked')
}

export function renameChecklistItem(
  id: string,
  title: string,
): Promise<UndoStep | null> {
  const trimmed = title.trim()
  // Null rather than a throw: the editor commits on a pause as well as on
  // blur, so an empty field is a normal intermediate state, not a failure.
  if (!trimmed) return Promise.resolve(null)
  return write('checklist_items', id, { title: trimmed }, 'Item renamed')
}

/**
 * SPEC §9: deletions are soft. The toast is on, because the item leaves a
 * sheet that stays open — and on a phone there is no Ctrl+Z to reach for.
 */
export function deleteChecklistItem(id: string): Promise<UndoStep | null> {
  return write('checklist_items', id, { deleted_at: now() }, 'Item deleted', true)
}
```

- [ ] **Step 5: Re-export from the repo barrel**

In `app/src/lib/repo/index.ts`, add after `export * from './sections'`:

```ts
export * from './checklist'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/repo/checklist.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **207 passed (207)**, 20 files. Clean build, clean lint.

- [ ] **Step 8: Commit**

```bash
git add src/lib/repo/checklist.ts src/lib/repo/checklist.test.ts src/lib/repo/positions.ts src/lib/repo/index.ts
git commit -m "feat: the checklist item write path

Six functions and no new machinery, which is the finding this slice was
looking for: create/write/batch already do the atomic row-plus-outbox
work SPEC §9.1 demands, and a new table drops into them unchanged.

appendItemPositionIn is a sibling of appendPositionIn rather than a
parameter on it — a table-and-parent version saves four lines and costs
both call sites their readability.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Deleting a task takes its items with it

**Files:**
- Modify: `app/src/lib/repo/tasks.ts`
- Test: `app/src/lib/repo/tasks.test.ts`

**Interfaces:**
- Consumes: `listChecklistItems` from `./checklist` (Task 2); `composite`,
  `batch`, `write`, `now` from `./write`.
- Produces: `deleteTask(id: string): Promise<UndoStep | null>` — unchanged
  signature, cascading behaviour.

There is no import cycle: `checklist.ts` imports `write.ts` and `positions.ts`,
neither of which imports `tasks.ts`.

- [ ] **Step 1: Write the failing tests**

In `app/src/lib/repo/tasks.test.ts`, add `addChecklistItem` and
`listChecklistItems` to the existing import from `'./index'`, then append these
three tests inside the existing `describe('repo', ...)` block:

```ts
  it('tombstones a task\'s checklist items along with the task', async () => {
    // SPEC §4.4 decides this one level up — deleting a project tombstones its
    // sections, tasks and checklist items — and the reasoning carries down: an
    // item whose task is gone is unreachable, and leaving it live means P1
    // pushes rows for a task the server has been told to forget.
    const { id } = await addTask('pack for the trip', inbox)
    await addChecklistItem(id, 'passport')
    await addChecklistItem(id, 'tickets')

    await deleteTask(id)

    expect(await listChecklistItems(id)).toHaveLength(0)
    expect(await db.checklist_items.count()).toBe(2)
  })

  it('brings the task and its items back as one undo', async () => {
    const { id } = await addTask('pack for the trip', inbox)
    await addChecklistItem(id, 'passport')

    const step = await deleteTask(id)
    await step?.apply()

    expect(await listTasks(inbox)).toHaveLength(1)
    expect(await listChecklistItems(id)).toHaveLength(1)
  })

  it('leaves another task\'s items alone', async () => {
    const { id: trip } = await addTask('pack for the trip', inbox)
    const { id: report } = await addTask('write the report', inbox)
    await addChecklistItem(trip, 'passport')
    await addChecklistItem(report, 'outline')

    await deleteTask(trip)

    expect(await listChecklistItems(report)).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/repo/tasks.test.ts`
Expected: FAIL — `expected 1 to be 0` on the first test; the items survive.

- [ ] **Step 3: Implement the cascade**

In `app/src/lib/repo/tasks.ts`:

a) Extend the import from `./write` to include `composite`:

```ts
import { create, write, batch, composite, now } from './write'
```

b) Add an import of the checklist reader, after the `./positions` import:

```ts
import { listChecklistItems } from './checklist'
```

c) Replace the whole `deleteTask` function — doc comment and body — with:

```ts
/**
 * SPEC §9: deletions are soft. The row stays as a tombstone so that a device
 * offline for a week learns about the deletion instead of resurrecting it.
 *
 * The task's checklist items go with it, in the same transaction. SPEC §4.4
 * decides this one level up — deleting a project tombstones its sections,
 * tasks and checklist items — and the reasoning is unchanged here: an item
 * whose task is gone is unreachable, and leaving it live means P1 pushes
 * `checklist_items` rows for a row the server has been told to forget.
 *
 * The only mutation that takes its result off the screen, and so the only one
 * that raises a toast rather than relying on the keyboard.
 */
export async function deleteTask(id: string): Promise<UndoStep | null> {
  return batch(['tasks', 'checklist_items'], async () => {
    const items = await listChecklistItems(id)
    const stamp = now()

    const steps: (UndoStep | null)[] = [
      await write('tasks', id, { deleted_at: stamp }, 'Task deleted'),
    ]
    for (const item of items) {
      steps.push(
        await write('checklist_items', item.id, { deleted_at: stamp }, 'Task deleted'),
      )
    }

    // One `deleted_at` for the whole gesture, so the tombstones agree about
    // when the task went away. `composite` reverses newest-first, which is
    // immaterial here — clearing `deleted_at` is order-free — but it is the
    // order `deleteSection` established and there is no reason to differ.
    return composite('Task deleted', steps, true)
  })
}
```

Note the toast moved from the inner `write` to the `composite`: a composite
step carries its own label and toast flag, and two toasts for one gesture would
be one too many.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/repo/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **210 passed (210)**, 20 files. Clean build, clean lint.

If the existing test `expect((await entriesFor(id))[0].columns).toEqual(['deleted_at', 'client_id'])`
fails, read it before changing it: it asserts on the *task's* outbox entry,
which this change does not alter. A failure there means the cascade wrote to
the wrong table.

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo/tasks.ts src/lib/repo/tasks.test.ts
git commit -m "feat: deleting a task takes its checklist items with it

SPEC §4.4 decides the cascade one level up — a deleted project tombstones
its sections, tasks and checklist items — and the reasoning carries down
unchanged. An item whose task is gone is unreachable, and leaving it live
means P1 pushes rows for something the server has been told to forget.

One transaction forward, one composite undo step back, so the task and
its items return together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `2/5` counter on the row

**Files:**
- Create: `app/src/lib/progress.ts`
- Create: `app/src/lib/useProgress.ts`
- Modify: `app/src/components/TaskRow.tsx`
- Modify: `app/src/components/TaskList.tsx`
- Modify: `app/src/components/AgendaList.tsx`
- Test: `app/src/lib/progress.test.ts` *(create)*

**Interfaces:**
- Consumes: `ChecklistItem` from `./schema`; `listAllChecklistItems` from
  `./repo` (Task 2).
- Produces:
  - `interface Progress { done: number; total: number }`
  - `progressByTask(items: ChecklistItem[]): Map<string, Progress>`
  - `useProgress(): Map<string, Progress>`
  - `TaskRow` prop `progress?: Progress`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { progressByTask } from './progress'
import type { ChecklistItem } from './schema'

function item(
  taskId: string,
  done: boolean,
  overrides: Partial<ChecklistItem> = {},
): ChecklistItem {
  return {
    id: `${taskId}-${Math.random()}`,
    workspace_id: 'w',
    task_id: taskId,
    title: 'an item',
    done,
    position: 'a0',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'device',
    ...overrides,
  }
}

describe('progressByTask', () => {
  it('counts the done items and the total, per task', () => {
    const counts = progressByTask([
      item('trip', true),
      item('trip', false),
      item('trip', false),
    ])
    expect(counts.get('trip')).toEqual({ done: 1, total: 3 })
  })

  it('keeps two tasks apart', () => {
    const counts = progressByTask([item('trip', true), item('report', false)])
    expect(counts.get('trip')).toEqual({ done: 1, total: 1 })
    expect(counts.get('report')).toEqual({ done: 0, total: 1 })
  })

  it('leaves a task with no items out of the map', () => {
    // Absence is what lets TaskRow render nothing without every caller
    // checking — an undefined prop is already "no checklist".
    const counts = progressByTask([item('trip', false)])
    expect(counts.get('report')).toBeUndefined()
    expect(counts.size).toBe(1)
  })

  it('does not count tombstones', () => {
    // SPEC §9: deletions are soft, so a tombstone is a row in the table. The
    // reader filters them, and so does this — it is handed rows and must be
    // honest about them on its own.
    const counts = progressByTask([
      item('trip', true),
      item('trip', true, { deleted_at: '2026-08-20T10:00:00.000Z' }),
    ])
    expect(counts.get('trip')).toEqual({ done: 1, total: 1 })
  })

  it('reads 3/3 when everything is ticked', () => {
    const counts = progressByTask([
      item('trip', true),
      item('trip', true),
      item('trip', true),
    ])
    expect(counts.get('trip')).toEqual({ done: 3, total: 3 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/progress.test.ts`
Expected: FAIL — cannot resolve `./progress`.

- [ ] **Step 3: Write `progress.ts`**

Create `app/src/lib/progress.ts`:

```ts
/**
 * How far through a checklist a task is.
 *
 * Pure and DOM-free, like `agenda.ts` and `grouping.ts`, so the counting is
 * tested by calling it. `useProgress.ts` is the seam that feeds it rows.
 *
 * Named `progress.ts` rather than `checklist.ts` on purpose: `repo/checklist.ts`
 * is the write path, and two files named checklist doing opposite things is a
 * coin-flip every time someone opens one.
 */
import type { ChecklistItem } from './schema'

export interface Progress {
  done: number
  total: number
}

/**
 * A task with no items is absent from the map rather than present as 0/0 —
 * which is what lets `TaskRow` render nothing from an undefined prop, with no
 * `total > 0` check spread across its callers.
 */
export function progressByTask(items: ChecklistItem[]): Map<string, Progress> {
  const counts = new Map<string, Progress>()
  for (const item of items) {
    // SPEC §9: deletions are soft, so a tombstone is still a row. The reader
    // filters them out too; this function is handed rows and is honest about
    // them on its own, so a caller that reaches past the reader cannot get a
    // count that includes deleted items.
    if (item.deleted_at !== null) continue
    const count = counts.get(item.task_id) ?? { done: 0, total: 0 }
    counts.set(item.task_id, {
      done: count.done + (item.done ? 1 : 0),
      total: count.total + 1,
    })
  }
  return counts
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/progress.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the React seam**

Create `app/src/lib/useProgress.ts`:

```ts
/**
 * Checklist progress for every task on screen — the React seam.
 *
 * `progress.ts` does the counting and is tested without a DOM; this is the one
 * live query that feeds it. The same split as `nav.ts`/`useRoute.ts` and
 * `view.ts`/`useView.ts`, for the same reason.
 *
 * Called once per list, never per row: a hook inside `TaskRow` would be one
 * live query per visible task.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllChecklistItems } from './repo'
import { progressByTask, type Progress } from './progress'

export function useProgress(): Map<string, Progress> {
  const items = useLiveQuery(() => listAllChecklistItems(), [])
  // Memoized on the query result so the map keeps its identity between
  // renders that changed nothing about the checklists.
  return useMemo(() => progressByTask(items ?? []), [items])
}
```

- [ ] **Step 6: Give `TaskRow` the prop**

Three edits in `app/src/components/TaskRow.tsx`:

a) Add the type import, after `import type { Task } from '../lib/schema'`:

```ts
import type { Progress } from '../lib/progress'
```

b) Add the parameter and its type. Replace

```tsx
  handle,
  hidesOnComplete = false,
}: {
  task: Task
  onOpen: (id: string) => void
  /** The project's name, in views that span more than one project. */
  badge?: string
```

with

```tsx
  handle,
  hidesOnComplete = false,
  progress,
}: {
  task: Task
  onOpen: (id: string) => void
  /** The project's name, in views that span more than one project. */
  badge?: string
  /** How far through its checklist this task is, when it has one. */
  progress?: Progress
```

c) Render it. Insert immediately after the `{due !== null && (...)}` block and
before the `{badge !== undefined && (...)}` block:

```tsx
        {progress !== undefined && progress.total > 0 && (
          // SPEC §2 takes "a card can open into detail — notes, checklist,
          // labels — without demanding it" from Trello. This is the half of
          // that sentence that does the work: the offer, without the opening.
          <span className="ml-2 whitespace-nowrap text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {progress.done}/{progress.total}
          </span>
        )}
```

- [ ] **Step 7: Feed it from the project list**

Two edits in `app/src/components/TaskList.tsx`:

a) Add the import, after `import type { ViewMode } from '../lib/view'`:

```ts
import { useProgress } from '../lib/useProgress'
```

b) Call it beside the other hooks at the top of the component body — put it
directly after the existing `useLiveQuery` calls — and pass it down:

```tsx
  const progress = useProgress()
```

then in the `<TaskRow ... />` call, add one prop:

```tsx
                      <TaskRow
                        task={task}
                        onOpen={onOpen}
                        handle={handle}
                        hidesOnComplete={!showsDone}
                        progress={progress.get(task.id)}
                      />
```

The board needs no separate change: a board card *is* a `TaskRow` (slice 6),
so both layouts get the counter from this one call site.

- [ ] **Step 8: Feed it from the agenda views**

Two edits in `app/src/components/AgendaList.tsx`:

a) Add the import, after `import { TaskRow } from './TaskRow'`:

```ts
import { useProgress } from '../lib/useProgress'
```

b) Call it beside the existing `useLiveQuery` calls in the component body:

```tsx
  const progress = useProgress()
```

then add the prop to the `<TaskRow ... />` call:

```tsx
                <TaskRow
                  task={task}
                  onOpen={onOpen}
                  badge={names.get(task.project_id)}
                  progress={progress.get(task.id)}
                />
```

- [ ] **Step 9: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **215 passed (215)**, 21 files. Clean build, clean lint.

- [ ] **Step 10: Commit**

```bash
git add src/lib/progress.ts src/lib/progress.test.ts src/lib/useProgress.ts src/components/TaskRow.tsx src/components/TaskList.tsx src/components/AgendaList.tsx
git commit -m "feat: a task row says how far through its checklist it is

A checklist you cannot see from the outside is one you forget you wrote.
SPEC §2 takes 'a card can open into detail without demanding it' from
Trello, and the counter is the half of that sentence that does the work.

The counting is pure and tested; useProgress is the one live query, held
once per list rather than once per row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The checklist inside the sheet

**Files:**
- Create: `app/src/components/Checklist.tsx`
- Modify: `app/src/components/TaskSheet.tsx`
- Modify: `app/src/components/Toast.tsx`
- Modify: `app/README.md`

**Interfaces:**
- Consumes: `listChecklistItems`, `addChecklistItem`, `setChecklistItemDone`,
  `renameChecklistItem`, `deleteChecklistItem` from `../lib/repo` (Task 2);
  `pushUndo` from `../lib/undo`; `reportProblem` from `../lib/problems`.
- Produces: `<Checklist taskId={string} />`.

- [ ] **Step 1: Raise the toast above the sheet**

In `app/src/components/Toast.tsx`, change the container's `z-20` to `z-40` and
say why. Replace:

```tsx
      className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-3"
```

with:

```tsx
      // Above the task sheet's z-30, not below it. Deleting a checklist item
      // happens with the sheet open and the sheet stays open afterwards, so a
      // toast behind the backdrop is an undo offer nobody can see — and on a
      // phone there is no Ctrl+Z to fall back on.
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-3"
```

- [ ] **Step 2: Write `Checklist.tsx`**

Create `app/src/components/Checklist.tsx`:

```tsx
/**
 * A task's checklist, inside the sheet.
 *
 * SPEC §4: "Checklist items are not tasks. They have no due date, no labels,
 * no detail view." So this is three controls on a line and an add field, and
 * it should stay that way — every affordance added here is one step toward the
 * project-management tool §4 exists to prevent.
 *
 * **It uses `useLiveQuery`, and `TaskSheet` deliberately does not.** That rule
 * protects the *draft*, not the row set, and here the two come apart:
 *
 * - The live query drives which items exist and whether they are ticked. It
 *   has to: undo is an ordinary new mutation against the database (SPEC §4.5),
 *   so an item deleted and then restored must reappear on a sheet that is
 *   still open. A snapshot would show a stale list.
 * - A `drafts` map keyed by item id drives the characters in an input. On
 *   commit the draft is dropped, and the live value replacing it is the string
 *   we just wrote — an identical value, which React does not treat as a change,
 *   so the cursor stays where it was.
 */
import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listChecklistItems,
  addChecklistItem,
  setChecklistItemDone,
  renameChecklistItem,
  deleteChecklistItem,
} from '../lib/repo'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'

const PAUSE_MS = 500

export function Checklist({ taskId }: { taskId: string }) {
  const items = useLiveQuery(() => listChecklistItems(taskId), [taskId])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // One timer per item, not one for the checklist. `TaskSheet` learned this
  // the hard way: a single timer means committing one field silently drops
  // another field's pending edit.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const rows = items ?? []
  const done = rows.filter((item) => item.done).length

  function forget(id: string) {
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  /**
   * The draft is dropped whether or not the write happened. An empty title is
   * refused (`renameChecklistItem` returns null), and dropping the draft is
   * what puts the stored title back on screen — so the refusal is visible
   * rather than silent.
   */
  function commit(id: string, value: string) {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    void renameChecklistItem(id, value).then((step) => {
      pushUndo(step)
      forget(id)
    })
  }

  function commitLater(id: string, value: string) {
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => commit(id, value), PAUSE_MS))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = title.trim()
    if (!value) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field never appears to wait (SPEC §9). QuickAdd's rule.
    setTitle('')
    try {
      const { undo } = await addChecklistItem(taskId, value)
      pushUndo(undo)
    } catch (error) {
      // The field was cleared optimistically, so a failure hands the words
      // back — losing what someone typed is worse than the failure.
      setTitle(value)
      reportProblem('Item not added', error)
    }
    input.current?.focus()
  }

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Checklist
        </span>
        {rows.length > 0 && (
          <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {done}/{rows.length}
          </span>
        )}
      </div>

      <ul className="mt-1">
        {rows.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <label className="flex min-h-11 shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) =>
                  void setChecklistItemDone(item.id, e.target.checked).then(pushUndo)
                }
                aria-label={`Tick ${item.title}`}
                className="size-4 shrink-0 accent-accent"
              />
            </label>
            <input
              value={drafts[item.id] ?? item.title}
              onChange={(e) => {
                const value = e.target.value
                setDrafts((current) => ({ ...current, [item.id]: value }))
                commitLater(item.id, value)
              }}
              onBlur={() => commit(item.id, drafts[item.id] ?? item.title)}
              aria-label={`Item ${item.title}`}
              className={
                'min-h-11 flex-1 bg-transparent text-[15px] outline-none ' +
                (item.done
                  ? 'text-neutral-400 line-through dark:text-neutral-600'
                  : 'text-neutral-900 dark:text-neutral-100')
              }
            />
            <button
              type="button"
              onClick={() => void deleteChecklistItem(item.id).then(pushUndo)}
              aria-label={`Delete ${item.title}`}
              className="min-h-11 px-2 text-neutral-300 dark:text-neutral-600"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add an item"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          aria-label="Add a checklist item"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-accent disabled:opacity-30"
        >
          Add
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Render it in the sheet**

Two edits in `app/src/components/TaskSheet.tsx`:

a) Add the import, after `import { pushUndo, type UndoStep } from '../lib/undo'`:

```ts
import { Checklist } from './Checklist'
```

b) Insert `<Checklist taskId={taskId} />` between the Notes `</label>` and the
`<div className="mt-4 flex items-center gap-2">` that starts the Due row:

```tsx
            </label>

            <Checklist taskId={taskId} />

            <div className="mt-4 flex items-center gap-2">
```

Below Notes and above Due on purpose: notes and a checklist are both "what this
task actually involves", while due date, priority, project and section are all
"where and when it sits".

- [ ] **Step 4: Run the suite, the compiler and the linter**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **215 passed (215)**, 21 files — Task 5 adds no unit test, because
SPEC §11.3 rule 2 rules out jsdom and `@testing-library/react`. Clean build,
clean lint.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev` and drive the app at a phone viewport (390×844) and a desktop
one. Check the console for errors and warnings at the end — the standing bar
for this project is zero.

Walk this list:

1. Open a task. The checklist sits below Notes with an "Add an item" field.
2. Type an item, press Enter. It appears, the field clears and keeps focus.
   Type two more without touching the mouse — they append in order.
3. The header reads `0/3`. Tick one: `1/3`.
4. Close the sheet. The task's row shows `1/3` next to its due date.
5. Switch the project to board view. The card shows `1/3` too.
6. Go to Today (with the task dated today). The row shows `1/3` there as well.
7. Reopen the task, edit an item's text, tap elsewhere. The new text sticks.
   Type into an item and wait without blurring — it saves after the pause.
8. Delete an item with the ×. **The undo toast must be visible over the sheet**
   — this is what Step 1's `z-40` is for. Take the undo: the item comes back.
9. Delete the whole task from the sheet. Undo from the toast: the task returns
   *with its items* — reopen it to confirm.
10. Empty the "Add an item" field and press Enter: nothing happens, no error.
11. Clear an item's text entirely and blur: the old text comes back rather than
    an empty row.

Record anything that surprises you. A finding here is worth more than a passing
test — it is the only place a component in this project is checked at all.

- [ ] **Step 6: Update the README**

In `app/README.md`:

a) Replace the status paragraph (lines beginning "Currently at **P0b slice 6")
with:

```markdown
Currently at **P0b slice 7 — checklist items** (SPEC §13). A task holds
sub-steps: add, tick, rename and delete them in the sheet, and every task row
says how far through them you are — `2/5` next to the due date, in the list, on
a board card and in Today and Upcoming alike. Deleting a task takes its items
with it, and one undo brings back both.

A project is a list or a board, toggled from the header and remembered per
project and per device — the same sections, as headers or as columns, with Done
as the last column you can drag a card into to complete it.
```

b) In the `Layout` code block, add three lines. After the `drag.ts` line:

```
    progress.ts             how far through a checklist a task is (pure)
```

after the `agenda.ts` line, keeping the existing ordering sense; and inside the
`repo/` group, after the `tasks.ts · projects.ts · sections.ts` line:

```
      checklist.ts          sub-steps on a task (SPEC §4)
```

and in the `components/` group, after the `TaskSheet.tsx` line:

```
    Checklist.tsx           the sheet's sub-steps, live-queried
```

c) In the `npm test` comment inside the Commands block, add `progress` to the
parenthesised list of what is tested.

- [ ] **Step 7: Commit**

```bash
git add src/components/Checklist.tsx src/components/TaskSheet.tsx src/components/Toast.tsx README.md
git commit -m "feat: a checklist inside the task sheet

The sheet avoids useLiveQuery so a live value cannot fight the cursor
mid-word. This component uses one anyway, because that rule protects the
draft rather than the row set, and undo has to be able to put a deleted
item back on a sheet that is still open. The characters someone is typing
are protected instead by a drafts map keyed by item id.

Toast moves to z-40. It sat below the sheet's z-30, so an undo offer
raised while the sheet was open was invisible — and deleting an item is
exactly that case, with no Ctrl+Z on a phone to fall back on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Finishing

After Task 5, use **superpowers:finishing-a-development-branch**: verify the
full suite is green, then present the options and execute the choice. The repo
convention is a rebase merge onto a linear `main`, and per the standing
instruction, work reaches `main` through a PR — never a direct commit.

Deploy a throwaway preview for the phone with `npx wrangler deploy --temporary`
from `app/`, and report the URL. The Workers Builds check fails on every PR
branch in this repo and has since PR #4, including a docs-only one; it is a
known unrelated failure, not this slice's.

## Self-review

Run against the spec before starting:

**Spec coverage.** Decision 1 (the `2/5` counter) → Task 4. Decision 2 (no drag
reordering) → nothing to build; positions are real, and Task 2's
`appendItemPositionIn` is what makes reordering possible later. Decision 3 (the
cascade) → Task 3. Decision 4 (ticking everything does nothing) → Task 2's
comment on `setChecklistItemDone`, and the absence of any code that reads the
count back into the task. Decision 5 (`done` is a boolean) → Task 1. The
architecture sections map one-to-one: `schema.ts` and version 4 → Task 1;
`repo/checklist.ts`, `positions.ts` → Task 2; the cascade → Task 3;
`progress.ts`, `useProgress.ts`, `TaskRow` → Task 4; `Checklist.tsx` → Task 5.

**One addition the spec does not have.** `Toast` moving to `z-40` was found
while planning, not while designing: the spec says the item delete is undoable
without noticing that the toast renders behind the sheet it would be offered
over. It is in Task 5 Step 1, and the design doc should be amended to match.

**Error handling.** The spec's three cases are covered — the empty title is
Task 2's `addChecklistItem` throw and `renameChecklistItem` null (both tested);
the orphan item is the reader's `task_id` filter, which needs no code because
`listChecklistItems` already filters; the late write is `write()`'s existing
tombstone refusal, which this slice does not change.

**Type consistency.** `Progress` is defined once, in `progress.ts`, and
imported by `useProgress.ts` and `TaskRow.tsx`. `ChecklistItem` is defined once,
in `schema.ts`. `listChecklistItems` is spelled the same in Tasks 2, 3 and 5.
`appendItemPositionIn` appears in Task 2 only. No task references a name no
task defines.
