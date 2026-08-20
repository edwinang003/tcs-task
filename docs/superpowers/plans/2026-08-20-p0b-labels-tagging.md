# P0b slice 8a — labels, tagging: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can carry labels — two new tables, the write path, a picker in
the sheet, and coloured dots on every task row.

**Architecture:** `task_labels` is the app's first many-to-many, and its row id
is **computed from the pair it points at** rather than generated, so two
devices tagging the same task offline produce the same row instead of a
duplicate. Everything else follows the shape the codebase already has: a pure
module (`labelling.ts`) holds the logic, a `use*` file holds the `useLiveQuery`,
and `repo/labels.ts` is the only thing that writes.

**Tech Stack:** React 19.2.8 · Vite 8.2.1 · TypeScript 6.0.3 · Tailwind 4.3.3 ·
Dexie 4.4.5 · dexie-react-hooks 4.4.0 · Vitest 4.1.10 (`environment: 'node'`) ·
fake-indexeddb 6.2.5 · oxlint 1.78.0

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-labels-design.md`

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
- **SPEC §15** — every row is created with its full sync column set (§4.1):
  `id`, `workspace_id`, `updated_at`, `deleted_at`, `client_id`.
- **SPEC §9** — deletions are soft. A tombstone stays in the table and is
  filtered by the *reader*, never by the query that will sync it.
- **SPEC §4.5** — undo is local, session-scoped, single-level, and reapplied as
  an ordinary new mutation. Every mutation returns the `UndoStep` that reverses
  it; the component that called it pushes that step.
- Tailwind classes must be spelled out literally in source. A class name
  assembled at runtime from stored data is purged from the build and renders
  unstyled — see the design, decision 3.
- Line width in docs and comments is 79 characters.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `app/src/lib/labelling.ts` | Pure: the palette, colour assignment, the task → labels map, the dot classes. |
| `app/src/lib/labelling.test.ts` | Its unit tests. |
| `app/src/lib/repo/labels.ts` | The only write path for `labels` and `task_labels`, plus their reads. |
| `app/src/lib/repo/labels.test.ts` | Its unit tests, including the outbox entries. |
| `app/src/lib/useLabels.ts` | The React seam: two live queries, memoized into a map. |
| `app/src/components/LabelDots.tsx` | The row's dots. Presentational. |
| `app/src/components/LabelPicker.tsx` | The sheet's Labels row: chips, filter, create-on-the-fly. |

**Modified:**

| File | Change |
| --- | --- |
| `app/src/lib/schema.ts` | `Label` and `TaskLabel` interfaces; two more `PUSHABLE_TABLES`. |
| `app/src/lib/db.ts` | Version 5's two stores; `LaneDb` gains two tables; `ceiling` widens. |
| `app/src/lib/db.test.ts` | Version 4 → 5, five tables → seven. |
| `app/src/lib/migration.test.ts` | A v4 → v5 case. |
| `app/src/lib/repo/index.ts` | Re-export `./labels`. |
| `app/src/lib/repo/tasks.ts` | `deleteTask` cascades to `task_labels`. |
| `app/src/lib/repo/tasks.test.ts` | The cascade, and its undo. |
| `app/src/components/TaskRow.tsx` | One optional `labels` prop. |
| `app/src/components/TaskList.tsx` | Feed it from `useLabels`. |
| `app/src/components/AgendaList.tsx` | Feed it from `useLabels`. |
| `app/src/components/TaskSheet.tsx` | Render `<LabelPicker>`. |
| `app/README.md` | Status paragraph, Layout block, test list. |

---

### Task 1: The tables, the row shapes, and database version 5

**Files:**
- Modify: `app/src/lib/schema.ts`
- Modify: `app/src/lib/db.ts`
- Modify: `app/src/lib/db.test.ts`
- Modify: `app/src/lib/migration.test.ts`

**Interfaces:**
- Produces: `Label` and `TaskLabel` from `../schema`; `db.labels` and
  `db.task_labels` on `LaneDb`; `'labels'` and `'task_labels'` as members of
  `TableName`.

- [ ] **Step 1: Update the failing schema test**

In `app/src/lib/db.test.ts`, replace the version-4 test with:

```ts
  it('is at version 5, with the seven tables', async () => {
    // Version 5 is a pure `stores` bump, like version 4: tables that have
    // never existed have no rows to backfill. `labels` carries a name index
    // because the drawer reads in that order and the picker checks it for a
    // duplicate before creating one.
    const db = createDb('lane-schema-test')
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(5)
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'checklist_items',
      'labels',
      'outbox',
      'projects',
      'sections',
      'task_labels',
      'tasks',
    ])
  })
```

Keep the surrounding `describe('schema')` block as it is: `dbs.push(db)` and
the existing `afterEach` are what close the handle, so the replacement must not
add its own `close()` or `delete()`.

- [ ] **Step 2: Write the failing migration test**

Append to `app/src/lib/migration.test.ts`:

```ts
describe('v4 → v5 migration', () => {
  it('adds the two label tables without disturbing what is there', async () => {
    const name = 'lane-migration-v5'

    // A database as slice 7 left it: version 4, with a task in it.
    const v4 = createDb(name, 4)
    await v4.open()
    await v4.tasks.add({
      id: 'task-kept',
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: sectionId,
      title: 'survive the migration',
      notes: null,
      due_on: null,
      due_time: null,
      reminder_at: null,
      reminder_sent_at: null,
      priority: 0,
      completed_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      position: 'a0',
      created_by: null,
      assignee_id: null,
      updated_at: '2026-08-01T00:00:00.000Z',
      deleted_at: null,
      client_id: 'slice-7-device',
    })
    v4.close()

    const db = createDb(name)
    await db.open()

    expect(db.verno).toBe(5)
    // The point of the case: a version bump that adds tables must not touch
    // the rows already there.
    expect(await db.tasks.get('task-kept')).toMatchObject({
      title: 'survive the migration',
      client_id: 'slice-7-device',
    })
    expect(await db.labels.count()).toBe(0)
    expect(await db.task_labels.count()).toBe(0)

    db.close()
    await db.delete()
  })
})
```

`doneSectionId` is already destructured at the top of this file; this test does
not need it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/db.test.ts src/lib/migration.test.ts`
Expected: FAIL — `db.verno` is 4, and `db.labels` is undefined.

- [ ] **Step 4: Add the row shapes to `schema.ts`**

In `app/src/lib/schema.ts`, after the `ChecklistItem` interface:

```ts
/** SPEC §4.1 — `labels`. Cross-project tags; §4 says a task is in exactly
 * one project, so labels carry everything that cuts across. */
export interface Label extends SyncColumns {
  name: string
  /**
   * A palette key from `labelling.ts` — `'rose'`, not `'#e11d48'`.
   *
   * Two reasons, and the second binds. Every colour here is a *pair*: the dot
   * that reads on white is not the one that reads on near-black, so the
   * palette resolves to a class per theme rather than to a value. And
   * Tailwind's compiler only emits classes it can see in the source, so a
   * class name assembled at runtime from a stored hex is purged from the
   * build and renders unstyled.
   */
  color: string
}

/**
 * SPEC §4.1 — `task_labels`. The app's first many-to-many.
 *
 * §4.1 lists no `id` column, but the outbox keys every entry by `row_id` and
 * §9.2 upserts by row id, so the join row needs an identity. It is
 * **computed** — `` `${task_id}.${label_id}` `` — not generated.
 *
 * A join row is the one row shape where two devices offline can independently
 * invent the same fact. With a generated id that is two live rows asserting
 * one thing and a dedupe on every read; with a computed one both devices
 * produce the same row id and the push collapses them. `db.ts` already relies
 * on exactly this for the seeded workspace.
 */
export interface TaskLabel extends SyncColumns {
  task_id: string
  label_id: string
}
```

- [ ] **Step 5: Add the tables to the push whitelist**

In `app/src/lib/schema.ts`, extend `PUSHABLE_TABLES`:

```ts
export const PUSHABLE_TABLES = [
  'projects',
  'sections',
  'tasks',
  'checklist_items',
  'labels',
  'task_labels',
] as const
```

Then update the comment above it — the list is no longer a prefix of §9.2's
chain. Replace the sentence "Listed in SPEC §9.2's push order — `workspaces →
projects → sections → tasks → checklist_items → labels → task_labels` — minus
the tables that do not exist yet." with:

```
 * Listed in SPEC §9.2's push order — `workspaces → projects → sections →
 * tasks → checklist_items → labels → task_labels` — minus `workspaces`, which
 * is not a client-writable table. With `task_labels` this list is complete:
 * every table §9.2 names now exists.
```

- [ ] **Step 6: Add the tables to `db.ts`**

Three edits in `app/src/lib/db.ts`.

a) Extend the type import:

```ts
import type {
  Task,
  Project,
  Section,
  ChecklistItem,
  Label,
  TaskLabel,
  OutboxEntry,
} from './schema'
```

b) Extend `LaneDb`:

```ts
export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  checklist_items: EntityTable<ChecklistItem, 'id'>
  labels: EntityTable<Label, 'id'>
  task_labels: EntityTable<TaskLabel, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}
```

c) Widen `ceiling` and add version 5, after the `ceiling >= 4` block:

```ts
export function createDb(
  name: string = DB_NAME,
  ceiling: 1 | 2 | 3 | 4 | 5 = 5,
): LaneDb {
```

```ts
  if (ceiling >= 5) {
    // Version 4's shape again: `stores` with no `upgrade`, because tables that
    // have never existed have no rows to backfill.
    //
    // `task_labels` gets one access-path index beside the sync pair, not two.
    // The label route wants "every task carrying label X", which reads like it
    // wants `[workspace_id+label_id]` — but the row dots need every join row in
    // the workspace already, so that filter runs over data the app is holding
    // regardless. A second index would be a second read path to keep correct
    // for no gain.
    //
    // `[workspace_id+name]` on `labels` is the drawer's read order and the
    // picker's duplicate check — the one that stops create-on-the-fly from
    // producing two labels called `errand`.
    db.version(5).stores({
      labels: 'id, [workspace_id+name], [workspace_id+updated_at], deleted_at',
      task_labels:
        'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
    })
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/db.test.ts src/lib/migration.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green. Check the exit codes directly rather than through a pipe —
`$?` after `| tail` is `tail`'s status, not the command's.

- [ ] **Step 9: Commit**

```bash
git add src/lib/schema.ts src/lib/db.ts src/lib/db.test.ts src/lib/migration.test.ts
git commit -m "feat: labels and task_labels, at database version 5

task_labels is the app's first many-to-many. SPEC §4.1 lists no id
column for it, but the outbox keys entries by row_id, so the join row
needs one — and it is computed from the pair rather than generated, so
two devices tagging the same task offline converge on one row instead
of two. The type carries the reasoning.

With task_labels the push whitelist finally matches §9.2's chain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `labelling.ts` — the palette and the map, pure

**Files:**
- Create: `app/src/lib/labelling.ts`
- Create: `app/src/lib/labelling.test.ts`

**Interfaces:**
- Consumes: `Label`, `TaskLabel` from `./schema` (Task 1).
- Produces: `PALETTE`, `nextColor(existing: Label[]): string`,
  `dotClasses(color: string): string`,
  `labelsByTask(links: TaskLabel[], labels: Label[]): Map<string, Label[]>`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/labelling.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PALETTE, nextColor, dotClasses, labelsByTask } from './labelling'
import type { Label, TaskLabel } from './schema'

function label(id: string, name: string, color: string): Label {
  return {
    id,
    name,
    color,
    workspace_id: 'w',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function link(taskId: string, labelId: string, deleted: string | null = null): TaskLabel {
  return {
    id: `${taskId}.${labelId}`,
    task_id: taskId,
    label_id: labelId,
    workspace_id: 'w',
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: deleted,
    client_id: 'test',
  }
}

describe('nextColor', () => {
  it('takes the first palette colour when nothing exists yet', () => {
    expect(nextColor([])).toBe(PALETTE[0])
  })

  it('spreads across the palette before repeating any colour', () => {
    const existing = PALETTE.slice(0, 3).map((c, i) => label(`l${i}`, `n${i}`, c))
    expect(nextColor(existing)).toBe(PALETTE[3])
  })

  it('wraps to the least-used colour once the palette is full', () => {
    // Every colour used once, then one used twice. The next label must not
    // take the doubled one.
    const existing = PALETTE.map((c, i) => label(`l${i}`, `n${i}`, c))
    existing.push(label('extra', 'extra', PALETTE[0]))
    expect(nextColor(existing)).toBe(PALETTE[1])
  })

  it('breaks ties by palette order, so it is deterministic', () => {
    const existing = [label('l0', 'n0', PALETTE[0])]
    // Every other colour is unused; the tie goes to the earliest.
    expect(nextColor(existing)).toBe(PALETTE[1])
  })

  it('ignores a colour that is not in the palette', () => {
    const existing = [label('l0', 'n0', 'chartreuse')]
    expect(nextColor(existing)).toBe(PALETTE[0])
  })
})

describe('dotClasses', () => {
  it('maps every palette key to a literal class pair', () => {
    for (const key of PALETTE) {
      const classes = dotClasses(key)
      expect(classes).toContain(`bg-${key}-500`)
      expect(classes).toContain(`dark:bg-${key}-400`)
    }
  })

  it('falls back to neutral for an unknown key', () => {
    // A row from a future build, or a hand-edited database. A label that
    // renders plainly is a much better failure than a list that will not
    // render at all.
    expect(dotClasses('chartreuse')).toBe(dotClasses('__missing__'))
    expect(dotClasses('chartreuse')).toContain('bg-neutral-400')
  })
})

describe('labelsByTask', () => {
  it('groups labels under the tasks that carry them', () => {
    const labels = [label('a', 'errand', PALETTE[0]), label('b', 'waiting', PALETTE[1])]
    const links = [link('t1', 'a'), link('t1', 'b'), link('t2', 'b')]

    const map = labelsByTask(links, labels)

    expect(map.get('t1')?.map((l) => l.name)).toEqual(['errand', 'waiting'])
    expect(map.get('t2')?.map((l) => l.name)).toEqual(['waiting'])
  })

  it('leaves an untagged task out of the map rather than present and empty', () => {
    // The same rule `progressByTask` follows: absent means `TaskRow` renders
    // nothing from an undefined prop, with no length check at every caller.
    const map = labelsByTask([], [label('a', 'errand', PALETTE[0])])
    expect(map.has('t1')).toBe(false)
  })

  it('ignores a tombstoned link', () => {
    // SPEC §9: deletions are soft, so a tombstone is still a row. Handed rows
    // directly, this function is honest about them on its own.
    const labels = [label('a', 'errand', PALETTE[0])]
    const map = labelsByTask([link('t1', 'a', '2026-08-20T00:00:00.000Z')], labels)
    expect(map.has('t1')).toBe(false)
  })

  it('ignores a link whose label is gone', () => {
    // A label deleted on another device. The link survives as a tombstone
    // candidate for P1, but it must not draw a blank dot.
    const map = labelsByTask([link('t1', 'missing')], [])
    expect(map.has('t1')).toBe(false)
  })

  it('orders a task\'s labels by palette, not by name or link order', () => {
    // So the dots on a row do not reshuffle when an unrelated label is
    // renamed or a link is rewritten.
    //
    // The names run opposite to the palette on purpose: 'alpha' sorts first
    // alphabetically but carries the later colour, so a name-based sort — the
    // obvious wrong implementation — fails this case instead of passing it by
    // accident.
    const labels = [label('a', 'alpha', PALETTE[2]), label('b', 'zulu', PALETTE[0])]
    const map = labelsByTask([link('t1', 'a'), link('t1', 'b')], labels)
    expect(map.get('t1')?.map((l) => l.name)).toEqual(['zulu', 'alpha'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/labelling.test.ts`
Expected: FAIL — cannot resolve `./labelling`.

- [ ] **Step 3: Write `labelling.ts`**

Create `app/src/lib/labelling.ts`:

```ts
/**
 * Labels: the palette, and which ones a task carries.
 *
 * Pure and DOM-free, like `progress.ts` and `agenda.ts`, so all of it is
 * tested by calling it. `useLabels.ts` is the seam that feeds it rows.
 *
 * Named `labelling.ts` rather than `labels.ts` on purpose: `repo/labels.ts` is
 * the write path, and two files named `labels` doing opposite things is a
 * coin-flip every time someone opens one. The same reason `progress.ts` is not
 * called `checklist.ts`.
 */
import type { Label, TaskLabel } from './schema'

/**
 * The whole colour vocabulary. Eight is enough to tell labels apart at the
 * size of a dot and few enough that a person can hold them; more would make
 * two of them indistinguishable on a phone row, which is the only place the
 * colour has to do any work.
 */
export const PALETTE = [
  'rose',
  'amber',
  'lime',
  'teal',
  'sky',
  'indigo',
  'violet',
  'slate',
] as const

const ORDER = new Map<string, number>(PALETTE.map((key, i) => [key, i]))

/**
 * Every class the palette can produce, spelled out.
 *
 * Tailwind's compiler scans source text for class names, so `` `bg-${key}-500` ``
 * would be purged from the build and render as an invisible dot. This lookup
 * exists so every class is literally present in a file the compiler reads.
 *
 * Each colour is a pair: the 500 that reads on white is too dark on
 * near-black, so the dark variant steps up to 400.
 */
const DOTS: Record<string, string> = {
  rose: 'bg-rose-500 dark:bg-rose-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  lime: 'bg-lime-500 dark:bg-lime-400',
  teal: 'bg-teal-500 dark:bg-teal-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
  indigo: 'bg-indigo-500 dark:bg-indigo-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  slate: 'bg-slate-500 dark:bg-slate-400',
}

const FALLBACK = 'bg-neutral-400 dark:bg-neutral-500'

/**
 * The classes for a stored key. An unknown one — a row from a future build, or
 * a hand-edited database — renders neutral rather than throwing: a label that
 * looks plain is a much better failure than a list that will not render.
 */
export function dotClasses(color: string): string {
  return DOTS[color] ?? FALLBACK
}

/**
 * The colour a new label takes.
 *
 * Assigned rather than chosen, because the fast path is typing a name into the
 * sheet and carrying on — a colour decision in the middle of that is one
 * nobody wants to make about a label they are inventing in passing.
 *
 * The least-used colour, ties broken by palette order. Pure, so it is tested
 * by calling it, and it spreads across the palette instead of repeating one
 * colour until it wraps.
 */
export function nextColor(existing: Label[]): string {
  const used = new Map<string, number>(PALETTE.map((key) => [key, 0]))
  for (const label of existing) {
    const count = used.get(label.color)
    // A colour outside the palette votes for nothing. It cannot be "used up",
    // and counting it would skew assignment away from a real colour.
    if (count !== undefined) used.set(label.color, count + 1)
  }

  let best = PALETTE[0]
  for (const key of PALETTE) {
    if ((used.get(key) ?? 0) < (used.get(best) ?? 0)) best = key
  }
  return best
}

/**
 * Which labels each task carries.
 *
 * A task with no labels is absent from the map rather than present as an empty
 * array — which is what lets `TaskRow` render nothing from an undefined prop,
 * with no length check spread across its callers. `progressByTask` does the
 * same thing for the same reason.
 */
export function labelsByTask(
  links: TaskLabel[],
  labels: Label[],
): Map<string, Label[]> {
  const byId = new Map(labels.map((label) => [label.id, label]))
  const grouped = new Map<string, Label[]>()

  for (const link of links) {
    // SPEC §9: deletions are soft, so a tombstone is still a row. The reader
    // filters them too; doing it here as well means a caller that reaches past
    // the reader cannot draw a dot for a label someone removed.
    if (link.deleted_at !== null) continue
    const label = byId.get(link.label_id)
    // A link whose label was deleted on another device. §4.4 says sync must
    // never silently discard a row because its parent moved — the link stays
    // in the table for P1, it simply draws nothing.
    if (label === undefined) continue
    const current = grouped.get(link.task_id)
    if (current === undefined) grouped.set(link.task_id, [label])
    else current.push(label)
  }

  // Sorted by palette so a row's dots keep their order when an unrelated
  // label is renamed, or when a link is rewritten and comes back in a
  // different position.
  for (const labels of grouped.values()) {
    labels.sort(
      (a, b) => (ORDER.get(a.color) ?? PALETTE.length) - (ORDER.get(b.color) ?? PALETTE.length),
    )
  }
  return grouped
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/labelling.test.ts`
Expected: PASS.

Note the ordering test uses two labels whose *names* sort opposite to their
palette positions, so sorting by name — the obvious wrong implementation —
fails it rather than passing by accident.

- [ ] **Step 5: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/labelling.ts src/lib/labelling.test.ts
git commit -m "feat: the label palette, and which labels a task carries

Colour is assigned rather than chosen — the least-used palette key,
ties broken by palette order — so creating a label stays one tap and
the assignment is a pure function a test can call.

The classes are a literal lookup because Tailwind only emits classes it
can see in the source: a name built at runtime from a stored key would
be purged and render an invisible dot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `repo/labels.ts` — the write path

**Files:**
- Create: `app/src/lib/repo/labels.ts`
- Create: `app/src/lib/repo/labels.test.ts`
- Modify: `app/src/lib/repo/index.ts`

**Interfaces:**
- Consumes: `create`, `write`, `batch`, `composite`, `now` from `./write`;
  `nextColor` from `../labelling` (Task 2); `Label`, `TaskLabel` from
  `../schema` (Task 1).
- Produces, all from `../lib/repo`:
  - `taskLabelId(taskId: string, labelId: string): string`
  - `listLabels(): Promise<Label[]>`
  - `listAllTaskLabels(): Promise<TaskLabel[]>`
  - `listTaskLabels(taskId: string): Promise<TaskLabel[]>`
  - `createLabel(name: string): Promise<{ id: string; undo: UndoStep } | null>`
  - `renameLabel(id: string, name: string): Promise<UndoStep | null>`
  - `setLabelColor(id: string, color: string): Promise<UndoStep | null>`
  - `deleteLabel(id: string): Promise<UndoStep | null>`
  - `tagTask(taskId: string, labelId: string): Promise<UndoStep | null>`
  - `untagTask(taskId: string, labelId: string): Promise<UndoStep | null>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/repo/labels.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  addTask,
  createLabel,
  renameLabel,
  setLabelColor,
  deleteLabel,
  tagTask,
  untagTask,
  taskLabelId,
  listLabels,
  listTaskLabels,
  listAllTaskLabels,
} from './index'
import { activeWorkspace } from '../workspace'
import { PALETTE } from '../labelling'

const inbox = activeWorkspace().projectId

async function entriesFor(table: string, rowId: string) {
  return db.outbox.where('[table+row_id]').equals([table, rowId]).toArray()
}

describe('labels', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // Opening seeds the Inbox project and its sections, each with an entry.
    await db.outbox.clear()
  })

  it('creates a label with its full sync column set and a palette colour', async () => {
    // SPEC §15: every row is created with its full sync column set, so that
    // P1 implements a transport rather than a migration.
    const created = await createLabel('errand')
    expect(created).not.toBeNull()

    expect(await db.labels.get(created!.id)).toMatchObject({
      name: 'errand',
      color: PALETTE[0],
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })
  })

  it('enqueues the label without server-owned columns', async () => {
    const created = await createLabel('errand')
    const [entry] = await entriesFor('labels', created!.id)

    expect(entry.table).toBe('labels')
    expect(entry.columns).toContain('name')
    expect(entry.columns).toContain('color')
    // SPEC §4.1: server-owned columns are never pushed.
    expect(entry.columns).not.toContain('updated_at')
  })

  it('spreads colours across labels as they are created', async () => {
    await createLabel('one')
    await createLabel('two')
    const third = await createLabel('three')

    expect((await db.labels.get(third!.id))?.color).toBe(PALETTE[2])
  })

  it('refuses a label with no name', async () => {
    // Null rather than a throw: the picker's field is allowed to be empty,
    // and an empty submit is a normal intermediate state.
    expect(await createLabel('   ')).toBeNull()
    expect(await listLabels()).toHaveLength(0)
  })

  it('lists labels by name', async () => {
    await createLabel('zulu')
    await createLabel('alpha')

    expect((await listLabels()).map((l) => l.name)).toEqual(['alpha', 'zulu'])
  })

  it('renames and recolours a label, each undoably', async () => {
    const { id } = (await createLabel('erand'))!

    const renameUndo = await renameLabel(id, 'errand')
    expect((await db.labels.get(id))?.name).toBe('errand')
    await renameUndo!.apply()
    expect((await db.labels.get(id))?.name).toBe('erand')

    const colorUndo = await setLabelColor(id, 'violet')
    expect((await db.labels.get(id))?.color).toBe('violet')
    await colorUndo!.apply()
    expect((await db.labels.get(id))?.color).toBe(PALETTE[0])
  })

  it('derives a join row id from the pair, so two devices agree', async () => {
    // The decision this slice rests on. Two devices tagging the same task
    // with the same label offline must produce the SAME row id, so the push
    // upserts one onto the other instead of leaving a duplicate.
    expect(taskLabelId('task-1', 'label-1')).toBe('task-1.label-1')
  })

  it('tags a task with its full sync column set, under task_labels', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)

    const id = taskLabelId(taskId, labelId)
    expect(await db.task_labels.get(id)).toMatchObject({
      task_id: taskId,
      label_id: labelId,
      workspace_id: activeWorkspace().workspaceId,
      deleted_at: null,
    })

    const [entry] = await entriesFor('task_labels', id)
    expect(entry.table).toBe('task_labels')
    expect(entry.columns).toContain('label_id')
    expect(entry.columns).not.toContain('updated_at')
  })

  it('tags idempotently: tagging twice leaves one live row', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)
    // Null: nothing changed, so there is nothing to undo — and returning a
    // step here would evict the one the user is reaching for.
    expect(await tagTask(taskId, labelId)).toBeNull()

    expect(await db.task_labels.count()).toBe(1)
    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('untags by tombstoning, and re-tagging revives the same row', async () => {
    // The direct consequence of the derived id: untag and re-tag address one
    // row, so tagTask is an upsert with three real cases — absent, live, and
    // a tombstone to revive.
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    const id = taskLabelId(taskId, labelId)

    await tagTask(taskId, labelId)
    await untagTask(taskId, labelId)

    expect((await db.task_labels.get(id))?.deleted_at).not.toBeNull()
    expect(await listTaskLabels(taskId)).toHaveLength(0)

    await tagTask(taskId, labelId)

    expect((await db.task_labels.get(id))?.deleted_at).toBeNull()
    expect(await db.task_labels.count()).toBe(1)
  })

  it('undoes an untag by putting the label back', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!

    await tagTask(taskId, labelId)
    const undo = await untagTask(taskId, labelId)
    await undo!.apply()

    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('deleting a label tombstones its links and leaves the tasks alone', async () => {
    // SPEC §4.4: "Delete a label → task_labels rows tombstone; tasks are
    // untouched."
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    await deleteLabel(labelId)

    expect((await db.labels.get(labelId))?.deleted_at).not.toBeNull()
    expect(await listAllTaskLabels()).toHaveLength(0)
    expect((await db.tasks.get(taskId))?.deleted_at).toBeNull()
  })

  it('undoing a label delete restores it and its links', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    const undo = await deleteLabel(labelId)
    await undo!.apply()

    expect(await listLabels()).toHaveLength(1)
    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('undoing a label delete does not resurrect a link untagged earlier', async () => {
    // The case that makes the cascade read live rows only. Untag is itself a
    // tombstone, so a task untagged last week must not come back tagged
    // because the label was deleted today.
    const { id: kept } = await addTask('call the plumber', inbox)
    const { id: dropped } = await addTask('post the forms', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(kept, labelId)
    await tagTask(dropped, labelId)
    await untagTask(dropped, labelId)

    const undo = await deleteLabel(labelId)
    await undo!.apply()

    expect(await listTaskLabels(kept)).toHaveLength(1)
    expect(await listTaskLabels(dropped)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/repo/labels.test.ts`
Expected: FAIL — the exports do not exist.

- [ ] **Step 3: Write `repo/labels.ts`**

Create `app/src/lib/repo/labels.ts`:

```ts
/**
 * Labels — cross-project tags, and the join rows that attach them.
 *
 * SPEC §4: "A task is in exactly one project and one section. Labels handle
 * everything cross-cutting." So a label is a name and a colour, and a
 * `task_labels` row is nothing but the pair it points at.
 *
 * That emptiness is what makes the join row's id derivable, which is this
 * slice's one real decision — see `taskLabelId`.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { nextColor } from '../labelling'
import { create, write, batch, composite, now } from './write'
import type { Label, TaskLabel } from '../schema'
import type { UndoStep } from '../undo'

/**
 * A join row's id, computed from the pair rather than generated.
 *
 * Two devices offline both tag the same task with the same label. With a
 * UUIDv7 that is two live rows asserting one fact, a dedupe on every read, and
 * a cleanup path P1 would have to grow. Computed, both devices produce the
 * same id and the push upserts one onto the other.
 *
 * `db.ts` already relies on this for the seeded workspace: "Every device
 * generates the same ids here, which is harmless — push upserts by row id, so
 * the second device collapses onto the first." A join row is the only other
 * row whose identity is fully determined by what it points at; every other
 * table has a name or a title two devices can legitimately differ on.
 */
export function taskLabelId(taskId: string, labelId: string): string {
  return `${taskId}.${labelId}`
}

/** Every live label, in the order the drawer and the picker draw them. */
export async function listLabels(): Promise<Label[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.labels
    .where('[workspace_id+name]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((label) => label.deleted_at === null)
}

/**
 * Every live join row in the workspace.
 *
 * One index read serves this and `listTaskLabels` both, exactly as
 * `listAllChecklistItems` does: the row dots span every task on screen, so a
 * second index keyed by task would be a second thing to keep correct for no
 * measured gain.
 */
export async function listAllTaskLabels(): Promise<TaskLabel[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.task_labels
    .where('[workspace_id+task_id]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  return rows.filter((link) => link.deleted_at === null)
}

/** One task's live join rows. */
export async function listTaskLabels(taskId: string): Promise<TaskLabel[]> {
  const rows = await listAllTaskLabels()
  return rows.filter((link) => link.task_id === taskId)
}

/**
 * Null rather than a throw for an empty name: the picker's field is allowed to
 * be empty, and submitting it is a normal intermediate state rather than a
 * failure — the same rule `renameChecklistItem` follows.
 */
export async function createLabel(
  name: string,
): Promise<{ id: string; undo: UndoStep } | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()

  // The colour is chosen inside the transaction that writes it, like a
  // position in `addChecklistItem`: the picker keeps focus, so a second label
  // can be submitted before the first has landed, and a colour read outside
  // would hand both of them the same one.
  const undo = await batch(['labels'], async () => {
    const row: Label = {
      id,
      workspace_id: workspaceId,
      name: trimmed,
      color: nextColor(await listLabels()),
      updated_at: now(),
      deleted_at: null,
      client_id: clientId(),
    }
    return create('labels', row, 'Label created')
  })

  return { id, undo }
}

export function renameLabel(id: string, name: string): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('labels', id, { name: trimmed }, 'Label renamed')
}

export function setLabelColor(id: string, color: string): Promise<UndoStep | null> {
  return write('labels', id, { color }, 'Label recoloured')
}

/**
 * SPEC §4.4: "Delete a label → `task_labels` rows tombstone; tasks are
 * untouched."
 *
 * The links are read live-only and the undo is built from exactly those. Untag
 * is itself a tombstone, so a task someone untagged last week must not come
 * back tagged because the label was deleted today.
 */
export async function deleteLabel(id: string): Promise<UndoStep | null> {
  return batch(['labels', 'task_labels'], async () => {
    const links = (await listAllTaskLabels()).filter((l) => l.label_id === id)
    const stamp = now()

    const steps: (UndoStep | null)[] = [
      await write('labels', id, { deleted_at: stamp }, 'Label deleted'),
    ]
    for (const link of links) {
      steps.push(
        await write('task_labels', link.id, { deleted_at: stamp }, 'Label deleted'),
      )
    }

    // One `deleted_at` for the whole gesture, so the tombstones agree about
    // when the label went away — the shape `deleteTask` established.
    return composite('Label deleted', steps, true)
  })
}

/**
 * An upsert, not an insert, because the id is a function of the pair.
 *
 * Three real cases: no row yet, a live row, and a tombstone to revive. The
 * last is reached after `deleteLabel` and after any plain untag, so it is not
 * an edge — it is the ordinary way a label comes back to a task.
 *
 * A live row returns null: nothing changed, and handing back a step would
 * evict the one the user is reaching for (SPEC §4.5's single level).
 */
export async function tagTask(
  taskId: string,
  labelId: string,
): Promise<UndoStep | null> {
  const id = taskLabelId(taskId, labelId)
  const { workspaceId } = activeWorkspace()

  return batch(['task_labels'], async () => {
    const existing = await db.task_labels.get(id)

    if (existing === undefined) {
      const row: TaskLabel = {
        id,
        workspace_id: workspaceId,
        task_id: taskId,
        label_id: labelId,
        updated_at: now(),
        deleted_at: null,
        client_id: clientId(),
      }
      return create('task_labels', row, 'Label added')
    }

    if (existing.deleted_at === null) return null
    return write('task_labels', id, { deleted_at: null }, 'Label added')
  })
}

/** SPEC §9: deletions are soft, here as everywhere. */
export function untagTask(
  taskId: string,
  labelId: string,
): Promise<UndoStep | null> {
  return write(
    'task_labels',
    taskLabelId(taskId, labelId),
    { deleted_at: now() },
    'Label removed',
  )
}
```

- [ ] **Step 4: Re-export from the repo barrel**

In `app/src/lib/repo/index.ts`, add after the `./checklist` line:

```ts
export * from './labels'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/repo/labels.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/repo/labels.ts src/lib/repo/labels.test.ts src/lib/repo/index.ts
git commit -m "feat: the label write path, and a join row that upserts

tagTask is an upsert rather than an insert, because the row id is a
function of the pair: untag tombstones that row and re-tag revives the
same one. Three cases, all reachable in ordinary use — absent, live,
and a tombstone left by an untag or by deleting the label.

deleteLabel reads live links only and builds its undo from exactly
those, so undoing it cannot resurrect a link someone untagged earlier.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Deleting a task takes its labels with it

**Files:**
- Modify: `app/src/lib/repo/tasks.ts`
- Modify: `app/src/lib/repo/tasks.test.ts`

**Interfaces:**
- Consumes: `listTaskLabels` from `./labels` (Task 3).
- Produces: no new exports — `deleteTask` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append these cases to the `deleteTask` describe block in
`app/src/lib/repo/tasks.test.ts`:

```ts
  it('tombstones the task\'s labels with it', async () => {
    // The unstated half of SPEC §4.4. A join row whose task is gone is
    // unreachable, and leaving it live means P1 pushes rows for a row the
    // server has been told to forget.
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    await deleteTask(taskId)

    expect(await listTaskLabels(taskId)).toHaveLength(0)
    // The label itself is untouched — it is not the task's to delete.
    expect(await listLabels()).toHaveLength(1)
  })

  it('brings the labels back when the delete is undone', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: labelId } = (await createLabel('waiting-on'))!
    await tagTask(taskId, labelId)

    const undo = await deleteTask(taskId)
    await undo!.apply()

    expect(await listTaskLabels(taskId)).toHaveLength(1)
  })

  it('does not resurrect a label removed before the delete', async () => {
    const { id: taskId } = await addTask('call the plumber', inbox)
    const { id: kept } = (await createLabel('waiting-on'))!
    const { id: dropped } = (await createLabel('errand'))!
    await tagTask(taskId, kept)
    await tagTask(taskId, dropped)
    await untagTask(taskId, dropped)

    const undo = await deleteTask(taskId)
    await undo!.apply()

    const links = await listTaskLabels(taskId)
    expect(links.map((l) => l.label_id)).toEqual([kept])
  })
```

Extend the file's import from `./index` with `createLabel`, `tagTask`,
`untagTask`, `listTaskLabels` and `listLabels`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/repo/tasks.test.ts`
Expected: FAIL — the links survive the delete.

- [ ] **Step 3: Extend the cascade**

In `app/src/lib/repo/tasks.ts`, add a new import line below the existing
`import { listChecklistItems } from './checklist'`:

```ts
import { listTaskLabels } from './labels'
```

Then replace `deleteTask` with:

```ts
export async function deleteTask(id: string): Promise<UndoStep | null> {
  // `task_labels` joins the scope: a table absent from this list cannot be
  // written inside the transaction.
  return batch(['tasks', 'checklist_items', 'task_labels'], async () => {
    const items = await listChecklistItems(id)
    // Live links only. Untag is itself a tombstone, so a label removed from
    // this task last week must not come back when the delete is undone.
    const links = await listTaskLabels(id)
    const stamp = now()

    const steps: (UndoStep | null)[] = [
      await write('tasks', id, { deleted_at: stamp }, 'Task deleted'),
    ]
    for (const item of items) {
      steps.push(
        await write('checklist_items', item.id, { deleted_at: stamp }, 'Task deleted'),
      )
    }
    for (const link of links) {
      steps.push(
        await write('task_labels', link.id, { deleted_at: stamp }, 'Task deleted'),
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

If importing `./labels` from `./tasks` produces a circular-import warning,
check the direction: `labels.ts` must not import from `tasks.ts`. It does not
in Task 3, so the cycle should not arise.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/repo/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo/tasks.ts src/lib/repo/tasks.test.ts
git commit -m "feat: deleting a task takes its labels with it

The unstated half of SPEC §4.4, and the same reasoning the checklist
cascade used: a join row whose task is gone is unreachable, and leaving
it live means P1 pushes rows for a row the server has been told to
forget. One undo brings back the task, its items and its labels.

The links are read live-only, so undoing a delete cannot resurrect a
label removed before it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Dots on the task row

**Files:**
- Create: `app/src/lib/useLabels.ts`
- Create: `app/src/components/LabelDots.tsx`
- Modify: `app/src/components/TaskRow.tsx`
- Modify: `app/src/components/TaskList.tsx`
- Modify: `app/src/components/AgendaList.tsx`

**Interfaces:**
- Consumes: `listLabels`, `listAllTaskLabels` from `../lib/repo` (Task 3);
  `labelsByTask`, `dotClasses` from `../lib/labelling` (Task 2).
- Produces: `useLabels(): Map<string, Label[]>`; `<LabelDots labels={Label[]} />`;
  `TaskRow`'s optional `labels?: Label[]` prop.

- [ ] **Step 1: Write the React seam**

Create `app/src/lib/useLabels.ts`:

```ts
/**
 * Which labels every task on screen carries — the React seam.
 *
 * `labelling.ts` does the grouping and is tested without a DOM; this is the
 * pair of live queries that feed it. The same split as `progress.ts`/
 * `useProgress.ts`, for the same reason.
 *
 * Called once per list, never per row: a hook inside `TaskRow` would be two
 * live queries per visible task.
 */
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listLabels, listAllTaskLabels } from './repo'
import { labelsByTask } from './labelling'
import type { Label } from './schema'

export function useLabels(): Map<string, Label[]> {
  const labels = useLiveQuery(() => listLabels(), [])
  const links = useLiveQuery(() => listAllTaskLabels(), [])
  // Memoized on both query results so the map keeps its identity between
  // renders that changed nothing about the tagging.
  return useMemo(() => labelsByTask(links ?? [], labels ?? []), [links, labels])
}
```

- [ ] **Step 2: Write `LabelDots.tsx`**

Create `app/src/components/LabelDots.tsx`:

```tsx
/**
 * A task's labels, as dots on its row.
 *
 * A row at 390px already carries a checkbox, a title, `Today`, a `1/3`
 * counter and — in the agenda views — its project name. Named chips are what
 * most task apps show and what would wrap that row onto a second line, so this
 * shows colour only: enough to answer "is this tagged, and roughly how", with
 * the names one tap away in the sheet.
 *
 * The names still reach a screen reader, and the browser's tooltip, through
 * the wrapper — the dots themselves are decoration.
 */
import { dotClasses } from '../lib/labelling'
import type { Label } from '../lib/schema'

/**
 * Three, with no overflow marker. A fourth dot on a phone row is noise rather
 * than information, and someone with four labels on one task is served by
 * opening it.
 */
const SHOWN = 3

export function LabelDots({ labels }: { labels?: Label[] }) {
  if (labels === undefined || labels.length === 0) return null
  const names = labels.map((label) => label.name).join(', ')

  return (
    <span
      role="img"
      aria-label={names}
      title={names}
      className="ml-2 inline-flex shrink-0 items-center gap-1 align-middle"
    >
      {labels.slice(0, SHOWN).map((label) => (
        <span
          key={label.id}
          aria-hidden="true"
          className={'size-2 rounded-full ' + dotClasses(label.color)}
        />
      ))}
    </span>
  )
}
```

- [ ] **Step 3: Give `TaskRow` the prop**

Three edits in `app/src/components/TaskRow.tsx`.

a) Add the imports, after the `Progress` type import:

```ts
import { LabelDots } from './LabelDots'
import type { Label } from '../lib/schema'
```

b) Add the parameter to the destructure, after `progress`:

```tsx
  progress,
  labels,
}: {
```

and the prop to the type, after `progress`'s declaration:

```tsx
  /** The labels this task carries, when it has any. */
  labels?: Label[]
```

c) Render it between the progress counter and the badge — after the
`{progress !== undefined && ...}` block and before `{badge !== undefined && ...}`:

```tsx
        <LabelDots labels={labels} />
```

`LabelDots` returns null for an absent or empty list, so no guard is needed
here — which is the reason `labelsByTask` leaves untagged tasks out of the map
entirely.

- [ ] **Step 4: Feed it from the project list**

Two edits in `app/src/components/TaskList.tsx`.

a) Add the import, after the `useProgress` import:

```ts
import { useLabels } from '../lib/useLabels'
```

b) Call it beside `useProgress` (near line 41):

```ts
  const labels = useLabels()
```

c) Pass it wherever `progress={progress.get(task.id)}` appears (near line 190),
adding the line directly below:

```tsx
                        labels={labels.get(task.id)}
```

Both the list and the board render through this file, so both get dots from
this one change.

- [ ] **Step 5: Feed it from the agenda views**

The same three edits in `app/src/components/AgendaList.tsx`: the import after
`useProgress`'s (near line 14), `const labels = useLabels()` beside
`const progress = useProgress()` (near line 30), and
`labels={labels.get(task.id)}` below `progress={progress.get(task.id)}` (near
line 70).

- [ ] **Step 6: Run the suite, the compiler and the linter**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green. No new unit tests here — SPEC §11.3 rule 2 rules out jsdom
and `@testing-library/react`, so these components are verified in Task 6's
browser pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/useLabels.ts src/components/LabelDots.tsx src/components/TaskRow.tsx src/components/TaskList.tsx src/components/AgendaList.tsx
git commit -m "feat: a task row shows the labels it carries, as dots

Colour only, capped at three. A row at 390px already carries a title, a
due date, a checklist counter and sometimes a project name; named chips
are what would wrap it onto a second line. The names reach a screen
reader and a tooltip through the wrapper, and the sheet has them in
full.

useLabels is called once per list, like useProgress — a hook inside
TaskRow would be two live queries per visible task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The picker inside the sheet

**Files:**
- Create: `app/src/components/LabelPicker.tsx`
- Modify: `app/src/components/TaskSheet.tsx`
- Modify: `app/README.md`

**Interfaces:**
- Consumes: `listLabels`, `listTaskLabels`, `createLabel`, `tagTask`,
  `untagTask` from `../lib/repo` (Task 3); `dotClasses` from
  `../lib/labelling` (Task 2); `pushUndo` from `../lib/undo`; `reportProblem`
  from `../lib/problems`.
- Produces: `<LabelPicker taskId={string} />`.

- [ ] **Step 1: Write `LabelPicker.tsx`**

Create `app/src/components/LabelPicker.tsx`:

```tsx
/**
 * A task's labels, inside the sheet.
 *
 * SPEC §4: labels are "cross-project tags" and nothing else — a name and a
 * colour. So this is a row of what the task carries, a field, and the labels
 * that match what you typed. No colour picker: a new label takes the next
 * palette colour, because a colour decision in the middle of typing a name is
 * one nobody wants to make about a label they are inventing in passing.
 *
 * **It uses `useLiveQuery`, and `TaskSheet` deliberately does not** — the same
 * split `Checklist` makes, for the same reason. That rule protects the draft,
 * not the row set: undo is an ordinary new mutation (SPEC §4.5), so a label
 * removed and then restored has to reappear on a sheet that is still open.
 * There is no draft to protect here beyond the filter field, which nothing but
 * this component ever writes.
 */
import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listLabels,
  listTaskLabels,
  createLabel,
  tagTask,
  untagTask,
} from '../lib/repo'
import { dotClasses } from '../lib/labelling'
import { pushUndo } from '../lib/undo'
import { reportProblem } from '../lib/problems'

export function LabelPicker({ taskId }: { taskId: string }) {
  const labels = useLiveQuery(() => listLabels(), [])
  const links = useLiveQuery(() => listTaskLabels(taskId), [taskId])
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const all = labels ?? []
  const tagged = new Set((links ?? []).map((link) => link.label_id))
  const mine = all.filter((label) => tagged.has(label.id))

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? all.filter((label) => label.name.toLowerCase().includes(needle))
    : []
  // Only an exact name blocks creating: "err" matching "errand" should still
  // be able to become its own label.
  const exists = all.some((label) => label.name.toLowerCase() === needle)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || exists) return
    // Clear first: the write goes to IndexedDB and the list re-renders from
    // there, so the field never appears to wait (SPEC §9). QuickAdd's rule.
    setQuery('')
    try {
      const created = await createLabel(value)
      if (created === null) return
      // The tag's step, not the label's. SPEC §4.5 holds one step, and the
      // gesture from the user's side was "put errand on this task" — so undo
      // takes it off the task and leaves the label in the workspace, where
      // another task can reach for it. Deleting a label is its own gesture,
      // in 8b's drawer.
      pushUndo(await tagTask(taskId, created.id))
    } catch (error) {
      // The field was cleared optimistically, so a failure hands the words
      // back — losing what someone typed is worse than the failure.
      setQuery(value)
      reportProblem('Label not created', error)
    }
    input.current?.focus()
  }

  return (
    <div className="mt-4">
      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        Labels
      </span>

      {mine.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {mine.map((label) => (
            <li key={label.id}>
              <button
                type="button"
                onClick={() => void untagTask(taskId, label.id).then(pushUndo)}
                aria-label={`Remove ${label.name}`}
                className="flex min-h-8 items-center gap-1.5 rounded-full border border-black/10 px-2.5 text-xs text-neutral-700 dark:border-white/15 dark:text-neutral-200"
              >
                <span
                  aria-hidden="true"
                  className={'size-2 rounded-full ' + dotClasses(label.color)}
                />
                {label.name}
                <span aria-hidden="true" className="text-neutral-400">
                  &times;
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-1 flex items-center gap-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add a label"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="none"
          aria-label="Add a label"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!query.trim() || exists}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-accent disabled:opacity-30"
        >
          Create
        </button>
      </form>

      {/* The matches appear only while there is something typed. Showing every
          label all the time would make the sheet taller than the phone for a
          list nobody is reading most of the time. */}
      {matches.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {matches.map((label) => {
            const on = tagged.has(label.id)
            return (
              <li key={label.id}>
                <button
                  type="button"
                  onClick={() =>
                    void (on
                      ? untagTask(taskId, label.id)
                      : tagTask(taskId, label.id)
                    ).then(pushUndo)
                  }
                  aria-label={`${on ? 'Remove' : 'Add'} ${label.name}`}
                  className={
                    'flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs ' +
                    (on
                      ? 'border-accent text-neutral-900 dark:text-neutral-100'
                      : 'border-black/10 text-neutral-500 dark:border-white/15 dark:text-neutral-400')
                  }
                >
                  <span
                    aria-hidden="true"
                    className={'size-2 rounded-full ' + dotClasses(label.color)}
                  />
                  {label.name}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render it in the sheet**

Two edits in `app/src/components/TaskSheet.tsx`:

a) Add the import, after `import { Checklist } from './Checklist'`:

```ts
import { LabelPicker } from './LabelPicker'
```

b) Insert it directly after the `<Checklist taskId={taskId} />` line and before
the `<div className="mt-4 flex items-center gap-2">` that starts the Due row:

```tsx
            <Checklist taskId={taskId} />

            {/* With the checklist, above Due, for the same reason: notes, a
                checklist and labels are all "what this task is", while due
                date, priority, project and section are "where and when it
                sits". */}
            <LabelPicker taskId={taskId} />

            <div className="mt-4 flex items-center gap-2">
```

- [ ] **Step 3: Run the suite, the compiler and the linter**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **245 passed (245)**, 23 files. Tasks 1–4 add 30 tests — 12 in
`labelling.test.ts`, 14 in `repo/labels.test.ts`, 3 in `repo/tasks.test.ts` and
1 in `migration.test.ts` — over the 215 that pass today; `db.test.ts`'s count is
unchanged because its version test was replaced rather than added to. Tasks 5
and 6 add none, because SPEC §11.3 rule 2 rules out jsdom and
`@testing-library/react`. If the count differs, reconcile it before moving on
rather than editing the number here.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev` and drive the app at a phone viewport (390×844) and a desktop
one. Check the console at the end — the standing bar for this project is zero
errors and zero warnings.

Walk this list:

1. Open a task. A `Labels` row sits below the checklist with an "Add a label"
   field.
2. Type `errand`, press Enter. A chip appears on the task, the field clears and
   keeps focus. The row behind the sheet grows a coloured dot.
3. Type `waiting-on`, press Enter. A second chip, a second dot, a different
   colour from the first.
4. Type `err`. The `errand` chip appears in the matches below, marked as on.
   Create stays enabled, because `err` is not an exact name.
5. Type `errand` exactly. Create goes disabled — that is the duplicate guard.
6. Tap a chip on the task to remove it. The dot disappears, and the undo toast
   is **visible over the sheet**. Take the undo: the label comes back on a
   sheet that is still open.
7. Close the sheet. The row shows the dots next to its counter and due date.
8. Switch the project to board view — the card shows them too. Go to Today with
   the task dated today: dots there as well.
9. Hover a dot cluster on the desktop viewport: the tooltip names the labels.
10. Tag a task with four labels. Only three dots draw, and the tooltip still
    names all four.
11. Delete the whole task from the sheet. Undo from the toast: the task returns
    *with its labels* — reopen it to confirm.
12. Reload the page. Everything is still there — the labels, the tagging and
    the dots.

Record anything that surprises you. A finding here is worth more than a passing
test: it is the only place these components are checked at all.

- [ ] **Step 5: Update the README**

In `app/README.md`:

a) Replace the status paragraph (the lines beginning "Currently at **P0b slice
7") with:

```markdown
Currently at **P0b slice 8a — labels** (SPEC §13). A task carries
cross-project tags: create one by typing its name in the sheet, and every task
row shows what it carries as coloured dots — in the list, on a board card and
in Today and Upcoming alike. Deleting a task takes its labels with it, and one
undo brings back both.

A task also holds sub-steps: add, tick, rename and delete them in the sheet,
and every task row says how far through them you are — `2/5` next to the due
date. A project is a list or a board, toggled from the header and remembered
per project and per device — the same sections, as headers or as columns, with
Done as the last column you can drag a card into to complete it.
```

b) In the `Layout` code block, add four lines. After the `progress.ts` line:

```
    labelling.ts            the palette, and which labels a task carries (pure)
```

inside the `repo/` group, after the `checklist.ts` line:

```
      labels.ts             cross-project tags, and the join rows (SPEC §4)
```

and in the `components/` group, after the `Checklist.tsx` line:

```
    LabelPicker.tsx         the sheet's labels, live-queried
    LabelDots.tsx           a row's labels, as colour only
```

c) In the `npm test` comment inside the Commands block, add `labelling` to the
parenthesised list of what is tested.

- [ ] **Step 6: Commit**

```bash
git add src/components/LabelPicker.tsx src/components/TaskSheet.tsx README.md
git commit -m "feat: a label picker inside the task sheet

Typing a name and pressing Enter creates the label and tags the task in
one gesture — the colour comes from the palette rather than from a
question, because the fast path is inventing a label in passing.

Matches appear only while something is typed: showing every label at
all times would make the sheet taller than the phone for a list nobody
is reading most of the time. Only an exact name blocks Create, so 'err'
can still become its own label alongside 'errand'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Finishing

After Task 6, use **superpowers:finishing-a-development-branch**: verify the
full suite is green, then present the options and execute the choice. The repo
convention is a rebase merge onto a linear `main`, and per the standing
instruction, work reaches `main` through a PR — never a direct commit.

Deploy a throwaway preview for the phone with `npx wrangler deploy --temporary`
from `app/`, and report the URL. The Workers Builds check fails on every PR
branch in this repo and has since PR #4, including a docs-only one; it is a
known unrelated failure, not this slice's.

**8b is the next plan, not part of this one.** It adds the drawer's label list,
rename/recolour/delete, and the `label:` route. `deleteLabel`, `renameLabel`
and `setLabelColor` ship here with tests and no caller, which is deliberate:
they are the half of the repo that 8b's UI needs, and splitting a file across
two slices costs more than three unused exports.

## Self-review

Run against the spec before starting:

- **Decision 1 (derived id)** — Task 3, `taskLabelId`, with a test asserting
  the exact string. The reasoning lives on the `TaskLabel` type (Task 1) and on
  the function (Task 3).
- **Decision 2 (untag tombstones, re-tag resurrects)** — Task 3's `tagTask`
  upsert, with the three cases tested including revival.
- **Decision 3 (palette key, not hex)** — Task 2's `DOTS` lookup and the
  fallback test; the `Label.color` doc comment in Task 1.
- **Decision 4 (colour assigned)** — Task 2's `nextColor` and its four tests;
  no colour input anywhere in Task 6.
- **Decision 5 (dots, capped at three)** — Task 5's `LabelDots`, `SHOWN = 3`,
  verified at step 4 item 10.
- **Decision 6 (route not filter)** — 8b. Nothing here filters a project.
- **Decision 7 (one index)** — Task 1's version 5 `stores`, with the reasoning
  in the comment.
- **Decision 8 (cascades)** — Task 3's `deleteLabel` and Task 4's `deleteTask`,
  each with a test that an earlier untag is not resurrected.
