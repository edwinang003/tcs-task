# P0b Slice 1 — Outbox Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every local write in Lane records the row and an outbox entry in one IndexedDB transaction, and `projects`/`sections` exist as real tables, so P1 implements a transport rather than rewriting every write path.

**Architecture:** Dexie gains version 2 with three tables (`projects`, `sections`, `outbox`) and an upgrade that materializes the Inbox project, its two sections, and backfills outbox entries for tasks created during P0a. `repo.ts` is restructured around two internal helpers — `create()` and `write()` — that each open one transaction spanning the data table and `outbox`, so a row cannot be written without its entry. No component changes and no visible behaviour change.

**Tech Stack:** TypeScript 6, React 19, Dexie 4.4.5, Vite 8, Vitest 4.1.10, fake-indexeddb 6.2.5 (new, test-only).

**Spec:** `docs/superpowers/specs/2026-08-18-p0b-outbox-foundation-design.md`

## Global Constraints

Copied from `docs/SPEC.md`; every task inherits these.

- **§11.3 rule 1 — every risky dependency is imported in exactly one file.** Dexie is imported in `src/lib/db.ts` and nowhere else, including the new files in this plan. `outbox.ts` and `repo.ts` reach IndexedDB only through the `db` object.
- **§11.3 rule 2 — prefer ~40 lines you own to a package when it is genuinely ~40 lines.** The `localStorage` test stub in Task 1 is hand-written for this reason rather than pulling in jsdom or happy-dom.
- **§11.3 rule 3 — lockfile committed, versions pinned exactly.** `.npmrc` sets `save-exact=true`; never introduce a `^` or `~` range.
- **§9.1 — atomicity is the single most important detail.** "A row written without its outbox entry is a silently lost change." Every write in this plan spans the data table and `outbox` in one `db.transaction('rw', ...)`.
- **§4.1 — server-owned columns are never pushed.** `updated_at` and `reminder_sent_at` are listed in `SERVER_OWNED_COLUMNS` and must be filtered out of every outbox `columns` array, even though they are written locally.
- **§9.2 — push in referential order.** Outbox `seq` is ascending and a coalesced append never changes an existing `seq`, so a project keeps a lower sequence number than the tasks inside it.
- **§12.3 — the client must never assume there is one workspace.** Ids come from `activeWorkspace()`, never from a literal at the call site.
- Comments in this codebase cite spec sections (`SPEC §9.1`) where a decision is non-obvious. Match that density; do not add narration to obvious code.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `app/src/test/setup.ts` | Installs `fake-indexeddb` and a minimal `localStorage` so Dexie and `device.ts` work under Vitest in Node |
| `app/src/lib/outbox.ts` | `appendOutbox()` — the coalescing append. The only place that knows the entry shape |
| `app/src/lib/outbox.test.ts` | Coalescing, ordering, server-owned filtering, parked entries |
| `app/src/lib/repo.test.ts` | Per-function dirty column sets, and the atomicity property |
| `app/src/lib/migration.test.ts` | v1 → v2 upgrade, including the P0a task backfill |

**Modified:**

| File | Change |
|---|---|
| `app/package.json` | `fake-indexeddb` devDependency, pinned |
| `app/vite.config.ts` | Vitest `test` block: setup file and node environment |
| `app/src/lib/schema.ts` | `Project`, `Section`, `OutboxEntry`, `TableName`; `PUSHABLE_TABLES` grows |
| `app/src/lib/workspace.ts` | `doneSectionId` added to `WorkspaceContext` |
| `app/src/lib/db.ts` | Version 2 stores, the upgrade function, `createDb()` factory |
| `app/src/lib/repo.ts` | `create()` / `write()` helpers; public functions become one-liners |
| `app/README.md` | Layout section gains the new files |

---

### Task 1: Test harness that can open a real Dexie database

Vitest currently runs two pure-function test files in Node with no DOM. Dexie needs an `indexedDB` global and `device.ts` needs `localStorage`, so nothing in `repo.ts` is testable until this exists.

**Files:**
- Modify: `app/package.json`
- Modify: `app/vite.config.ts:1-7`
- Create: `app/src/test/setup.ts`
- Test: `app/src/test/setup.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a Vitest environment where `indexedDB` and `localStorage` are defined, and each test file starts with a clean IndexedDB.

- [ ] **Step 1: Install the dependency, pinned**

```bash
cd app && npm install --save-dev --save-exact fake-indexeddb@6.2.5
```

Confirm `package.json` reads `"fake-indexeddb": "6.2.5"` with no `^`.

- [ ] **Step 2: Write the setup file**

Create `app/src/test/setup.ts`:

```ts
/**
 * Vitest environment. SPEC §11.3 rule 2: `localStorage` is eleven lines we own
 * rather than jsdom or happy-dom, which exist to provide a DOM that none of
 * these tests need — they exercise `lib/`, not components.
 */
import 'fake-indexeddb/auto'

class MemoryStorage {
  #items = new Map<string, string>()
  get length() {
    return this.#items.size
  }
  getItem(key: string): string | null {
    return this.#items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#items.set(key, String(value))
  }
  removeItem(key: string): void {
    this.#items.delete(key)
  }
  clear(): void {
    this.#items.clear()
  }
  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null
  }
}

globalThis.localStorage = new MemoryStorage() as unknown as Storage
```

- [ ] **Step 3: Wire it into Vitest**

In `app/vite.config.ts`, change the import on line 1 and add a `test` block as the last property of the config object. `defineConfig` must come from `vitest/config` — the one exported by `vite` does not type `test`.

```ts
import { defineConfig } from 'vitest/config'
```

```ts
  // Vitest. The `lib/` tests open a real Dexie database against
  // fake-indexeddb, so they need the setup file below (SPEC §9.9's
  // "testable" applies to the local half too).
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
```

- [ ] **Step 4: Write the failing smoke test**

Create `app/src/test/setup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { db } from '../lib/db'

describe('test harness', () => {
  it('opens the Dexie database', async () => {
    await db.open()
    expect(db.isOpen()).toBe(true)
    expect(db.tasks).toBeDefined()
  })

  it('provides localStorage for device.ts', async () => {
    const { clientId } = await import('../lib/device')
    expect(clientId()).toMatch(/^[0-9a-f]{8}-/)
    expect(clientId()).toBe(clientId())
  })
})
```

- [ ] **Step 5: Run it**

Run: `cd app && npm test`
Expected: both new tests PASS, and the existing 9 tests still pass — 11 total. If the Dexie test fails with "indexedDB is not defined", the setup file is not being loaded; check the `setupFiles` path is relative to `app/`.

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/vite.config.ts app/src/test/
git commit -m "test: harness that can open a real Dexie database

fake-indexeddb, pinned and test-only, plus an eleven-line localStorage
we own rather than jsdom (SPEC §11.3 rule 2). Nothing in repo.ts was
testable without it."
```

---

### Task 2: Row shapes for projects, sections and the outbox

Types only, no behaviour. Splitting them out means Tasks 3–6 all compile against one agreed shape.

**Files:**
- Modify: `app/src/lib/schema.ts`
- Modify: `app/src/lib/workspace.ts:17-30`

**Interfaces:**
- Consumes: `SyncColumns` and `SERVER_OWNED_COLUMNS` from `schema.ts` (already exist)
- Produces:
  - `interface Project extends SyncColumns` — `name`, `color`, `icon`, `position`, `archived_at`
  - `interface Section extends SyncColumns` — `project_id`, `name`, `position`, `is_done_section`
  - `interface OutboxEntry` — `seq`, `table`, `row_id`, `columns`, `status`, `reason`, `created_at`
  - `type TableName = (typeof PUSHABLE_TABLES)[number]` — `'tasks' | 'projects' | 'sections'`
  - `activeWorkspace()` returns a fourth field, `doneSectionId: string`

- [ ] **Step 1: Add the row shapes**

Append to `app/src/lib/schema.ts`, above `SERVER_OWNED_COLUMNS`:

```ts
/** SPEC §4.1 — `projects`. */
export interface Project extends SyncColumns {
  name: string
  color: string | null
  icon: string | null
  /** Fractional index, a string (SPEC §4.2). */
  position: string
  /** SPEC §4.4: archiving is the safe default the UI nudges toward. */
  archived_at: string | null
}

/** SPEC §4.1 — `sections`. */
export interface Section extends SyncColumns {
  project_id: string
  name: string
  position: string
  /** SPEC §4: checking a task moves it here. The move lands with the
   * sections UI; this slice only creates the row. */
  is_done_section: boolean
}
```

`projects.default_view` is deliberately absent — SPEC §4.1 makes it a per-device localStorage value, and putting it in Dexie is what would sync it.

- [ ] **Step 2: Add the outbox entry shape**

Append to `app/src/lib/schema.ts`:

```ts
/**
 * SPEC §9.1 — one entry per dirty row, not a delta log.
 *
 * There is no `op` column on purpose: creates, updates and deletes are all
 * upserts by row id on the server, and a soft delete is `deleted_at` showing
 * up in `columns` like any other change.
 */
export interface OutboxEntry {
  /** Dexie auto-increment. The push order (SPEC §9.2). */
  seq: number
  table: TableName
  row_id: string
  /** The dirty column set, server-owned columns excluded (SPEC §4.1). */
  columns: string[]
  /**
   * SPEC §9.1: "rejectable, not merely retryable". Nothing sets 'parked'
   * until P1 has a server that can reject — the field exists now because
   * retrofitting it "means auditing every write path in the app".
   */
  status: 'pending' | 'parked'
  reason: string | null
  created_at: string
}
```

- [ ] **Step 3: Widen the pushable tables and name the type**

Replace the `PUSHABLE_TABLES` declaration in `app/src/lib/schema.ts`:

```ts
export const PUSHABLE_TABLES = ['tasks', 'projects', 'sections'] as const

/** The tables a write can target. `outbox` is deliberately not one. */
export type TableName = (typeof PUSHABLE_TABLES)[number]
```

- [ ] **Step 4: Give the workspace a done section**

In `app/src/lib/workspace.ts`, add the constant next to the others and the field to both the interface and the returned object:

```ts
const LOCAL_DONE_SECTION_ID = '01920000-0000-7000-8000-000000000004'
```

```ts
export interface WorkspaceContext {
  workspaceId: string
  /** P0a's one hardcoded list. P0b replaces this with real projects. */
  projectId: string
  sectionId: string
  /** SPEC §4: where a completed task lands. Created in the v2 migration;
   * nothing moves tasks into it until the sections UI exists. */
  doneSectionId: string
}
```

```ts
    doneSectionId: LOCAL_DONE_SECTION_ID,
```

- [ ] **Step 5: Verify it compiles**

Run: `cd app && npm run build`
Expected: clean. `noUnusedLocals` is on, but every new export is referenced by a later task rather than now, so no error should appear — types and exported constants are exempt.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/schema.ts app/src/lib/workspace.ts
git commit -m "feat: row shapes for projects, sections and the outbox

Types only. The outbox entry carries status and reason from the start
because SPEC §9.1 warns that retrofitting rejectability means auditing
every write path."
```

---

### Task 3: Dexie version 2 tables

The stores, without the upgrade function — Task 6 adds that once there is something to enqueue with.

**Files:**
- Modify: `app/src/lib/db.ts`
- Test: `app/src/lib/db.test.ts` (create)

**Interfaces:**
- Consumes: `Project`, `Section`, `OutboxEntry` from Task 2
- Produces:
  - `db.projects`, `db.sections`, `db.outbox` typed tables
  - `createDb(name: string, ceiling?: 1 | 2): LaneDb` — a factory. The `ceiling` argument stops schema declaration at version 1 so Task 6's migration test can build a genuine v1 fixture without importing Dexie itself (SPEC §11.3 rule 1).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/db.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './db'

describe('schema', () => {
  const dbs: { close(): void }[] = []
  afterEach(() => {
    for (const d of dbs) d.close()
    dbs.length = 0
  })

  it('is at version 2 with the three new tables', async () => {
    const db = createDb('lane-schema-test')
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(2)
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'outbox',
      'projects',
      'sections',
      'tasks',
    ])
  })

  it('stops at version 1 when a ceiling is given', async () => {
    const db = createDb('lane-ceiling-test', 1)
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(1)
    expect(db.tables.map((t) => t.name)).toEqual(['tasks'])
  })

  it('gives the outbox an auto-incrementing primary key', async () => {
    const db = createDb('lane-seq-test')
    dbs.push(db)
    await db.open()
    const a = await db.outbox.add({
      table: 'tasks',
      row_id: 'a',
      columns: ['title'],
      status: 'pending',
      reason: null,
      created_at: '2026-08-18T00:00:00.000Z',
    } as never)
    const b = await db.outbox.add({
      table: 'tasks',
      row_id: 'b',
      columns: ['title'],
      status: 'pending',
      reason: null,
      created_at: '2026-08-18T00:00:00.000Z',
    } as never)
    expect(Number(b)).toBeGreaterThan(Number(a))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/db.test.ts`
Expected: FAIL — `createDb` is not exported from `./db`.

- [ ] **Step 3: Restructure db.ts around a factory**

Replace everything in `app/src/lib/db.ts` from `export const db` to the end with:

```ts
export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}

/**
 * Indexes are the local mirror of SPEC §12.2's access paths.
 * `[workspace_id+position]` is how a list view reads;
 * `[workspace_id+updated_at]` is what P1's push scans for dirty rows.
 *
 * `ceiling` exists so that the migration test can open a genuine version 1
 * database without importing Dexie itself (SPEC §11.3 rule 1). Production
 * never passes it.
 */
export function createDb(name: string = DB_NAME, ceiling: 1 | 2 = 2): LaneDb {
  const db = new Dexie(name) as LaneDb

  db.version(1).stores({
    tasks:
      'id, [workspace_id+position], [workspace_id+updated_at], completed_at, deleted_at',
  })

  if (ceiling >= 2) {
    // Dexie carries unchanged tables forward, so `tasks` is not restated.
    db.version(2).stores({
      projects: 'id, [workspace_id+position], [workspace_id+updated_at], deleted_at',
      sections:
        'id, [workspace_id+project_id], [workspace_id+updated_at], deleted_at',
      outbox: '++seq, [table+row_id], status',
    })
  }

  return db
}

export const db = createDb()
```

Add `Project`, `Section` and `OutboxEntry` to the existing type import from `./schema`.

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test`
Expected: all PASS, 14 total.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/db.ts app/src/lib/db.test.ts
git commit -m "feat: Dexie version 2 — projects, sections, outbox

No upgrade function yet; the migration lands with something to enqueue.
createDb's version ceiling is what lets the migration test build a real
v1 fixture without a second file importing Dexie (SPEC §11.3 rule 1)."
```

---

### Task 4: The coalescing append

The heart of the slice. One function, and the invariants SPEC §9.1 attaches to it.

**Files:**
- Create: `app/src/lib/outbox.ts`
- Create: `app/src/lib/outbox.test.ts`

**Interfaces:**
- Consumes: `db` from Task 3; `TableName`, `SERVER_OWNED_COLUMNS` from Task 2
- Produces: `appendOutbox(table: TableName, rowId: string, columns: string[]): Promise<void>` — **must be called inside an existing `rw` transaction that includes `db.outbox`.** Callers own the transaction so the row write and the append commit together.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/outbox.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { appendOutbox } from './outbox'

/** Every append must happen inside a transaction the caller owns (SPEC §9.1). */
function append(table: 'tasks' | 'projects', rowId: string, columns: string[]) {
  return db.transaction('rw', db.outbox, () => appendOutbox(table, rowId, columns))
}

describe('appendOutbox', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Task 6 seeds the Inbox project and its sections into every fresh
    // database, entries and all. These tests are about the append itself.
    await db.outbox.clear()
  })

  it('coalesces repeated edits to one row into a single entry', async () => {
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-1', ['due_on'])

    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].columns.sort()).toEqual(['due_on', 'title'])
  })

  it('keeps the original seq when coalescing, so referential order survives', async () => {
    // SPEC §9.2: a project pushed after the tasks inside it fails the FK.
    await append('projects', 'project-1', ['name'])
    await append('tasks', 'task-1', ['title'])
    await append('projects', 'project-1', ['color'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => e.row_id)).toEqual(['project-1', 'task-1'])
  })

  it('keeps separate entries for separate rows, in append order', async () => {
    await append('tasks', 'task-1', ['title'])
    await append('tasks', 'task-2', ['title'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => e.row_id)).toEqual(['task-1', 'task-2'])
    expect(entries[1].seq).toBeGreaterThan(entries[0].seq)
  })

  it('never enqueues server-owned columns', async () => {
    // SPEC §4.1: a client that pushes a stale reminder_sent_at silently
    // un-sends a reminder.
    await append('tasks', 'task-1', ['title', 'updated_at', 'reminder_sent_at'])

    const entry = await db.outbox.toCollection().first()
    expect(entry!.columns).toEqual(['title'])
  })

  it('does not append an entry whose columns are all server-owned', async () => {
    await append('tasks', 'task-1', ['updated_at'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('does not coalesce into a parked entry', async () => {
    // SPEC §9.1: a parked entry keeps its reason for the user to see.
    await append('tasks', 'task-1', ['title'])
    await db.outbox.toCollection().modify({ status: 'parked', reason: 'over plan limit' })

    await append('tasks', 'task-1', ['notes'])

    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ status: 'parked', reason: 'over plan limit' })
    expect(entries[1]).toMatchObject({ status: 'pending', columns: ['notes'] })
  })

  it('records entries as pending with a creation timestamp', async () => {
    await append('tasks', 'task-1', ['title'])
    const entry = await db.outbox.toCollection().first()
    expect(entry).toMatchObject({ table: 'tasks', row_id: 'task-1', status: 'pending', reason: null })
    expect(Date.parse(entry!.created_at)).not.toBeNaN()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/lib/outbox.test.ts`
Expected: FAIL — cannot resolve `./outbox`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/outbox.ts`:

```ts
/**
 * The outbox. SPEC §9.1: "Every local mutation writes the row **and** appends
 * an outbox entry **in the same IndexedDB transaction**. A row written without
 * its outbox entry is a silently lost change — this atomicity is the single
 * most important detail in the sync engine."
 *
 * Which is why `appendOutbox` does not open a transaction of its own. It must
 * be called inside the caller's, so that a failure rolls back both.
 */

import { db } from './db'
import { SERVER_OWNED_COLUMNS, type TableName } from './schema'

const SERVER_OWNED = new Set<string>(SERVER_OWNED_COLUMNS)

export async function appendOutbox(
  table: TableName,
  rowId: string,
  columns: string[],
): Promise<void> {
  // SPEC §4.1: the push payload whitelist is explicit, and these are not on it.
  const dirty = columns.filter((c) => !SERVER_OWNED.has(c))
  if (dirty.length === 0) return

  const pending = await db.outbox
    .where('[table+row_id]')
    .equals([table, rowId])
    .filter((e) => e.status === 'pending')
    .first()

  if (pending) {
    // SPEC §9.2: the seq is left alone on purpose. A project created before
    // the tasks inside it must keep its lower sequence number however many
    // times those tasks are edited afterwards.
    await db.outbox.update(pending.seq, {
      columns: [...new Set([...pending.columns, ...dirty])],
    })
    return
  }

  await db.outbox.add({
    table,
    row_id: rowId,
    columns: [...new Set(dirty)],
    status: 'pending',
    reason: null,
    created_at: new Date().toISOString(),
  } as never)
}
```

The `as never` on `add` is because `seq` is auto-incremented by Dexie and so is absent from the object; Dexie's types do not model that.

- [ ] **Step 4: Run the tests**

Run: `cd app && npx vitest run src/lib/outbox.test.ts`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/outbox.ts app/src/lib/outbox.test.ts
git commit -m "feat: the coalescing outbox append

Coalesces per row keyed by dirty column, filters server-owned columns,
and leaves the seq alone when coalescing — which is what preserves
§9.2's referential push order. Takes no transaction of its own; the
caller's transaction is the atomicity guarantee (§9.1)."
```

---

### Task 5: The write seam in repo.ts

**Files:**
- Modify: `app/src/lib/repo.ts` (whole file)
- Create: `app/src/lib/repo.test.ts`

**Interfaces:**
- Consumes: `appendOutbox` from Task 4; `db`, `TableName`
- Produces: unchanged public signatures — `listTasks()`, `addTask(title)`, `setTaskDone(id, done)`, `renameTask(id, title)`, `deleteTask(id)`. Components must not need editing.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { addTask, setTaskDone, renameTask, deleteTask, listTasks } from './repo'
import { activeWorkspace } from './workspace'

async function entriesFor(rowId: string) {
  return db.outbox.where('[table+row_id]').equals(['tasks', rowId]).toArray()
}

describe('repo', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Task 6 seeds the Inbox project and its sections on first open.
    await db.outbox.clear()
  })

  it('enqueues a new task with its full column set', async () => {
    const id = await addTask('buy milk')
    const [entry] = await entriesFor(id)

    expect(entry.columns).toContain('title')
    expect(entry.columns).toContain('workspace_id')
    expect(entry.columns).toContain('position')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('enqueues only the column each edit changed', async () => {
    const id = await addTask('buy milk')
    await db.outbox.clear()

    await renameTask(id, 'buy oat milk')
    expect((await entriesFor(id))[0].columns).toEqual(['title'])

    await db.outbox.clear()
    await setTaskDone(id, true)
    expect((await entriesFor(id))[0].columns).toEqual(['completed_at'])
  })

  it('tombstones rather than removing, and enqueues deleted_at', async () => {
    const id = await addTask('buy milk')
    await db.outbox.clear()

    await deleteTask(id)

    expect(await db.tasks.get(id)).toBeDefined()
    expect((await entriesFor(id))[0].columns).toEqual(['deleted_at'])
    expect(await listTasks()).toHaveLength(0)
  })

  it('writes the row and its entry atomically', async () => {
    // SPEC §9.1: "A row written without its outbox entry is a silently lost
    // change." Force the append to fail and both halves must roll back.
    const id = await addTask('buy milk')
    await db.outbox.clear()

    const original = db.outbox.add
    db.outbox.add = () => Promise.reject(new Error('disk full'))
    try {
      await expect(renameTask(id, 'renamed')).rejects.toThrow('disk full')
    } finally {
      db.outbox.add = original
    }

    expect((await db.tasks.get(id))!.title).toBe('buy milk')
    expect(await db.outbox.count()).toBe(0)
  })

  it('stamps every write with this device and a fresh updated_at', async () => {
    const id = await addTask('buy milk')
    const before = (await db.tasks.get(id))!
    await renameTask(id, 'renamed')
    const after = (await db.tasks.get(id))!

    expect(after.client_id).toBe(before.client_id)
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at))
  })

  it('creates tasks in the active workspace, not a literal', async () => {
    const id = await addTask('buy milk')
    const task = (await db.tasks.get(id))!
    const { workspaceId, projectId, sectionId } = activeWorkspace()
    expect(task).toMatchObject({
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
    })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/lib/repo.test.ts`
Expected: FAIL — the atomicity and column-set tests fail because nothing writes to `outbox` yet. `db.outbox.count()` returns 0 everywhere an entry is expected.

- [ ] **Step 3: Add the two helpers**

In `app/src/lib/repo.ts`, add below `now()` — and import `appendOutbox` from `./outbox` plus `type TableName` from `./schema`:

```ts
/**
 * The two write primitives. Everything below goes through them, so a row
 * cannot be written without its outbox entry — SPEC §9.1 calls that atomicity
 * "the single most important detail in the sync engine".
 *
 * P1's pull deliberately does NOT use these: rows arriving from the server
 * must not be enqueued straight back at it.
 */
async function create<T extends { id: string }>(
  table: TableName,
  row: T,
): Promise<void> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).add(row)
    await appendOutbox(table, row.id, Object.keys(row))
  })
}

async function write(
  table: TableName,
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  // SPEC §9.4: this is the provisional local value; the server stamps the
  // real `updated_at` on push.
  const stamped = { ...changes, updated_at: now(), client_id: clientId() }
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const updated = await db.table(table).update(id, stamped)
    // A row that is not there cannot be dirty. Enqueueing anyway would push a
    // phantom id at the server.
    if (updated === 0) return
    await appendOutbox(table, id, Object.keys(stamped))
  })
}
```

- [ ] **Step 4: Route every public function through them**

Replace the bodies of the four writers in `app/src/lib/repo.ts`. `listTasks` is unchanged.

```ts
export async function addTask(title: string): Promise<string> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a task with no title')

  const { workspaceId, projectId, sectionId } = activeWorkspace()
  const id = uuidv7()

  // New tasks append to the end of the list.
  const last = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .last()

  const row: Task = {
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    section_id: sectionId,
    title: trimmed,
    notes: null,
    due_on: null,
    due_time: null,
    reminder_at: null,
    reminder_sent_at: null,
    priority: 0,
    completed_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    position: generateKeyBetween(last?.position ?? null, null),
    created_by: null,
    assignee_id: null,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }

  await create('tasks', row)
  return id
}

export function setTaskDone(id: string, done: boolean): Promise<void> {
  // SPEC §4: `completed_at` and `section_id` are always written together,
  // because checking a task moves it to the done section and dragging it
  // there checks it. The done section row now exists; nothing moves into it
  // until the sections UI does, so only the timestamp moves.
  return write('tasks', id, { completed_at: done ? now() : null })
}

export function renameTask(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return Promise.resolve()
  return write('tasks', id, { title: trimmed })
}

/**
 * SPEC §9: deletions are soft. The row stays as a tombstone so that a device
 * offline for a week learns about the deletion instead of resurrecting it.
 */
export function deleteTask(id: string): Promise<void> {
  return write('tasks', id, { deleted_at: now() })
}
```

Note the position read in `addTask` moved outside the transaction — `create` owns the transaction now. That is safe: two concurrent adds racing to the same `position` is a fractional-indexing tie, which resolves to a stable order rather than a lost row.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test`
Expected: all PASS, 27 total. If the atomicity test fails with the row renamed, the transaction is not spanning both tables — check `db.transaction('rw', db.table(table), db.outbox, ...)`.

- [ ] **Step 6: Verify no component changed**

Run: `git status --short app/src/components/`
Expected: empty. The public signatures are identical, which was the point.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/repo.ts app/src/lib/repo.test.ts
git commit -m "feat: every write goes through the outbox seam

create() and write() each span the data table and the outbox in one
transaction, so writing a row without its entry is not expressible
(SPEC §9.1). Public signatures are unchanged and no component moved."
```

---

### Task 6: The v1 → v2 migration

**Files:**
- Modify: `app/src/lib/db.ts` (the `version(2)` block)
- Create: `app/src/lib/migration.test.ts`

**Interfaces:**
- Consumes: `createDb(name, 1)` from Task 3; `activeWorkspace()` from Task 2; `clientId()`
- Produces: a v2 database containing the Inbox project, its two sections, and one outbox entry per pre-existing task

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDb } from './db'
import { activeWorkspace } from './workspace'

const { workspaceId, projectId, sectionId, doneSectionId } = activeWorkspace()

/** A database as P0a left it: version 1, tasks only, no outbox. */
async function seedV1(name: string, titles: string[]) {
  const v1 = createDb(name, 1)
  await v1.open()
  for (const [i, title] of titles.entries()) {
    await v1.tasks.add({
      id: `task-${i}`,
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
      title,
      notes: null,
      due_on: null,
      due_time: null,
      reminder_at: null,
      reminder_sent_at: null,
      priority: 0,
      completed_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      position: `a${i}`,
      created_by: null,
      assignee_id: null,
      updated_at: '2026-08-01T00:00:00.000Z',
      deleted_at: null,
      client_id: 'p0a-device',
    })
  }
  v1.close()
}

describe('v1 → v2 migration', () => {
  it('materializes the Inbox project and its two sections', async () => {
    const name = 'lane-migration-rows'
    await seedV1(name, [])
    const db = createDb(name)
    await db.open()

    expect(await db.projects.get(projectId)).toMatchObject({
      name: 'Inbox',
      workspace_id: workspaceId,
      archived_at: null,
      deleted_at: null,
    })
    expect(await db.sections.get(sectionId)).toMatchObject({
      project_id: projectId,
      is_done_section: false,
    })
    expect(await db.sections.get(doneSectionId)).toMatchObject({
      project_id: projectId,
      is_done_section: true,
    })
    db.close()
  })

  it('backfills an outbox entry for every task created during P0a', async () => {
    // Without this, P1's first push sends the Inbox project and none of the
    // tasks in it, and the omission is invisible until a second device shows
    // an empty list.
    const name = 'lane-migration-backfill'
    await seedV1(name, ['buy milk', 'call the dentist'])
    const db = createDb(name)
    await db.open()

    const taskEntries = await db.outbox.where('table').equals('tasks').toArray()
    expect(taskEntries.map((e) => e.row_id).sort()).toEqual(['task-0', 'task-1'])
    expect(taskEntries[0].columns).toContain('title')
    expect(taskEntries[0].columns).not.toContain('updated_at')
    db.close()
  })

  it('pushes the project before the sections before the tasks', async () => {
    // SPEC §9.2: if tasks arrive before their project, the foreign key fails.
    const name = 'lane-migration-order'
    await seedV1(name, ['buy milk'])
    const db = createDb(name)
    await db.open()

    const tables = (await db.outbox.orderBy('seq').toArray()).map((e) => e.table)
    expect(tables).toEqual(['projects', 'sections', 'sections', 'tasks'])
    db.close()
  })

  it('leaves existing tasks untouched', async () => {
    const name = 'lane-migration-untouched'
    await seedV1(name, ['buy milk'])
    const db = createDb(name)
    await db.open()

    expect(await db.tasks.get('task-0')).toMatchObject({
      title: 'buy milk',
      project_id: projectId,
      section_id: sectionId,
      updated_at: '2026-08-01T00:00:00.000Z',
      client_id: 'p0a-device',
    })
    db.close()
  })

  it('seeds a brand-new database, which never runs an upgrade at all', async () => {
    // Dexie runs upgrade() only for a database that already existed. A first
    // install creates v2 directly, and must still get its Inbox project.
    const db = createDb('lane-fresh-install')
    await db.open()

    expect(await db.projects.get(projectId)).toMatchObject({ name: 'Inbox' })
    expect(await db.sections.count()).toBe(2)
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => e.table)).toEqual([
      'projects',
      'sections',
      'sections',
    ])
    db.close()
  })

  it('upgrades an empty database with no task entries', async () => {
    const name = 'lane-migration-empty'
    await seedV1(name, [])
    const db = createDb(name)
    await db.open()

    expect(await db.outbox.where('table').equals('tasks').count()).toBe(0)
    expect(await db.projects.count()).toBe(1)
    db.close()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/lib/migration.test.ts`
Expected: FAIL — `db.projects.get(...)` resolves to `undefined`; there is no upgrade function.

- [ ] **Step 3: Write the seeding, shared by both entry points**

Dexie runs `upgrade()` only for a database that already exists. A browser
installing Lane for the first time creates the database at version 2 directly
and never sees an upgrade — so the same rows have to be reachable from
`populate` as well, or a fresh install gets an outbox and no Inbox project.

In `app/src/lib/db.ts`, add `type Transaction` to the Dexie import, and imports
for `activeWorkspace` from `./workspace`, `clientId` from `./device`, and
`SERVER_OWNED_COLUMNS` from `./schema`. Then add above `createDb`:

```ts
const serverOwned = new Set<string>(SERVER_OWNED_COLUMNS)

/** SPEC §4.1: server-owned columns are never pushed by a client. */
function outboxEntry(table: string, row: { id: string }, stamp: string) {
  return {
    table,
    row_id: row.id,
    columns: Object.keys(row).filter((c) => !serverOwned.has(c)),
    status: 'pending' as const,
    reason: null,
    created_at: stamp,
  }
}

/**
 * The Inbox project and its two sections, with their outbox entries.
 *
 * Called from two places on purpose: `upgrade` for a database P0a left behind,
 * and `populate` for one created fresh at version 2 — Dexie runs an upgrade
 * only for a database that already existed, so a first install would otherwise
 * end up with an outbox and nothing in it.
 *
 * SPEC §12.3: the ids come from workspace.ts, which pins them precisely so
 * that rows created before a server exists line up with what P1 creates. Every
 * device generates the same ids here, which is harmless — push upserts by row
 * id, so the second device collapses onto the first.
 */
async function seedWorkspace(tx: Transaction): Promise<void> {
  const { workspaceId, projectId, sectionId, doneSectionId } = activeWorkspace()
  const stamp = new Date().toISOString()
  const sync = {
    workspace_id: workspaceId,
    updated_at: stamp,
    deleted_at: null,
    client_id: clientId(),
  }

  const project = {
    id: projectId,
    name: 'Inbox',
    color: null,
    icon: null,
    position: 'a0',
    archived_at: null,
    ...sync,
  }
  const sections = [
    { id: sectionId, project_id: projectId, name: 'Tasks', position: 'a0', is_done_section: false, ...sync },
    { id: doneSectionId, project_id: projectId, name: 'Done', position: 'a1', is_done_section: true, ...sync },
  ]

  await tx.table('projects').add(project)
  await tx.table('sections').bulkAdd(sections)
  // Order is the push order (SPEC §9.2): the project cannot arrive after the
  // sections that reference it.
  await tx.table('outbox').bulkAdd([
    outboxEntry('projects', project, stamp),
    ...sections.map((sct) => outboxEntry('sections', sct, stamp)),
  ])
}
```

- [ ] **Step 4: Wire both entry points**

Chain `.upgrade()` onto the `version(2)` block in `createDb`, and register
`populate` just before the `return`:

```ts
      outbox: '++seq, [table+row_id], status',
    }).upgrade(async (tx) => {
      await seedWorkspace(tx)

      // Tasks typed during P0a were written before an outbox existed. Without
      // this backfill, P1's first push sends the project and none of the work
      // inside it (SPEC §9.1: never drop an entry).
      const stamp = new Date().toISOString()
      const tasks = await tx.table('tasks').toArray()
      await tx.table('outbox').bulkAdd(
        tasks.map((t: { id: string }) => outboxEntry('tasks', t, stamp)),
      )
    })
```

```ts
  // A database created fresh at v2 never runs an upgrade.
  db.on('populate', (tx) => seedWorkspace(tx))

  return db
```

`appendOutbox` is deliberately unused here — it reaches for the `db` singleton,
and both of these must write through the transaction Dexie hands them.

- [ ] **Step 5: Run the tests**

Run: `cd app && npx vitest run src/lib/migration.test.ts`
Expected: all 6 PASS.

- [ ] **Step 6: Run everything**

Run: `cd app && npm test`
Expected: 33 PASS. `outbox.test.ts` and `repo.test.ts` already clear the outbox after opening, because `populate` now seeds three entries into every fresh database. If they fail on counts anyway, fix the test's `beforeEach` — never weaken the seeding.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/db.ts app/src/lib/migration.test.ts
git commit -m "feat: v1 to v2 migration, with the P0a backfill

Materializes the Inbox project and its two sections at the ids
workspace.ts already pins, so no task row is rewritten. Backfills an
outbox entry for every task created during P0a — without it, P1's first
push sends the project and none of the work inside it."
```

---

### Task 7: Documentation and full verification

**Files:**
- Modify: `app/README.md` (the Layout section)

**Interfaces:**
- Consumes: everything above
- Produces: a branch ready for review

- [ ] **Step 1: Update the layout map**

In `app/README.md`, add to the `src/lib/` block, keeping the existing alignment:

```
    outbox.ts               the coalescing append (SPEC §9.1)
```

and add below the two existing conventions:

```
- **Nothing writes to the database except `repo.ts`**, and nothing inside
  `repo.ts` writes except `create()` and `write()`, which each span the data
  table and the outbox in one transaction. P1 adds a transport that drains the
  outbox; it does not touch these call sites.
```

Update the "Currently at" paragraph to name P0b slice 1 and say the outbox has no transport yet.

- [ ] **Step 2: Full verification**

Run each and confirm before claiming done:

```bash
cd app
npm test          # expect 33 passing
npm run lint      # expect no output
npm run build     # expect a clean tsc -b and a built dist/
```

- [ ] **Step 3: Verify the real upgrade path by hand**

```bash
cd app && npm run dev
```

In a browser with a P0a database already present (or after adding two tasks, then stopping and restarting), confirm in DevTools → Application → IndexedDB that `lane` is at version 2, the tasks are still listed in the UI, `projects` has one row, `sections` has two, and `outbox` has one entry per task plus three. The app must look and behave exactly as before.

- [ ] **Step 4: Commit and open the PR**

```bash
git add app/README.md
git commit -m "docs: the write seam, in the README layout map"
git push -u origin p0b-1-outbox-foundation
gh pr create --title "P0b slice 1: the outbox foundation" --body "$(cat <<'BODY'
Implements `docs/superpowers/specs/2026-08-18-p0b-outbox-foundation-design.md`.

SPEC §13's P0b constraint and nothing else. No pixels change.

- `projects` and `sections` tables, with the full §4.1 sync column set
- an `outbox` that is atomic with the row write, ordered, coalesced by dirty
  column set, and carrying the per-entry verdict field §9.1 asks for
- `repo.ts` restructured around `create()` and `write()`, so a row cannot be
  written without its entry
- a v1→v2 migration that backfills entries for tasks created during P0a

Deferred with reasons in the spec: the done-section move, the pending
indicator, retry/backoff, and the reconciliation harness.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Notes for the executor

- **Do not add a `pending` count to the UI.** It only ever rises without a transport, and it reads as broken. P1's job.
- **Do not move `section_id` in `setTaskDone`.** Unchecking needs somewhere to restore to, and that arrives with the sections UI in slice 3.
- **If a test needs Dexie imported outside `db.ts`, stop.** `createDb`'s version ceiling exists so that never happens; if it is not enough, the design is wrong and worth raising rather than working around.
