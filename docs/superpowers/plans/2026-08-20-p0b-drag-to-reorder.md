# P0b slice 4 — drag to reorder: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task be reordered within a section, moved to another section, and dropped into Done — by touch, by mouse, and by keyboard.

**Architecture:** `dnd-kit` is imported in `components/DraggableList.tsx` and nowhere else. The rule that decides *where* a drop lands is a pure function in `lib/drag.ts`, beside `grouping.ts`, so the fiddliest part of the slice is unit-tested in node rather than trapped in a component. The write goes through the existing `moveTaskTo`, which stays the only function that writes `completed_at`, `section_id` and `position` — so the checkbox, the sheet's Section picker and the drag cannot disagree about SPEC §4's binding.

**Tech Stack:** React 19.2.8, Vite 8.2.1, TypeScript 6.0.3, Tailwind 4.3.3, Dexie 4.4.5, dexie-react-hooks 4.4.0, Vitest 4.1.10 (`environment: 'node'`), fake-indexeddb 6.2.5, oxlint 1.78.0. **New in this slice:** `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/modifiers` 9.0.0, `@dnd-kit/utilities` 3.2.2.

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-drag-to-reorder-design.md`

## Global Constraints

- **`dnd-kit` is imported in `components/DraggableList.tsx` and nowhere else** (SPEC §11.3 rule 1). If a second file needs it, stop and ask.
- **Dexie is imported in `db.ts` and nowhere else** (same rule).
- **Nothing writes to the database except `lib/repo/`**, and inside it nothing opens a transaction except `write.ts`.
- **SPEC §9.1:** every local mutation writes the row **and** appends an outbox entry **in the same IndexedDB transaction**.
- **Order keys are derived inside the transaction that writes them.** Reading neighbours outside one is the race PR #5 closed; `positions.ts` is the only file that derives a key.
- **No jsdom, no `@testing-library/react`** (SPEC §11.3 rule 2). Components are verified in a real browser and on the phone, as slices 1–3 were.
- **New dependencies are pinned exactly** — `--save-exact`, no carets (rule 3).
- Every mutation returns the `UndoStep` that reverses it; the component pushes it. Undo never rewinds the outbox (SPEC §4.5).

---

### Task 1: `lib/drag.ts` — where a drop lands

**Files:**
- Create: `app/src/lib/drag.ts`
- Create: `app/src/lib/drag.test.ts`

**Interfaces:**
- Consumes: `SectionGroup` from `./grouping` (`{ section: Section; tasks: Task[] }`).
- Produces: `resolveDrop(groups: SectionGroup[], activeId: string, overId: string | null): DropTarget | null` and `interface DropTarget { sectionId: string; beforeId: string | null }`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/drag.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveDrop } from './drag'
import type { SectionGroup } from './grouping'
import type { Section, Task } from './schema'

function section(id: string, done = false): Section {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    name: id,
    position: 'a0',
    is_done_section: done,
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function task(id: string, sectionId: string): Task {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    section_id: sectionId,
    title: id,
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
    updated_at: '2026-08-20T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

/** Tasks, then Done — the order `groupBySection` produces. */
function groups(open: string[], done: string[] = []): SectionGroup[] {
  return [
    { section: section('tasks'), tasks: open.map((id) => task(id, 'tasks')) },
    { section: section('done', true), tasks: done.map((id) => task(id, 'done')) },
  ]
}

describe('resolveDrop', () => {
  it('drops above the row you are over when dragging up', () => {
    expect(resolveDrop(groups(['a', 'b', 'c']), 'c', 'a')).toEqual({
      sectionId: 'tasks',
      beforeId: 'a',
    })
  })

  // The case that inverts, and the reason this file exists: the row under the
  // thumb has already shifted up to fill the gap the dragged task left, so
  // "above the row I am over" would put it back where it started.
  it('drops below the row you are over when dragging down', () => {
    expect(resolveDrop(groups(['a', 'b', 'c', 'd']), 'a', 'b')).toEqual({
      sectionId: 'tasks',
      beforeId: 'c',
    })
  })

  it('drops at the end when dragging down onto the last row', () => {
    expect(resolveDrop(groups(['a', 'b', 'c']), 'a', 'c')).toEqual({
      sectionId: 'tasks',
      beforeId: null,
    })
  })

  it('drops above the row you are over in another section', () => {
    // Nothing has shifted in a section the task did not come from.
    expect(resolveDrop(groups(['a', 'b'], ['x', 'y']), 'a', 'y')).toEqual({
      sectionId: 'done',
      beforeId: 'y',
    })
  })

  it('drops at the end of a section when the target is the section itself', () => {
    // An empty section, or a collapsed Done header: the drop is on the
    // container, not on a row.
    expect(resolveDrop(groups(['a', 'b']), 'a', 'done')).toEqual({
      sectionId: 'done',
      beforeId: null,
    })
  })

  it('ignores a drop onto itself', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', 'a')).toBeNull()
  })

  it('ignores a cancelled drag, which has nothing under it', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', null)).toBeNull()
  })

  it('ignores ids that are not in the list', () => {
    expect(resolveDrop(groups(['a', 'b']), 'a', 'ghost')).toBeNull()
    expect(resolveDrop(groups(['a', 'b']), 'ghost', 'a')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/lib/drag.test.ts
```
Expected: FAIL — `Cannot find module './drag'`.

- [ ] **Step 3: Write `lib/drag.ts`**

```ts
/**
 * Where a drop lands.
 *
 * Pure and framework-free, for the same reason `grouping.ts` is: the
 * interesting rule in here deserves a test, not a DOM. It reads the
 * `SectionGroup[]` the list has already computed, so it needs no database
 * read and cannot disagree with what is on the screen.
 *
 * `dnd-kit` reports which id the pointer was over and nothing else. That id is
 * either a task or a section — a section is a drop target in its own right,
 * which is what makes an empty section, and the collapsed Done header,
 * something a thumb can hit.
 */
import type { SectionGroup } from './grouping'

export interface DropTarget {
  sectionId: string
  /** The task to land above; null means the end of the section. */
  beforeId: string | null
}

export function resolveDrop(
  groups: SectionGroup[],
  activeId: string,
  overId: string | null,
): DropTarget | null {
  // No target: the drag was cancelled, or ended over nothing.
  if (overId === null || overId === activeId) return null

  const from = groups.find((g) => g.tasks.some((t) => t.id === activeId))
  if (from === undefined) return null

  const container = groups.find((g) => g.section.id === overId)
  if (container !== undefined) {
    return { sectionId: container.section.id, beforeId: null }
  }

  const to = groups.find((g) => g.tasks.some((t) => t.id === overId))
  if (to === undefined) return null

  const overIndex = to.tasks.findIndex((t) => t.id === overId)
  const fromIndex = to === from ? from.tasks.findIndex((t) => t.id === activeId) : -1

  // Dragging down inside one section: the row under the thumb has already
  // shifted up into the gap, so the drop belongs below it rather than above.
  const beforeId =
    fromIndex !== -1 && fromIndex < overIndex
      ? (to.tasks[overIndex + 1]?.id ?? null)
      : overId

  return { sectionId: to.section.id, beforeId }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npx vitest run src/lib/drag.test.ts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the whole suite and the build**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 138 tests; build clean; lint clean.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/drag.ts src/lib/drag.test.ts
git commit -m "$(cat <<'EOF'
feat: where a drop lands, as a function you can test

The rule that is easy to get wrong is the same-section drag downward: the row
under the thumb has already shifted up into the gap, so "above the row I am
over" would put the task back where it started. That belongs in a tested
function next to `grouping.ts`, not inside a component this project has no way
to test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `positionBeforeIn` — a key between two neighbours

**Files:**
- Modify: `app/src/lib/repo/positions.ts`
- Create: `app/src/lib/repo/positions.test.ts`

**Interfaces:**
- Consumes: `generateKeyBetween` from `../fractional-indexing`, `db` from `../db`.
- Produces: `positionBeforeIn(sectionId: string, beforeId: string | null, excludeId: string): Promise<string>`. Task 3 calls it inside a transaction.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/repo/positions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import { appendPositionIn, positionBeforeIn } from './positions'
import { now } from './write'

const { workspaceId } = activeWorkspace()

async function seed(rows: Array<{ id: string; position: string; deleted?: boolean }>) {
  await db.tasks.bulkAdd(
    rows.map((row) => ({
      id: row.id,
      workspace_id: workspaceId,
      project_id: 'p',
      section_id: 'section-1',
      title: row.id,
      notes: null,
      due_on: null,
      due_time: null,
      reminder_at: null,
      reminder_sent_at: null,
      priority: 0 as const,
      completed_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      position: row.position,
      created_by: null,
      assignee_id: null,
      updated_at: now(),
      deleted_at: row.deleted === true ? now() : null,
      client_id: 'test',
    })),
  )
}

describe('positionBeforeIn', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
  })

  it('returns a key that sorts between the two neighbours', async () => {
    await seed([
      { id: 'first', position: 'a0' },
      { id: 'second', position: 'a1' },
      { id: 'mover', position: 'a2' },
    ])

    const key = await positionBeforeIn('section-1', 'second', 'mover')

    expect(key > 'a0').toBe(true)
    expect(key < 'a1').toBe(true)
  })

  it('appends when there is nothing to land before', async () => {
    await seed([
      { id: 'first', position: 'a0' },
      { id: 'mover', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', null, 'mover')

    expect(key > 'a0').toBe(true)
  })

  it('ignores the task being moved, which is still sitting in the list', async () => {
    // Without the exclusion the mover's own key is a neighbour of itself, and
    // `generateKeyBetween` throws on equal ends.
    await seed([
      { id: 'mover', position: 'a0' },
      { id: 'other', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', 'other', 'mover')

    expect(key < 'a1').toBe(true)
  })

  it('counts a tombstone as occupied, exactly as an append does', async () => {
    // Same rule as `appendPositionIn`: a deleted task's key is not free while
    // its undo offer still stands.
    await seed([
      { id: 'gone', position: 'a0', deleted: true },
      { id: 'mover', position: 'a1' },
    ])

    const key = await positionBeforeIn('section-1', null, 'mover')
    const append = await appendPositionIn('section-1')

    expect(key > 'a0').toBe(true)
    expect(append > 'a0').toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/lib/repo/positions.test.ts
```
Expected: FAIL — `positionBeforeIn is not a function`.

- [ ] **Step 3: Add the function**

Append to `app/src/lib/repo/positions.ts`:

```ts
/**
 * The key for a task landing directly above `beforeId`, or at the end when
 * that is null.
 *
 * Same two rules as `appendPositionIn`: call it inside the transaction that
 * writes the key, and count tombstones. `excludeId` is the task being moved —
 * it is still sitting in the list it is being dragged out of, and using its
 * own key as one of its neighbours makes `generateKeyBetween` throw.
 */
export async function positionBeforeIn(
  sectionId: string,
  beforeId: string | null,
  excludeId: string,
): Promise<string> {
  const tasks = await db.tasks.toArray()
  const siblings = tasks
    .filter((task) => task.section_id === sectionId && task.id !== excludeId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))

  const found = beforeId === null ? -1 : siblings.findIndex((t) => t.id === beforeId)
  const index = found === -1 ? siblings.length : found

  return generateKeyBetween(
    siblings[index - 1]?.position ?? null,
    siblings[index]?.position ?? null,
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npx vitest run src/lib/repo/positions.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/repo/positions.ts src/lib/repo/positions.test.ts
git commit -m "$(cat <<'EOF'
feat: a key between two neighbours, derived where it is written

Same two rules the append already follows — inside the caller's transaction,
and tombstones count. The third rule is new: the task being dragged is still in
the list it is leaving, and using its own key as one of its neighbours makes
`generateKeyBetween` throw on equal ends.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `dropTaskAt` — the write, through the one binding

**Files:**
- Modify: `app/src/lib/repo/tasks.ts`
- Modify: `app/src/lib/repo/tasks.test.ts`

**Interfaces:**
- Consumes: `positionBeforeIn` from Task 2; the private `moveTaskTo` already in this file.
- Produces: `dropTaskAt(id: string, sectionId: string, beforeId: string | null, options?: { toast?: boolean }): Promise<UndoStep | null>`, exported through `repo/index.ts` by the existing `export * from './tasks'`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('repo', ...)` block in `app/src/lib/repo/tasks.test.ts`, before its closing `})`:

```ts
  it('drops a task between its new neighbours', async () => {
    await addTask('a', inbox)
    const b = await addTask('b', inbox)
    const c = await addTask('c', inbox)
    const section = await firstOpenSectionOf(inbox)

    await dropTaskAt(c.id, section.id, b.id)

    expect((await listTasks(inbox)).map((t) => t.title)).toEqual(['a', 'c', 'b'])
  })

  it('completes a task dropped into the done section', async () => {
    // SPEC §4's binding, reached by the third route. The checkbox and the
    // sheet's picker already go through the same function.
    const { id } = await addTask('buy milk', inbox)
    const done = await doneSectionOf(inbox)

    await dropTaskAt(id, done.id, null)

    const moved = await getTask(id)
    expect(moved!.section_id).toBe(done.id)
    expect(moved!.completed_at).not.toBeNull()
  })

  it('reopens a task dragged back out of the done section', async () => {
    const { id } = await addTask('buy milk', inbox)
    const done = await doneSectionOf(inbox)
    const open = await firstOpenSectionOf(inbox)
    await dropTaskAt(id, done.id, null)

    await dropTaskAt(id, open.id, null)

    const moved = await getTask(id)
    expect(moved!.completed_at).toBeNull()
  })

  it('gives two drops racing into one section distinct positions', async () => {
    // The same race `addTask` was fixed for: the key must be derived inside
    // the transaction that writes it.
    const first = await addTask('one', inbox)
    const second = await addTask('two', inbox)
    const done = await doneSectionOf(inbox)

    await Promise.all([
      dropTaskAt(first.id, done.id, null),
      dropTaskAt(second.id, done.id, null),
    ])

    const moved = await Promise.all([getTask(first.id), getTask(second.id)])
    expect(moved[0]!.position).not.toBe(moved[1]!.position)
  })

  it('undoes a drop back to the section, position and state it came from', async () => {
    const { id } = await addTask('buy milk', inbox)
    const before = await getTask(id)
    const done = await doneSectionOf(inbox)

    const undo = await dropTaskAt(id, done.id, null, { toast: true })
    expect(undo!.toast).toBe(true)
    await undo!.apply()

    const after = await getTask(id)
    expect(after!.section_id).toBe(before!.section_id)
    expect(after!.position).toBe(before!.position)
    expect(after!.completed_at).toBeNull()
  })
```

Add `dropTaskAt` and `doneSectionOf` to the existing import from `./index` at the top of the file if they are not already there.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/lib/repo/tasks.test.ts
```
Expected: FAIL — `dropTaskAt is not a function`.

- [ ] **Step 3: Teach `moveTaskTo` about a slot**

In `app/src/lib/repo/tasks.ts`, add the import:

```ts
import { appendPositionIn, positionBeforeIn } from './positions'
```

Change the signature of the private `moveTaskTo` to take an optional slot, and derive the position from it:

```ts
async function moveTaskTo(
  task: Task,
  target: Section,
  label: string,
  toast: boolean,
  extra: Record<string, unknown> = {},
  // Where in the target section the task lands. Absent means the end, which
  // is what the checkbox and the sheet's picker want; a drag names a slot.
  slot?: { before: string | null },
): Promise<UndoStep | null> {
```

and inside the `write` call, replace the `position` line with:

```ts
        position:
          slot === undefined
            ? await appendPositionIn(target.id)
            : await positionBeforeIn(target.id, slot.before, task.id),
```

Both branches still run inside the existing `batch(['tasks'], ...)`, which is what keeps the derivation and the write in one transaction.

- [ ] **Step 4: Add `dropTaskAt`**

Add below `setTaskSection` in the same file:

```ts
/**
 * A drag, and the third caller of the binding above.
 *
 * `beforeId` is the task to land above, or null for the end of the section.
 * The toast is the caller's call, not this function's: a drop only takes its
 * result off the screen when the destination is a collapsed section, and only
 * the list knows what is collapsed.
 */
export async function dropTaskAt(
  id: string,
  sectionId: string,
  beforeId: string | null,
  options: { toast?: boolean } = {},
): Promise<UndoStep | null> {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null
  return moveTaskTo(task, target, 'Task moved', options.toast ?? false, {}, {
    before: beforeId,
  })
}
```

- [ ] **Step 5: Run the tests**

```bash
cd app && npx vitest run src/lib/repo/tasks.test.ts
```
Expected: PASS — the five new tests plus the existing ones.

- [ ] **Step 6: Verify the whole suite and the build**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 147 tests; build clean; lint clean.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/lib/repo/tasks.ts src/lib/repo/tasks.test.ts
git commit -m "$(cat <<'EOF'
feat: a drop is a move with a slot, not a fourth copy of the rule

`moveTaskTo` learns where in the section a task lands; everything else about
it is unchanged. The checkbox, the sheet's Section picker and now the drag all
write `completed_at`, `section_id` and `position` through the same function, so
dropping a task into Done ticks it for the same reason checking it moves it.

The key is still derived inside the transaction that writes it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `DraggableList.tsx` — the one file that knows about dnd-kit

**Files:**
- Modify: `app/package.json` (four dependencies)
- Create: `app/src/components/DraggableList.tsx`

**Interfaces:**
- Produces, all consumed by Task 5:
  - `DragArea({ onStart, onDrop, describe, overlay, children })` where `onDrop: (activeId: string, overId: string | null) => void` and `describe: (id: string) => string`.
  - `DragGroup({ id, itemIds, children })`.
  - `DragItem({ id, children })` where `children` is `(handle: Record<string, unknown>) => ReactNode`.

- [ ] **Step 1: Install the dependency, pinned**

```bash
cd app && npm install --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/modifiers@9.0.0 @dnd-kit/utilities@3.2.2
```

Confirm `package.json` shows bare versions with no `^`. SPEC §11.3 rule 3: pinned exactly, nothing auto-merged.

- [ ] **Step 2: Write the component**

Create `app/src/components/DraggableList.tsx`:

```tsx
/**
 * The drag seam — the only file in the app that imports `dnd-kit`.
 *
 * SPEC §11.3 rule 1: a dependency that could churn is imported in exactly one
 * file. Rule 2 names this one among the things not to hand-roll — touch drag
 * is hard, not verbose. Three components rather than one `<DraggableList>`,
 * because the list is grouped and dropping a task into another section is half
 * the point.
 *
 * The phone decided the shape of this file. Press-and-hold does not work:
 * Android raises its own selection menu — Copy / Share / Select all — before
 * dnd-kit sees the gesture. The cure is `touch-action: none`, which would stop
 * the list scrolling if it were on a row, and on a phone the rows *are* the
 * list. So the drag starts from a grip that owns its own patch of screen, and
 * everything else on the row behaves normally.
 */
import { type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export function DragArea({
  onStart,
  onDrop,
  describe,
  overlay,
  children,
}: {
  onStart: (id: string) => void
  /** `overId` is a task id or a section id — the caller knows which. */
  onDrop: (activeId: string, overId: string | null) => void
  /** How to name a task or a section out loud, for screen readers. */
  describe: (id: string) => string
  overlay: ReactNode
  children: ReactNode
}) {
  const sensors = useSensors(
    // With a dedicated grip there is no ambiguity to wait out, so movement
    // starts the drag rather than time. A delay here was the first attempt and
    // Android took the gesture before dnd-kit saw it.
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // dnd-kit's defaults say "Picked up draggable item" and name nothing. A drop
  // into Done also completes the task, and someone who cannot see the checkbox
  // has to be told that.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : `${describe(String(active.id))} is over ${describe(String(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${describe(String(active.id))} was dropped where it started.`
        : `Dropped ${describe(String(active.id))} at ${describe(String(over.id))}.`,
    onDragCancel: ({ active }) =>
      `Cancelled. ${describe(String(active.id))} is back where it started.`,
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements }}
      onDragStart={(event: DragStartEvent) => onStart(String(event.active.id))}
      onDragCancel={() => onDrop('', null)}
      onDragEnd={(event: DragEndEvent) =>
        onDrop(String(event.active.id), event.over ? String(event.over.id) : null)
      }
    >
      {children}
      {/* The row follows the thumb rather than the list reflowing under it,
          which is what makes a drop on a small screen feel aimed. */}
      <DragOverlay>{overlay}</DragOverlay>
    </DndContext>
  )
}

/**
 * One section, and a drop target in its own right — which is what makes an
 * empty section, or a collapsed Done header, something a thumb can hit.
 */
export function DragGroup({
  id,
  itemIds,
  children,
}: {
  id: string
  itemIds: string[]
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={
          'rounded-xl transition-colors ' + (isOver ? 'bg-accent/10' : 'bg-transparent')
        }
      >
        {children}
      </div>
    </SortableContext>
  )
}

/**
 * One row, handing the caller a grip rather than making the whole row
 * draggable.
 *
 * The grip carries `touch-action: none`, so the browser gives that patch of
 * screen to us and stops trying to select text or scroll from it. The rest of
 * the row keeps its ordinary behaviour: the list still scrolls under a thumb,
 * and the title still opens the sheet.
 *
 * `attributes` go on the grip, never on the row. Spread onto the `<li>` they
 * make every task announce as a button and swallow its own content.
 */
export function DragItem({
  id,
  children,
}: {
  id: string
  children: (handle: Record<string, unknown>) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const handle = {
    ...attributes,
    ...listeners,
    style: {
      touchAction: 'none' as const,
      userSelect: 'none' as const,
      WebkitUserSelect: 'none' as const,
      // Android raises the copy/share callout on a long press even with no
      // selection to make.
      WebkitTouchCallout: 'none' as const,
    },
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : undefined}
    >
      {children(handle)}
    </li>
  )
}
```

- [ ] **Step 3: Verify the build and the suite**

```bash
cd app && npm run build && npm run lint && npm test
```
Expected: build clean; lint clean; PASS, 147 tests. The component has no unit tests by design — SPEC §11.3 rule 2 rejects jsdom, and Task 6 verifies it in a browser and on the phone.

- [ ] **Step 4: Commit**

```bash
cd app && git add package.json package-lock.json src/components/DraggableList.tsx
git commit -m "$(cat <<'EOF'
feat: the drag seam, with the grip the phone insisted on

`dnd-kit` behind one file, as SPEC §11.3 rule 1 requires and rule 2 recommends
— touch drag is hard, not verbose. Pinned exactly, per rule 3.

The grip exists because Android's long press belongs to the browser: it raises
Copy / Share / Select all before dnd-kit sees anything. `touch-action: none`
fixes that but would stop the list scrolling if it sat on a row, and on a phone
the rows are the list. So the grip owns its own patch of screen and the row is
left alone.

Keyboard sensor included: on the Mac, which SPEC §8 calls the organizing
device, a grip that only answers to a mouse is half a control. The
announcements name the task and say when a drop completed it, because the
person hearing them cannot see the checkbox change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The list, with a grip

**Files:**
- Modify: `app/src/components/TaskList.tsx`

**Interfaces:**
- Consumes: `resolveDrop` (Task 1), `dropTaskAt` (Task 3), `DragArea` / `DragGroup` / `DragItem` (Task 4).

- [ ] **Step 1: Wire the imports and drag state**

In `app/src/components/TaskList.tsx`, extend the repo import with `dropTaskAt`:

```tsx
import {
  listTasks, listSections, setTaskDone, deleteTask, addSection, dropTaskAt,
} from '../lib/repo'
```

and add:

```tsx
import { resolveDrop } from '../lib/drag'
import { DragArea, DragGroup, DragItem } from './DraggableList'
```

Add the drag state beside the existing `useState` calls:

```tsx
  const [dragging, setDragging] = useState<string | null>(null)
```

- [ ] **Step 2: Add the drop handler**

Add above `addNewSection`, inside the component:

```tsx
  function onDrop(activeId: string, overId: string | null) {
    setDragging(null)
    const target = resolveDrop(groups, activeId, overId)
    if (target === null) return

    // A toast only when the row left the screen — the rule `Toast.tsx`
    // already follows. Dropping into a collapsed Done both hides the task and
    // completes it; a reorder you can still see needs no offer.
    const done = sections.find((s) => s.is_done_section)
    const vanished = target.sectionId === done?.id && !doneOpen

    void dropTaskAt(activeId, target.sectionId, target.beforeId, {
      toast: vanished,
    }).then(pushUndo)
  }

  /** How a task or a section is named out loud during a drag. */
  function describe(id: string): string {
    const section = sections.find((s) => s.id === id)
    if (section !== undefined) {
      return section.is_done_section
        ? `${section.name}, which completes the task`
        : section.name
    }
    return tasks.find((t) => t.id === id)?.title ?? 'the task'
  }
```

- [ ] **Step 3: Wrap the list in the drag area**

Replace the opening of the returned markup:

```tsx
  const draggedTask = tasks.find((t) => t.id === dragging)

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      <DragArea
        onStart={setDragging}
        onDrop={onDrop}
        describe={describe}
        overlay={
          draggedTask === undefined ? null : (
            <div className="rounded-xl bg-white px-3 py-2 shadow-lg dark:bg-neutral-800">
              <span className="text-neutral-900 dark:text-neutral-100">
                {draggedTask.title}
              </span>
            </div>
          )
        }
      >
      {groups.map((group) => {
```

Wrap each section's contents in a `DragGroup`, immediately inside `<section key={group.section.id}>`:

```tsx
            <DragGroup
              id={group.section.id}
              itemIds={collapsed === true ? [] : group.tasks.map((t) => t.id)}
            >
```

closing it after the `{collapsed !== true && ( ... )}` block:

```tsx
            </DragGroup>
```

and close the drag area after the `groups.map(...)` call:

```tsx
      })}
      </DragArea>
```

- [ ] **Step 4: Turn each row into a `DragItem` with a grip**

Replace the `<li key={task.id} …>` wrapper with a `DragItem` render prop, and add the grip as the last child of the row — outermost at the right edge, past the delete `×`:

```tsx
                    <DragItem key={task.id} id={task.id}>
                    {(handle) => (
                    <div className="group flex items-center gap-3 rounded-xl px-1 py-1">
```

…the checkbox, title button and delete button are unchanged…

```tsx
                      <button
                        type="button"
                        {...handle}
                        aria-label={`Reorder ${task.title}`}
                        className="flex min-h-11 shrink-0 cursor-grab items-center pl-1 pr-2 text-lg leading-none text-neutral-300 dark:text-neutral-600"
                      >
                        ⠿
                      </button>
                    </div>
                    )}
                    </DragItem>
```

The grip is a real `<button>`, so it is focusable and the keyboard sensor can reach it. It sits at the right edge because that is where a thumb rests; the delete `×` beside it is `opacity-0 group-hover:opacity-100` and therefore desktop-only, so that edge was free.

- [ ] **Step 5: Verify the suite and the build**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 147 tests; build clean; lint clean.

- [ ] **Step 6: Verify in a browser**

```bash
cd app && npm run dev
```

With a project holding three tasks: drag the middle task above the first by its grip and confirm the order changes and survives a reload. Drag a task onto the collapsed **Done** header and confirm it lands there ticked, with an undo toast. Expand Done and drag it back out; the checkbox clears and no toast appears, because nothing left the screen. Reorder within a section and confirm no toast, then press Ctrl+Z and confirm it goes back.

Then tab to a grip, press Space, move with the arrow keys, press Space again, and confirm the task moved — the Mac is the organizing device and this is its idiom.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/components/TaskList.tsx
git commit -m "$(cat <<'EOF'
feat: a grip on every row, and the list rearranges under it

The component holds no drag logic: dnd-kit reports two ids, `resolveDrop` says
what they mean, and `dropTaskAt` writes it. The only thing the list knows that
the repo cannot is whether Done is collapsed, which is what decides the toast.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Documentation and the whole-slice check

**Files:**
- Modify: `app/README.md`

- [ ] **Step 1: Update the README**

Change the status line to **"P0b slice 4 — drag to reorder"** and say what the app now is: tasks can be reordered and moved between sections by dragging a grip, by touch or keyboard, and dropping into Done completes them.

Add to the layout map, in the `lib/` block after `grouping.ts`:

```
    drag.ts                 where a drop lands (pure; SPEC §8, §13)
```

and in the `components/` block:

```
    DraggableList.tsx       the ONLY file importing dnd-kit (SPEC §11.3 rule 1)
```

Extend the first convention bullet, which currently names Dexie and the PWA plugin, to include dnd-kit:

> Dexie only in `db.ts`, the PWA plugin's runtime only in `UpdatePrompt.tsx`, `dnd-kit` only in `DraggableList.tsx`.

- [ ] **Step 2: Run everything**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 147 tests; build clean; lint clean.

- [ ] **Step 3: Verify on the phone**

This is the step the slice exists for, and a desktop cannot stand in for it. Deploy a preview and open it on the phone **in the browser, without installing**:

```bash
cd app && npm run build && npx wrangler deploy --temporary
```

On the phone: drag a task by its grip and confirm it moves; scroll the list by dragging on a task's title and confirm scrolling still works; drop a task onto the collapsed Done header and confirm it lands ticked; open a task and confirm the sheet's Section picker still moves it, since that is SPEC §8's non-drag fallback and it must keep working.

- [ ] **Step 4: Commit and open the PR**

```bash
cd app && git add README.md
git commit -m "$(cat <<'EOF'
docs: drag, and the third file with a dependency of its own

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin p0b-4-drag-to-reorder
gh pr create --title "P0b slice 4 — drag to reorder" --body "$(cat <<'EOF'
Slice 4 of P0b: a task can be reordered within a section, moved to another
section, and dropped into Done — by touch, by mouse and by keyboard.

Built from what the phone said in the spike (SPEC §13's second-riskiest item):
Android's long press belongs to the browser, so the row cannot be the handle
and a grip is not optional. The grip sits at the right edge, where a thumb
already rests, and starts a drag on movement rather than on a delay.

- `dnd-kit` behind one file, pinned exactly (SPEC §11.3 rules 1 and 3).
- The rule that decides where a drop lands is a pure function in `lib/drag.ts`,
  tested in node — including the same-section drag downward, where the row
  under the thumb has already shifted up.
- The write goes through `moveTaskTo`, which is still the only function that
  writes `completed_at`, `section_id` and `position`. Dropping into Done ticks
  the task for the same reason checking it moves it.
- Order keys are derived inside the transaction that writes them, so two quick
  drops cannot collide.
- A toast only when the row left the screen, which is the rule `Toast.tsx`
  already followed.
- Keyboard reordering and written screen-reader announcements, including that a
  drop into Done completed the task.

The sheet's Section picker remains SPEC §8's non-drag fallback and is unchanged.

Design: `docs/superpowers/specs/2026-08-20-p0b-drag-to-reorder-design.md`
Plan: `docs/superpowers/plans/2026-08-20-p0b-drag-to-reorder.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **Do not put `touch-action: none` on the row.** It is the one change that would make the list stop scrolling on a phone, and the spike proved it the expensive way.
- **Do not spread dnd-kit's `attributes` onto the `<li>`.** Every row then announces as a button and hides its own content from a screen reader.
- **Do not derive an order key outside a transaction.** `positions.ts` is the only file that derives one, and both of its functions must be called inside the caller's `batch()`.
- **Do not add a fourth writer of `completed_at` / `section_id` / `position`.** If a new entry point seems to need one, it wants `moveTaskTo` with a slot.
- **Do not add jsdom or `@testing-library/react`** to test the components. SPEC §11.3 rule 2 settled that, and Task 6 is how the UI gets verified.
