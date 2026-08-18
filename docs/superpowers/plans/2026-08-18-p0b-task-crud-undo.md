# P0b slice 2 — task CRUD and undo: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a task notes, a due date and a priority through a bottom-sheet editor, and give every mutation in the app a single-level undo.

**Architecture:** `repo.ts` captures the previous value of the changed columns inside the transaction that changes them and returns an `UndoStep`. A module-singleton store holds exactly one step; components push what repo hands back. Undo is an ordinary new mutation with its own outbox entry — it never rewinds the outbox.

**Tech Stack:** React 19.2.8, TypeScript 6.0.3, Dexie 4.4.5, Tailwind 4.3.3, Vitest 4.1.10 with fake-indexeddb. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-p0b-task-crud-undo-design.md`, which argues from `docs/SPEC.md`.

## Global Constraints

Every task's requirements implicitly include these.

- **SPEC §4.5, verbatim:** undo is "local, session-scoped, and single-level per action: the previous value of the changed columns is held in memory and reapplied as an ordinary new mutation. It is not a sync operation and it never rewinds the outbox."
- **SPEC §9.1, verbatim:** "Every local mutation writes the row **and** appends an outbox entry **in the same IndexedDB transaction**." Nothing in this slice writes outside `create()` / `write()` in `repo.ts`.
- **SPEC §4.1:** `updated_at` and `reminder_sent_at` are server-owned and never pushed. `client_id` **is** pushed. Priority runs 0 = none … 3 = highest, and 0 is a real zero.
- **SPEC §4.1:** `due_on` is a date (`YYYY-MM-DD`), `due_time` a nullable time (`HH:MM`). Never a single timestamp.
- **SPEC §11.3 rule 1:** Dexie is imported in `db.ts` and nowhere else. If a step here seems to need it elsewhere, stop and ask.
- **SPEC §11.3 rule 2:** prefer ~40 lines you own to a package. This slice adds **no** dependencies — not a toast library, not a date library, not a component test harness.
- **SPEC §11.3 rule 3:** `.npmrc` has `save-exact=true`; the lockfile is committed.
- **Verification is `npm test` *and* `npm run build`.** `npm test` does not typecheck; slice 1 shipped a TS error past a green test run.
- Touch targets stay at least 44px (`min-h-11`), and dark mode is carried on every new element — the existing components are the pattern.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/undo.ts` | create | The single-step store: `UndoStep`, `pushUndo`, `undoLast`, `clearUndo`, `subscribe`, `getUndo`. Framework-free. |
| `src/lib/undo.test.ts` | create | Store mechanics. |
| `src/lib/dates.ts` | create | `todayLocal`, `isOverdue`, `formatDue`. Pure, no `Intl`, no dependency. |
| `src/lib/dates.test.ts` | create | Boundary cases. |
| `src/lib/repo.ts` | modify | Previous-value capture; mutations return `UndoStep`; `getTask` and three new setters. |
| `src/lib/repo.test.ts` | modify | Existing tests follow the new `addTask` return; new undo assertions. |
| `src/components/Toast.tsx` | create | `UndoToast` — the visible offer *and* the Ctrl/Cmd+Z listener. |
| `src/components/TaskSheet.tsx` | create | The bottom-sheet editor. |
| `src/components/TaskList.tsx` | modify | Tap to open, due chip, undo on the row's own actions. |
| `src/components/QuickAdd.tsx` | modify | Push the add's undo step. |
| `src/App.tsx` | modify | `openTaskId` state, mounts the sheet and the toast. |
| `app/README.md` | modify | Layout map and status line. |

**Why the keyboard listener lives in `Toast.tsx`:** it is the one component that is always mounted and already subscribed to the store. Putting it there keeps `App.tsx` to one concern — which overlay is open — and keeps React out of `src/lib/`.

---

### Task 1: The undo store

**Files:**
- Create: `app/src/lib/undo.ts`
- Test: `app/src/lib/undo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface UndoStep { label: string; toast: boolean; apply: () => Promise<unknown> }`; `pushUndo(step: UndoStep | null): void`; `undoLast(): Promise<boolean>`; `clearUndo(): void`; `subscribe(listener: () => void): () => void`; `getUndo(): UndoStep | null`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/undo.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pushUndo, undoLast, clearUndo, subscribe, getUndo } from './undo'

function step(label: string, apply = async () => {}) {
  return { label, toast: false, apply }
}

describe('undo', () => {
  beforeEach(() => {
    clearUndo()
  })

  it('holds the most recent step and hands it back', () => {
    pushUndo(step('Title changed'))
    expect(getUndo()?.label).toBe('Title changed')
  })

  it('ignores a null step, so a no-op write does not clear a real one', () => {
    // repo returns null when the row was not there. Pushing that must not
    // swallow the undo the user is actually reaching for.
    pushUndo(step('Task deleted'))
    pushUndo(null)
    expect(getUndo()?.label).toBe('Task deleted')
  })

  it('keeps only the last step — SPEC §4.5 is single-level', () => {
    pushUndo(step('first'))
    pushUndo(step('second'))
    expect(getUndo()?.label).toBe('second')
  })

  it('runs the step and empties the store', async () => {
    const apply = vi.fn(async () => {})
    pushUndo(step('Task deleted', apply))

    expect(await undoLast()).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
    expect(getUndo()).toBeNull()
  })

  it('undoing twice is a no-op, not a redo', async () => {
    // Without this, undo would push its own undo and Ctrl+Z would toggle
    // between two states forever.
    const apply = vi.fn(async () => {})
    pushUndo(step('Task deleted', apply))

    await undoLast()
    expect(await undoLast()).toBe(false)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('empties the store before awaiting, so a double press cannot double-apply', async () => {
    let release: () => void = () => {}
    const apply = vi.fn(() => new Promise<void>((r) => { release = r }))
    pushUndo(step('Task deleted', apply))

    const first = undoLast()
    const second = undoLast()
    release()
    await Promise.all([first, second])

    expect(apply).toHaveBeenCalledOnce()
  })

  it('notifies subscribers on push, undo and clear, and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    pushUndo(step('one'))
    await undoLast()
    pushUndo(step('two'))
    clearUndo()
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    pushUndo(step('three'))
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('clearing an empty store notifies nobody', () => {
    const listener = vi.fn()
    subscribe(listener)
    clearUndo()
    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/lib/undo.test.ts`
Expected: FAIL — "Failed to resolve import './undo'".

- [ ] **Step 3: Write the implementation**

`app/src/lib/undo.ts`:

```ts
/**
 * Undo. SPEC §4.5: "local, session-scoped, and single-level per action: the
 * previous value of the changed columns is held in memory and reapplied as an
 * ordinary new mutation. It is not a sync operation and it never rewinds the
 * outbox."
 *
 * In memory means a module singleton, not a table — it dies with the tab, by
 * design. Single-level means exactly one step: `undoLast` discards whatever
 * step its own write returns, because a redo that pushes an undo turns Ctrl+Z
 * into a toggle.
 *
 * Deliberately free of React so it can be tested by calling it. The one
 * consumer subscribes through `useSyncExternalStore`.
 */

export interface UndoStep {
  /** What just happened, from the user's side: "Task deleted". */
  label: string
  /**
   * Whether the action took its result off the screen and therefore needs a
   * visible offer rather than only a keyboard shortcut. Slice 2 sets this on
   * deletes alone; slice 3 adds completion, once checking a task moves it into
   * the done section.
   */
  toast: boolean
  /** Reapplies the previous values as an ordinary new mutation. */
  apply: () => Promise<unknown>
}

let step: UndoStep | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUndo(): UndoStep | null {
  return step
}

/**
 * Accepts null so call sites can stay one line: repo returns null when the row
 * had already gone, and that must not clear the step the user is reaching for.
 */
export function pushUndo(next: UndoStep | null): void {
  if (next === null) return
  step = next
  emit()
}

export async function undoLast(): Promise<boolean> {
  const pending = step
  if (pending === null) return false
  // Emptied before the await: two fast Ctrl+Z presses must not both find it.
  step = null
  emit()
  await pending.apply()
  return true
}

export function clearUndo(): void {
  if (step === null) return
  step = null
  emit()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/lib/undo.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npm run build && npm run lint
git add src/lib/undo.ts src/lib/undo.test.ts
git commit -m "feat: the single-step undo store"
```

---

### Task 2: Due-date helpers

**Files:**
- Create: `app/src/lib/dates.ts`
- Test: `app/src/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `todayLocal(at?: Date): string`; `isOverdue(dueOn: string | null, dueTime: string | null, at?: Date): boolean`; `formatDue(dueOn: string | null, dueTime: string | null, at?: Date): string | null`.

Every function takes `at` last, defaulting to `new Date()`, so the tests never
depend on the day they run.

- [ ] **Step 1: Write the failing test**

`app/src/lib/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { todayLocal, isOverdue, formatDue } from './dates'

// A Tuesday, mid-afternoon, in local time. Built from parts rather than parsed
// from a string, because `new Date('2026-08-18')` is UTC midnight — the day
// before, anywhere west of Greenwich.
const at = new Date(2026, 7, 18, 14, 30)

describe('todayLocal', () => {
  it('formats the local date, not the UTC one', () => {
    // 23:30 local on the 18th is the 19th in UTC east of Greenwich. The task
    // is still due today.
    expect(todayLocal(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18')
  })

  it('pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('isOverdue', () => {
  it('is false with no due date', () => {
    expect(isOverdue(null, null, at)).toBe(false)
  })

  it('is true for a date in the past', () => {
    expect(isOverdue('2026-08-17', null, at)).toBe(true)
  })

  it('is false for a date in the future', () => {
    expect(isOverdue('2026-08-19', null, at)).toBe(false)
  })

  it('is false for today with no time — the day is not over yet', () => {
    expect(isOverdue('2026-08-18', null, at)).toBe(false)
  })

  it('is true for today at a time already past', () => {
    expect(isOverdue('2026-08-18', '09:00', at)).toBe(true)
  })

  it('is false for today at a time still to come', () => {
    expect(isOverdue('2026-08-18', '17:00', at)).toBe(false)
  })

  it('ignores the time on a future date', () => {
    expect(isOverdue('2026-08-19', '09:00', at)).toBe(false)
  })
})

describe('formatDue', () => {
  it('is null with no due date', () => {
    expect(formatDue(null, null, at)).toBeNull()
  })

  it('names today and tomorrow rather than dating them', () => {
    expect(formatDue('2026-08-18', null, at)).toBe('Today')
    expect(formatDue('2026-08-19', null, at)).toBe('Tomorrow')
  })

  it('rolls over the month end', () => {
    const eve = new Date(2026, 7, 31, 9, 0)
    expect(formatDue('2026-09-01', null, eve)).toBe('Tomorrow')
  })

  it('gives weekday, day and month for anything else this year', () => {
    expect(formatDue('2026-08-21', null, at)).toBe('Fri 21 Aug')
  })

  it('adds the year when it is not this one', () => {
    expect(formatDue('2027-01-04', null, at)).toBe('Mon 4 Jan 2027')
  })

  it('appends a 12-hour time, dropping a zero minute', () => {
    expect(formatDue('2026-08-18', '17:00', at)).toBe('Today, 5pm')
    expect(formatDue('2026-08-18', '17:30', at)).toBe('Today, 5:30pm')
  })

  it('handles both ends of the clock', () => {
    expect(formatDue('2026-08-18', '00:15', at)).toBe('Today, 12:15am')
    expect(formatDue('2026-08-18', '12:00', at)).toBe('Today, 12pm')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/lib/dates.test.ts`
Expected: FAIL — "Failed to resolve import './dates'".

- [ ] **Step 3: Write the implementation**

`app/src/lib/dates.ts`:

```ts
/**
 * Due dates, formatted and compared.
 *
 * SPEC §4.1: "Due dates are a date plus an optional time, not a timestamp …
 * a task due Tuesday should stay due Tuesday when you fly somewhere, which a
 * `timestamptz` will not do." So everything here is string arithmetic on
 * `YYYY-MM-DD` and `HH:MM`, which sort correctly as strings, and the only Date
 * involved is the caller's "now".
 *
 * No `Intl`, no date library — SPEC §11.3 rule 2.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar date, which is not the UTC one after teatime. */
export function todayLocal(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * Built from parts on purpose: `new Date('2026-08-18')` parses as UTC midnight,
 * which is the previous day for anyone west of Greenwich.
 */
function parseDay(dueOn: string): Date {
  const [y, m, d] = dueOn.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isOverdue(
  dueOn: string | null,
  dueTime: string | null,
  at: Date = new Date(),
): boolean {
  if (dueOn === null) return false
  const today = todayLocal(at)
  if (dueOn !== today) return dueOn < today
  // Due today with no time is not overdue until the day is out — SPEC §4.1's
  // "due Tuesday with no particular time is the common case".
  if (dueTime === null) return false
  return dueTime < `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function formatTime(dueTime: string): string {
  const [h, m] = dueTime.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${pad(m)}${suffix}`
}

export function formatDue(
  dueOn: string | null,
  dueTime: string | null,
  at: Date = new Date(),
): string | null {
  if (dueOn === null) return null

  const today = todayLocal(at)
  // Month and year roll over on their own when the day overflows.
  const tomorrow = todayLocal(
    new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1),
  )

  let label: string
  if (dueOn === today) {
    label = 'Today'
  } else if (dueOn === tomorrow) {
    label = 'Tomorrow'
  } else {
    const day = parseDay(dueOn)
    label = `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`
    if (day.getFullYear() !== at.getFullYear()) label += ` ${day.getFullYear()}`
  }

  return dueTime === null ? label : `${label}, ${formatTime(dueTime)}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/lib/dates.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npm run build && npm run lint
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat: due-date formatting and the overdue predicate"
```

---

### Task 3: `repo.ts` captures the previous value

**Files:**
- Modify: `app/src/lib/repo.ts`
- Test: `app/src/lib/repo.test.ts`

**Interfaces:**
- Consumes: `UndoStep`, from Task 1.
- Produces: `addTask(title: string): Promise<{ id: string; undo: UndoStep }>`; `renameTask(id: string, title: string): Promise<UndoStep | null>`; `setTaskDone(id: string, done: boolean): Promise<UndoStep | null>`; `deleteTask(id: string): Promise<UndoStep | null>`. `listTasks()` is unchanged.

`addTask` returns an object rather than the bare id because both halves are
needed: the id by the tests, the step by `QuickAdd`. Its undo is a soft delete —
a tombstone like any other, not a row removal.

- [ ] **Step 1: Update the existing tests for the new `addTask` return**

In `app/src/lib/repo.test.ts`, every `const id = await addTask(...)` becomes
`const { id } = await addTask(...)`. There are six of them:

```bash
cd app && sed -i 's/const id = await addTask(/const { id } = await addTask(/' src/lib/repo.test.ts
grep -c 'const { id } = await addTask(' src/lib/repo.test.ts   # expect 6
```

- [ ] **Step 2: Add the failing undo tests**

Append inside the `describe('repo', ...)` block in `app/src/lib/repo.test.ts`,
before its closing `})`:

```ts
  it('hands back a step that restores exactly the columns it changed', async () => {
    const { id } = await addTask('buy milk')
    const before = (await db.tasks.get(id))!

    const undo = await renameTask(id, 'buy oat milk')
    expect((await db.tasks.get(id))!.title).toBe('buy oat milk')

    await undo!.apply()
    expect((await db.tasks.get(id))!.title).toBe('buy milk')
    // The restore is a new write, so it carries a new stamp rather than the
    // old one — SPEC §4.1 makes `updated_at` server-owned.
    expect(Date.parse((await db.tasks.get(id))!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before.updated_at),
    )
  })

  it('undoes a delete by clearing the tombstone', async () => {
    const { id } = await addTask('buy milk')
    const undo = await deleteTask(id)
    expect(await listTasks()).toHaveLength(0)

    await undo!.apply()
    expect(await listTasks()).toHaveLength(1)
  })

  it('undoes an add by tombstoning it', async () => {
    const { id, undo } = await addTask('buy milk')
    await undo.apply()

    expect(await listTasks()).toHaveLength(0)
    // A tombstone, not a removal: a device that already saw the row has to
    // learn it is gone (SPEC §9).
    expect(await db.tasks.get(id)).toBeDefined()
  })

  it('does not rewind the outbox — the undo is an ordinary new mutation', async () => {
    // SPEC §4.5: "it never rewinds the outbox — an undo that shipped after its
    // own edit already pushed would race the server."
    const { id } = await addTask('buy milk')
    await db.outbox.clear()

    const undo = await renameTask(id, 'buy oat milk')
    const [afterEdit] = await entriesFor(id)
    expect(afterEdit.columns).toEqual(['title', 'client_id'])

    await undo!.apply()
    const entries = await entriesFor(id)
    // Coalesced into the same entry, at the same seq, because the dirty column
    // set did not change (SPEC §9.1, §9.2). What matters is that it is still
    // there and still says the row is dirty.
    expect(entries).toHaveLength(1)
    expect(entries[0].seq).toBe(afterEdit.seq)
    expect(entries[0].columns).toEqual(['title', 'client_id'])
  })

  it('marks only the delete for a toast', async () => {
    const { id } = await addTask('buy milk')
    expect((await renameTask(id, 'renamed'))!.toast).toBe(false)
    expect((await setTaskDone(id, true))!.toast).toBe(false)
    expect((await deleteTask(id))!.toast).toBe(true)
  })

  it('returns null for a row that is not there', async () => {
    expect(await renameTask('01920000-0000-7000-8000-0000000000ff', 'ghost')).toBeNull()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/lib/repo.test.ts`
Expected: FAIL — `undo!.apply is not a function` and `Property 'toast' does not exist`, because the mutations still resolve to `void`.

- [ ] **Step 4: Rewrite the two primitives**

In `app/src/lib/repo.ts`, add the import and replace `create` and `write`:

```ts
import type { UndoStep } from './undo'
```

```ts
/** The previous values of just the columns an edit is about to change. */
function pick(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]))
}

async function create<T extends { id: string }>(
  table: TableName,
  row: T,
  label: string,
): Promise<UndoStep> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).add(row)
    await appendOutbox(table, row.id, Object.keys(row))
  })
  // Undoing a create is a soft delete, not a removal: SPEC §9 wants other
  // devices to learn the row is gone rather than never hear of it.
  return {
    label,
    toast: false,
    apply: () => write(table, row.id, { deleted_at: now() }, label),
  }
}

async function write(
  table: TableName,
  id: string,
  changes: Record<string, unknown>,
  label: string,
  toast = false,
): Promise<UndoStep | null> {
  // SPEC §9.4: this is the provisional local value; the server stamps the
  // real `updated_at` on push.
  const stamped = { ...changes, updated_at: now(), client_id: clientId() }

  // SPEC §4.5: the previous value is captured inside the transaction that
  // changes it. Captured outside, a write landing in between would be silently
  // reverted by the undo.
  const previous = await db.transaction(
    'rw',
    db.table(table),
    db.outbox,
    async () => {
      const row = await db.table(table).get(id)
      // A row that is not there cannot be dirty. Enqueueing anyway would push
      // a phantom id at the server.
      if (row === undefined) return null
      // The columns in `changes`, not in `stamped`: restoring a previous
      // `updated_at` would push a server-owned column backwards (SPEC §4.1),
      // and the restore deserves its own stamp anyway.
      const before = pick(row as Record<string, unknown>, Object.keys(changes))
      await db.table(table).update(id, stamped)
      await appendOutbox(table, id, Object.keys(stamped))
      return before
    },
  )

  if (previous === null) return null
  return { label, toast, apply: () => write(table, id, previous, label) }
}
```

- [ ] **Step 5: Point the four public mutations at them**

Replace the bodies in `app/src/lib/repo.ts`:

```ts
export async function addTask(
  title: string,
): Promise<{ id: string; undo: UndoStep }> {
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

  return { id, undo: await create('tasks', row, 'Task added') }
}

export function setTaskDone(id: string, done: boolean): Promise<UndoStep | null> {
  // SPEC §4: `completed_at` and `section_id` are always written together,
  // because checking a task moves it to the done section and dragging it
  // there checks it. The done section row now exists; nothing moves into it
  // until the sections UI does, so only the timestamp moves.
  return write(
    'tasks',
    id,
    { completed_at: done ? now() : null },
    done ? 'Task completed' : 'Task reopened',
  )
}

export function renameTask(id: string, title: string): Promise<UndoStep | null> {
  const trimmed = title.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('tasks', id, { title: trimmed }, 'Title changed')
}

/**
 * SPEC §9: deletions are soft. The row stays as a tombstone so that a device
 * offline for a week learns about the deletion instead of resurrecting it.
 *
 * The only mutation that takes its result off the screen, and so the only one
 * that raises a toast rather than relying on the keyboard.
 */
export function deleteTask(id: string): Promise<UndoStep | null> {
  return write('tasks', id, { deleted_at: now() }, 'Task deleted', true)
}
```

- [ ] **Step 6: Fix the one non-test caller**

`QuickAdd.tsx` ignores the return value today, so it still compiles. Confirm:

```bash
cd app && npm run build
```
Expected: clean. If TypeScript complains anywhere other than the tests, stop —
something else was reading `addTask`'s return.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/lib/repo.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 8: Commit**

```bash
cd app && npm test && npm run build && npm run lint
git add src/lib/repo.ts src/lib/repo.test.ts
git commit -m "feat: every mutation hands back the step that reverses it"
```

---

### Task 4: The new field setters

**Files:**
- Modify: `app/src/lib/repo.ts`
- Test: `app/src/lib/repo.test.ts`

**Interfaces:**
- Consumes: `write` and `UndoStep`, from Task 3.
- Produces: `getTask(id: string): Promise<Task | undefined>`; `setTaskNotes(id: string, notes: string): Promise<UndoStep | null>`; `setTaskDue(id: string, dueOn: string | null, dueTime: string | null): Promise<UndoStep | null>`; `setTaskPriority(id: string, priority: 0 | 1 | 2 | 3): Promise<UndoStep | null>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('repo', ...)` in `app/src/lib/repo.test.ts`:

```ts
  it('reads a single task, tombstones included', async () => {
    const { id } = await addTask('buy milk')
    expect((await getTask(id))!.title).toBe('buy milk')
    await deleteTask(id)
    // The sheet may still be open over a task that was just deleted; that is
    // the reader's problem, not this function's.
    expect(await getTask(id)).toBeDefined()
    expect(await getTask('01920000-0000-7000-8000-0000000000ff')).toBeUndefined()
  })

  it('stores notes, and stores emptiness as null rather than ""', async () => {
    const { id } = await addTask('buy milk')
    await setTaskNotes(id, '  the oat one  ')
    expect((await getTask(id))!.notes).toBe('the oat one')

    await setTaskNotes(id, '   ')
    // SPEC §4.1 types it `string | null`; two spellings of empty is one too
    // many for the server to reason about.
    expect((await getTask(id))!.notes).toBeNull()
  })

  it('writes due date and time together, and clears the time with the date', async () => {
    const { id } = await addTask('buy milk')
    await db.outbox.clear()

    await setTaskDue(id, '2026-08-21', '17:00')
    expect(await getTask(id)).toMatchObject({ due_on: '2026-08-21', due_time: '17:00' })
    expect((await entriesFor(id))[0].columns).toEqual(['due_on', 'due_time', 'client_id'])

    // A time with no date is not a due date, it is a fragment.
    await setTaskDue(id, null, '17:00')
    expect(await getTask(id)).toMatchObject({ due_on: null, due_time: null })
  })

  it('restores both due columns on undo', async () => {
    const { id } = await addTask('buy milk')
    await setTaskDue(id, '2026-08-21', '17:00')

    const undo = await setTaskDue(id, '2026-08-22', null)
    await undo!.apply()
    expect(await getTask(id)).toMatchObject({ due_on: '2026-08-21', due_time: '17:00' })
  })

  it('stores priority, including a real zero', async () => {
    const { id } = await addTask('buy milk')
    await setTaskPriority(id, 2)
    expect((await getTask(id))!.priority).toBe(2)

    // SPEC §4.1: "the default is a real zero rather than a magic sentinel."
    const undo = await setTaskPriority(id, 0)
    expect((await getTask(id))!.priority).toBe(0)
    await undo!.apply()
    expect((await getTask(id))!.priority).toBe(2)
  })
```

Extend the import at the top of the file:

```ts
import {
  addTask, setTaskDone, renameTask, deleteTask, listTasks,
  getTask, setTaskNotes, setTaskDue, setTaskPriority,
} from './repo'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/lib/repo.test.ts`
Expected: FAIL — `"getTask" is not exported by "src/lib/repo.ts"`.

- [ ] **Step 3: Write the implementation**

Append to `app/src/lib/repo.ts`:

```ts
/**
 * One row by id, tombstone or not. The sheet needs to render a task that a
 * background delete may already have tombstoned; filtering here would blank the
 * form under the user's cursor instead.
 */
export function getTask(id: string): Promise<Task | undefined> {
  return db.tasks.get(id)
}

export function setTaskNotes(id: string, notes: string): Promise<UndoStep | null> {
  const trimmed = notes.trim()
  // SPEC §4.1 types notes `string | null`. Storing "" as well as null would
  // give the server two spellings of empty to reconcile.
  return write('tasks', id, { notes: trimmed === '' ? null : trimmed }, 'Notes changed')
}

/**
 * SPEC §4.1: a date plus an optional time, never a timestamp. They are written
 * together because a time without a date is not a due date, and clearing the
 * date has to clear the time with it.
 */
export function setTaskDue(
  id: string,
  dueOn: string | null,
  dueTime: string | null,
): Promise<UndoStep | null> {
  return write(
    'tasks',
    id,
    { due_on: dueOn, due_time: dueOn === null ? null : dueTime },
    'Due date changed',
  )
}

/** SPEC §4.1: 0 = none … 3 = highest, and 0 is a real value. */
export function setTaskPriority(
  id: string,
  priority: 0 | 1 | 2 | 3,
): Promise<UndoStep | null> {
  return write('tasks', id, { priority }, 'Priority changed')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/lib/repo.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npm test && npm run build && npm run lint
git add src/lib/repo.ts src/lib/repo.test.ts
git commit -m "feat: notes, due date and priority setters"
```

---

### Task 5: The toast and the keyboard shortcut

**Files:**
- Create: `app/src/components/Toast.tsx`
- Modify: `app/src/App.tsx`, `app/src/components/TaskList.tsx`, `app/src/components/QuickAdd.tsx`

**Interfaces:**
- Consumes: `subscribe`, `getUndo`, `undoLast`, `pushUndo` from Task 1; the mutations from Task 3.
- Produces: `<UndoToast />`, taking no props.

After this task, undo works end to end for add, complete and delete — before
the sheet exists. That is deliberate: it is testable in a browser on its own.

- [ ] **Step 1: Write the component**

`app/src/components/Toast.tsx`:

```tsx
/**
 * The undo offer.
 *
 * SPEC §4.5 fixes the mechanics; this is the affordance. A toast appears only
 * when the action took its result off the screen — a delete. A title edit, a
 * due date, a priority and a completion all stay in view and are reversible
 * with the control that made them, and a toast on every one of those would
 * train the eye to ignore the one that matters.
 *
 * The Ctrl/Cmd+Z listener lives here rather than in `App` because this is the
 * one component that is always mounted and already subscribed to the store.
 *
 * Hand-rolled rather than a toast package — SPEC §11.3 rule 2.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribe, getUndo, undoLast, type UndoStep } from '../lib/undo'

const VISIBLE_MS = 6000

export function UndoToast() {
  const step = useSyncExternalStore(subscribe, getUndo, getUndo)
  // Which step the timer has already hidden. Hiding the toast must not clear
  // the store: the keyboard can still undo long after the toast has gone.
  const [expired, setExpired] = useState<UndoStep | null>(null)

  useEffect(() => {
    if (step === null || !step.toast) return
    const timer = setTimeout(() => setExpired(step), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [step])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'z' || event.shiftKey) return
      if (!event.metaKey && !event.ctrlKey) return
      const target = event.target as HTMLElement | null
      // Native text undo inside a field has to keep working, or editing the
      // notes becomes a trap.
      if (
        target !== null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return
      }
      if (getUndo() === null) return
      event.preventDefault()
      void undoLast()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visible = step !== null && step.toast && step !== expired
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl bg-neutral-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-ink">
        <span>{step.label}</span>
        <button
          type="button"
          onClick={() => void undoLast()}
          className="min-h-11 rounded-lg px-3 font-medium text-accent"
        >
          Undo
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Push the step from every call site**

In `app/src/components/QuickAdd.tsx`, add the import and change the write:

```tsx
import { pushUndo } from '../lib/undo'
```

```tsx
    setTitle('')
    const { undo } = await addTask(value)
    pushUndo(undo)
    input.current?.focus()
```

In `app/src/components/TaskList.tsx`, add the import:

```tsx
import { pushUndo } from '../lib/undo'
```

and change the two handlers:

```tsx
                onChange={(e) => void setTaskDone(task.id, e.target.checked).then(pushUndo)}
```

```tsx
              onClick={() => void deleteTask(task.id).then(pushUndo)}
```

- [ ] **Step 3: Mount it**

In `app/src/App.tsx`, add the import and render it as the last child of the
outer `div`, after `<QuickAdd />`:

```tsx
import { UndoToast } from './components/Toast'
```

```tsx
      <QuickAdd />
      <UndoToast />
```

- [ ] **Step 4: Verify it builds and the suite still passes**

Run: `cd app && npm test && npm run build && npm run lint`
Expected: PASS, 68 tests; build clean.

- [ ] **Step 5: Verify in a browser**

```bash
cd app && npm run dev
```

With Playwright: add a task, delete it, confirm the toast reads "Task deleted"
and that clicking Undo brings the row back. Then delete another and press
Ctrl+Z with focus on the body. Then focus the quick-add field, type, and press
Ctrl+Z — the text must undo, **not** the task.

- [ ] **Step 6: Commit**

```bash
git add src/components/Toast.tsx src/components/QuickAdd.tsx src/components/TaskList.tsx src/App.tsx
git commit -m "feat: the undo toast and Ctrl+Z"
```

---

### Task 6: The task sheet

**Files:**
- Create: `app/src/components/TaskSheet.tsx`
- Modify: `app/src/App.tsx`, `app/src/components/TaskList.tsx`

**Interfaces:**
- Consumes: `getTask`, `renameTask`, `setTaskNotes`, `setTaskDue`, `setTaskPriority`, `deleteTask` from Tasks 3–4; `pushUndo` from Task 1.
- Produces: `<TaskSheet taskId={string} onClose={() => void} />`. `TaskList` gains a required `onOpen: (id: string) => void` prop.

- [ ] **Step 1: Write the sheet**

`app/src/components/TaskSheet.tsx`:

```tsx
/**
 * The task editor, as a bottom sheet.
 *
 * Auto-saves: title and notes on blur and on a 500ms pause, due date and
 * priority the moment they are picked. "Done" only closes. SPEC §3 principle 1
 * — the UI never waits — and it is affordable because SPEC §9.1 coalesces the
 * outbox per row and dirty column set, so a debounced notes field is one entry
 * rather than thirty.
 *
 * It deliberately does not use `useLiveQuery`: a live value would fight the
 * cursor mid-word, and P0b has no second writer.
 */
import { useEffect, useRef, useState } from 'react'
import {
  getTask,
  renameTask,
  setTaskNotes,
  setTaskDue,
  setTaskPriority,
  deleteTask,
} from '../lib/repo'
import { pushUndo, type UndoStep } from '../lib/undo'

const PAUSE_MS = 500

const PRIORITIES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Urgent' },
]

interface Draft {
  title: string
  notes: string
  dueOn: string
  dueTime: string
  priority: 0 | 1 | 2 | 3
}

export function TaskSheet({
  taskId,
  onClose,
}: {
  taskId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let live = true
    void getTask(taskId).then((task) => {
      if (!live || task === undefined) return
      setDraft({
        title: task.title,
        notes: task.notes ?? '',
        dueOn: task.due_on ?? '',
        dueTime: task.due_time ?? '',
        priority: task.priority,
      })
    })
    return () => {
      live = false
    }
  }, [taskId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /**
   * The timer is deliberately not cleared on unmount: an edit typed a moment
   * before closing the sheet still has to land.
   */
  function commitLater(run: () => Promise<UndoStep | null>) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void run().then(pushUndo), PAUSE_MS)
  }

  function commitNow(run: () => Promise<UndoStep | null>) {
    clearTimeout(timer.current)
    void run().then(pushUndo)
  }

  function due(dueOn: string, dueTime: string) {
    setDraft((d) => (d === null ? d : { ...d, dueOn, dueTime }))
    commitNow(() => setTaskDue(taskId, dueOn || null, dueTime || null))
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div
        role="dialog"
        aria-label="Task"
        className="relative max-h-[85%] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 shadow-2xl dark:bg-ink sm:mx-auto sm:mb-8 sm:w-full sm:max-w-lg sm:rounded-2xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />

        {draft === null ? (
          <div className="min-h-64" />
        ) : (
          <>
            <input
              value={draft.title}
              autoFocus
              onChange={(e) => {
                const title = e.target.value
                setDraft({ ...draft, title })
                commitLater(() => renameTask(taskId, title))
              }}
              onBlur={() => commitNow(() => renameTask(taskId, draft.title))}
              aria-label="Title"
              className="min-h-11 w-full bg-transparent text-lg font-medium text-neutral-900 outline-none dark:text-neutral-100"
            />

            <label className="mt-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Notes
              <textarea
                value={draft.notes}
                rows={4}
                placeholder="Plain text — links become links"
                onChange={(e) => {
                  const notes = e.target.value
                  setDraft({ ...draft, notes })
                  commitLater(() => setTaskNotes(taskId, notes))
                }}
                onBlur={() => commitNow(() => setTaskNotes(taskId, draft.notes))}
                className="mt-1 w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-[15px] font-normal text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </label>

            <div className="mt-4 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Due
              </span>
              <input
                type="date"
                value={draft.dueOn}
                aria-label="Due date"
                onChange={(e) => due(e.target.value, draft.dueTime)}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
              <input
                type="time"
                value={draft.dueTime}
                aria-label="Due time"
                disabled={draft.dueOn === ''}
                onChange={(e) => due(draft.dueOn, e.target.value)}
                className="min-h-11 w-28 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Priority
              </span>
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={draft.priority === p.value}
                  onClick={() => {
                    setDraft({ ...draft, priority: p.value })
                    commitNow(() => setTaskPriority(taskId, p.value))
                  }}
                  className={
                    'min-h-11 flex-1 rounded-xl border text-sm ' +
                    (draft.priority === p.value
                      ? 'border-accent bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                      : 'border-black/10 text-neutral-500 dark:border-white/15 dark:text-neutral-400')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  void deleteTask(taskId).then(pushUndo)
                  onClose()
                }}
                className="min-h-11 rounded-xl px-3 text-sm text-red-600 dark:text-red-400"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-xl bg-accent px-5 font-medium text-ink"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Make the row open it**

In `app/src/components/TaskList.tsx`, take the new prop and split the row. The
checkbox keeps its own label; the title becomes the button that opens the sheet,
so tapping the text no longer toggles the checkbox:

```tsx
export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
```

Replace the `<label>…</label>` block with:

```tsx
            <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-2">
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => void setTaskDone(task.id, e.target.checked).then(pushUndo)}
                aria-label={`Complete ${task.title}`}
                className="size-5 shrink-0 accent-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => onOpen(task.id)}
              className="min-h-11 flex-1 text-left"
            >
              <span
                className={
                  done
                    ? 'text-neutral-400 line-through dark:text-neutral-600'
                    : 'text-neutral-900 dark:text-neutral-100'
                }
              >
                {task.title}
              </span>
            </button>
```

- [ ] **Step 3: Hold the open task in `App`**

`app/src/App.tsx` — add the import, the state, and the mount:

```tsx
import { useState } from 'react'
import { TaskSheet } from './components/TaskSheet'
```

```tsx
export default function App() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
```

```tsx
      <main className="flex-1 overflow-y-auto">
        <TaskList onOpen={setOpenTaskId} />
      </main>

      <QuickAdd />
      <UndoToast />
      {openTaskId !== null && (
        // Keyed by id so switching tasks remounts with a clean draft rather
        // than merging two tasks' edits.
        <TaskSheet
          key={openTaskId}
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
```

- [ ] **Step 4: Verify it builds and the suite still passes**

Run: `cd app && npm test && npm run build && npm run lint`
Expected: PASS, 68 tests; build clean.

- [ ] **Step 5: Verify in a browser**

With `npm run dev` and Playwright: add a task, tap its title, and check that the
sheet opens with the title focused. Type into notes, click Done, reopen — the
notes are there. Set a due date, then a time. Clear the date and confirm the
time clears with it and its input disables. Pick a priority, close, reopen.
Press Escape to close. Click the scrim to close. Delete from the sheet and
confirm the sheet closes and the toast appears.

Then resize to a phone width and judge one thing that only a narrow screen can
settle: whether `autoFocus` on the title is right. It makes editing immediate,
but on Android it throws the keyboard up over half the sheet when the gesture
was "open this task to look at it". If it reads wrong, drop the attribute — the
field is one tap away either way.

- [ ] **Step 6: Commit**

```bash
git add src/components/TaskSheet.tsx src/components/TaskList.tsx src/App.tsx
git commit -m "feat: the task sheet — notes, due date, priority"
```

---

### Task 7: The due chip

**Files:**
- Modify: `app/src/components/TaskList.tsx`

**Interfaces:**
- Consumes: `formatDue`, `isOverdue` from Task 2.

Without this, a due date can be set and then never seen again until slice 4
ships Today and Upcoming — which looks less like a missing view than like a
field that did nothing.

- [ ] **Step 1: Render it**

In `app/src/components/TaskList.tsx`, add the import:

```tsx
import { formatDue, isOverdue } from '../lib/dates'
```

Inside the `tasks.map` callback, next to `const done = …`:

```tsx
        const due = formatDue(task.due_on, task.due_time)
        // A completed task is not overdue, however late it was.
        const overdue = !done && isOverdue(task.due_on, task.due_time)
```

and inside the title button, after the `<span>` holding the title:

```tsx
              {due !== null && (
                <span
                  className={
                    'ml-2 whitespace-nowrap text-xs ' +
                    (overdue
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-neutral-400 dark:text-neutral-500')
                  }
                >
                  {due}
                </span>
              )}
```

- [ ] **Step 2: Verify it builds and the suite still passes**

Run: `cd app && npm test && npm run build && npm run lint`
Expected: PASS, 68 tests; build clean.

- [ ] **Step 3: Verify in a browser**

Set a task due yesterday and confirm the chip is red; due tomorrow and confirm
it is grey and reads "Tomorrow"; then check the overdue one off and confirm the
chip goes grey.

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskList.tsx
git commit -m "feat: the due chip, red when overdue"
```

---

### Task 8: Documentation and the whole-slice check

**Files:**
- Modify: `app/README.md`

- [ ] **Step 1: Update the README**

Change the status line to "P0b slice 2 — task CRUD and undo", and add to the
layout map:

```
src/lib/undo.ts          the single-step undo store (SPEC §4.5)
src/lib/dates.ts         due-date formatting and the overdue predicate
src/components/TaskSheet.tsx  the task editor, auto-saving
src/components/Toast.tsx      the undo offer and Ctrl+Z
```

Add, next to the existing note about the write seam:

> Every mutation in `repo.ts` returns the `UndoStep` that reverses it, and the
> component that called it pushes that step. Undo is an ordinary new mutation —
> it never rewinds the outbox (SPEC §4.5).

- [ ] **Step 2: Run the whole suite and the build**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 68 tests; build clean; lint clean.

- [ ] **Step 3: Walk the slice in a browser once, start to finish**

Add three tasks. Edit one through the sheet — title, notes, due date with a
time, priority. Complete one. Delete one and undo it from the toast. Delete
another and undo it with Ctrl+Z. Reload the page and confirm every change
survived. Then check the outbox in the console:

```js
await (await import('/src/lib/db.ts')).db.outbox.toArray()
```

Expect one entry per touched row, seq order matching creation order, and no
`updated_at` in any `columns` array.

- [ ] **Step 4: Commit and open the PR**

```bash
git add README.md
git commit -m "docs: undo and the task sheet, in the README layout map"
git push -u origin p0b-2-task-crud-undo
gh pr create --title "P0b slice 2 — task CRUD and undo" --body "$(cat <<'EOF'
Slice 2 of P0b: the first slice the user can see.

- Every mutation in `repo.ts` returns the `UndoStep` that reverses it, with the
  previous values captured inside the transaction that changes them (SPEC §4.5).
- A bottom-sheet editor for title, notes, `due_on`/`due_time` and priority,
  auto-saving on blur and on a 500ms pause.
- A due chip on the list row, red when overdue.
- An undo toast on delete, and Ctrl/Cmd+Z for everything else.

No new dependencies. Undo never rewinds the outbox — there is a test for it.

Design: `docs/superpowers/specs/2026-08-18-p0b-task-crud-undo-design.md`
Plan: `docs/superpowers/plans/2026-08-18-p0b-task-crud-undo.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **Do not add a dependency.** Not a toast library, not a date library, not
  jsdom or `@testing-library/react`. If a step seems to need one, stop and ask.
- **Do not move `section_id` in `setTaskDone`.** The done-section move is slice
  3, once there is a section UI to restore a task to.
- **Do not touch `reminder_at`.** It needs the workspace timezone and a reminder
  pipeline; both are P1.
- **`npm test` is not enough.** Slice 1 shipped a TypeScript error past a green
  test run. Every commit step runs `npm run build` too.
- **If a test needs Dexie imported outside `db.ts`, stop.** SPEC §11.3 rule 1.
- The test counts in this plan (68 from Task 5 onward) assume the 33 already
  passing plus 8 in Task 1, 16 in Task 2, 6 in Task 3 and 5 in Task 4 — recount
  rather than trusting the figure if it disagrees.
