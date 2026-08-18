# P0b slice 3 — projects, sections, and the done binding: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Lane's one hardcoded list into real projects with sections, and make checking a task move it into its project's done section — SPEC §4's "whole thesis in one behaviour".

**Architecture:** `repo.ts` becomes `repo/`, keeping the rule that nothing writes outside it while giving projects, sections and tasks a file each. A new `composite()` undo step and a `batch()` transaction helper let one action span several rows. Navigation is a `nav.ts` module singleton persisted to `localStorage` — no router. The §4 binding lives in exactly one private function, `moveTaskTo`, which both the checkbox and the sheet's Section picker go through.

**Tech Stack:** React 19.2.8, Vite 8.2.1, TypeScript 6.0.3, Tailwind 4.3.3, Dexie 4.4.5, dexie-react-hooks 4.4.0, Vitest 4.1.10 (`environment: 'node'`, hand-written `localStorage` in `src/test/setup.ts`), fake-indexeddb 6.2.5, oxlint 1.78.0. **No dependency is added in this slice.**

**Spec:** `docs/superpowers/specs/2026-08-18-p0b-projects-sections-design.md`

## Global Constraints

- **No new dependencies.** SPEC §11.3 rule 2: "prefer ~40 lines you own to a package". Not a router, not a toast library, not jsdom, not `@testing-library/react`. If a step seems to need one, stop and ask.
- **Dexie is imported in `db.ts` and nowhere else** (SPEC §11.3 rule 1). If a test needs Dexie outside `db.ts`, stop.
- **Nothing writes to the database except `lib/repo/`**, and inside it nothing opens a transaction except `write.ts`.
- **SPEC §9.1:** "Every local mutation writes the row **and** appends an outbox entry **in the same IndexedDB transaction**."
- **SPEC §9.2:** the seq is left alone on coalesce — "a project created before the tasks inside it must keep its lower sequence number".
- **SPEC §4:** "`completed_at` and `section_id` are always written together, never independently."
- **SPEC §4.1:** `updated_at` and `reminder_sent_at` are server-owned and never pushed; `client_id` **is** pushed.
- **SPEC §4.5:** undo is "local, session-scoped, and single-level per action ... it never rewinds the outbox".
- **`npm test` is not enough.** It does not typecheck — slice 1 shipped a TypeScript error past a green test run. Every commit step runs `npm run build` too.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- All commands run from `app/`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/repo/write.ts` | create / write / composite / batch / now — the only place a transaction opens | 1 |
| `src/lib/repo/positions.ts` | `appendPositionIn(sectionId)` — shared by tasks and sections, and the reason neither imports the other | 1 |
| `src/lib/repo/index.ts` | the public surface; re-exports only | 1 |
| `src/lib/repo/tasks.ts` | task mutations, moved from `repo.ts`; later the §4 binding | 1, 5 |
| `src/lib/repo/tasks.test.ts` | moved from `repo.test.ts` | 1, 5 |
| `src/lib/repo/write.test.ts` | batch atomicity | 1 |
| `src/lib/repo/projects.ts` + `.test.ts` | projects | 3 |
| `src/lib/repo/sections.ts` + `.test.ts` | sections, and §4.4's rules | 4 |
| `src/lib/repo.ts` | deleted | 1 |
| `src/lib/nav.ts` + `.test.ts` | the open project, persisted | 2 |
| `src/lib/grouping.ts` + `.test.ts` | pure: sections + tasks → display groups | 6 |
| `src/components/Drawer.tsx` | project list, `+ Project` | 7 |
| `src/components/SectionHeader.tsx` | name, `⋯` rename/delete, collapse for Done | 8 |
| `src/components/TaskList.tsx` | grouped rendering | 5, 8 |
| `src/components/TaskSheet.tsx` | Project and Section pickers | 9 |
| `src/components/QuickAdd.tsx` | adds into the open project | 5, 7 |
| `src/App.tsx` | hamburger, project name, `⋯`, drawer | 7 |
| `app/README.md` | status line, layout map, the repo-directory convention | 10 |

**One refinement on the spec's file table:** the spec listed four files under `repo/`. Planning added a fifth, `positions.ts`. Both `tasks.ts` and `sections.ts` need to append a task into a section (completing a task; moving tasks out of a deleted section), and `tasks.ts` already imports `sections.ts` for `doneSectionOf`. Putting the helper in either one creates an import cycle; a third file that both import breaks it.

---

### Task 1: `repo.ts` becomes `repo/`

**Files:**
- Create: `app/src/lib/repo/write.ts`, `app/src/lib/repo/positions.ts`, `app/src/lib/repo/tasks.ts`, `app/src/lib/repo/index.ts`, `app/src/lib/repo/write.test.ts`
- Delete: `app/src/lib/repo.ts`
- Move: `app/src/lib/repo.test.ts` → `app/src/lib/repo/tasks.test.ts`

**Interfaces:**
- Produces, from `write.ts` (internal to `repo/`, not re-exported by `index.ts`):
  - `now(): string`
  - `create<T extends { id: string }>(table: TableName, row: T, label: string): Promise<UndoStep>`
  - `write(table: TableName, id: string, changes: Record<string, unknown>, label: string, toast?: boolean): Promise<UndoStep | null>`
  - `composite(label: string, steps: (UndoStep | null)[], toast?: boolean): UndoStep`
  - `batch<T>(tables: TableName[], body: () => Promise<T>): Promise<T>`
- Produces, from `positions.ts`: `appendPositionIn(sectionId: string): Promise<string>`
- Produces, from `index.ts`: every export `repo.ts` had — `listTasks`, `addTask`, `setTaskDone`, `renameTask`, `deleteTask`, `getTask`, `setTaskNotes`, `setTaskDue`, `setTaskPriority`.

This task changes no behaviour. It is the move plus two new primitives, and the existing 17 repo tests passing **untouched** is what proves the move was faithful.

- [ ] **Step 1: Create `write.ts` with the primitives, moved verbatim**

Create `app/src/lib/repo/write.ts`. The bodies of `now`, `pick`, `create` and `write` are copied **exactly** from `src/lib/repo.ts` lines 24–101 — do not improve them while moving; a behaviour change hidden in a move is the one thing this task must not do. Only the import paths gain a `../`, and `create`/`write` gain `export`.

```ts
/**
 * The write primitives — the only place in the app that opens a transaction.
 *
 * SPEC §9.1 calls the atomicity of "row plus outbox entry" the single most
 * important detail in the sync engine, so it is enforced in one file rather
 * than trusted to every call site.
 *
 * P1's pull deliberately does NOT use these: rows arriving from the server
 * must not be enqueued straight back at it.
 */
import { db } from '../db'
import { appendOutbox } from '../outbox'
import { clientId } from '../device'
import type { TableName } from '../schema'
import type { UndoStep } from '../undo'

/**
 * SPEC §9.4: the client's wall clock never resolves a conflict — the server
 * stamps `updated_at` on push. This is the provisional local value, which P1's
 * pull will overwrite with the server's.
 */
export function now(): string {
  return new Date().toISOString()
}

/** The previous values of just the columns an edit is about to change. */
function pick(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]))
}

export async function create<T extends { id: string }>(
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

export async function write(
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

- [ ] **Step 2: Add the two new primitives to `write.ts`**

Append to `app/src/lib/repo/write.ts`:

```ts
/**
 * Several writes in one transaction.
 *
 * Dexie joins an inner transaction to an outer one when the inner scope is a
 * subset, so `create` and `write` called inside this become part of one
 * all-or-nothing write rather than opening their own. `write.test.ts` proves
 * that rather than trusting it.
 *
 * `db.outbox` is always in scope: no write reaches the database without it.
 */
export function batch<T>(
  tables: TableName[],
  body: () => Promise<T>,
): Promise<T> {
  return db.transaction(
    'rw',
    [...tables.map((table) => db.table(table)), db.outbox],
    body,
  )
}

/**
 * Several writes, one undo step.
 *
 * Reversed newest-first, which is the order a person expects and the only
 * order that is safe: a section delete moves tasks and then tombstones the
 * section, so undoing it must restore the section before the tasks move back.
 *
 * Nulls are accepted so callers stay one line — `write` returns null for a row
 * that was already gone, and that is not a reason to lose the whole step.
 *
 * This is not one transaction, on purpose. SPEC §4.5: an undo is "reapplied as
 * an ordinary new mutation", so each write here is atomic with its own outbox
 * entry, exactly like the writes it reverses.
 */
export function composite(
  label: string,
  steps: (UndoStep | null)[],
  toast = false,
): UndoStep {
  const real = steps.filter((step): step is UndoStep => step !== null)
  return {
    label,
    toast,
    apply: async () => {
      for (const step of [...real].reverse()) await step.apply()
    },
  }
}
```

- [ ] **Step 3: Create `positions.ts`**

Create `app/src/lib/repo/positions.ts`:

```ts
/**
 * Where a task lands when it arrives in a section.
 *
 * Its own file because both `tasks.ts` and `sections.ts` need it — completing
 * a task, and moving tasks out of a section being deleted — while `tasks.ts`
 * already imports `sections.ts`. Putting it in either would be an import
 * cycle.
 *
 * SPEC §4.2: positions are one fractional-index space per workspace. Ordering
 * only ever matters *within* a section, and an append always derives from that
 * section's own last key, so keys within a section stay distinct even though
 * two tasks in different sections may compare in any order.
 */
import { db } from '../db'
import { generateKeyBetween } from '../fractional-indexing'

export async function appendPositionIn(sectionId: string): Promise<string> {
  const tasks = await db.tasks.toArray()
  const positions = tasks
    .filter((task) => task.section_id === sectionId && task.deleted_at === null)
    .map((task) => task.position)
    .sort()
  return generateKeyBetween(positions.at(-1) ?? null, null)
}
```

- [ ] **Step 4: Create `tasks.ts` from the rest of `repo.ts`**

Create `app/src/lib/repo/tasks.ts` holding everything `src/lib/repo.ts` had below the primitives — `listTasks`, `addTask`, `setTaskDone`, `renameTask`, `deleteTask`, `getTask`, `setTaskNotes`, `setTaskDue`, `setTaskPriority` — copied verbatim, with these import lines at the top:

```ts
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { create, write, now } from './write'
import type { Task } from '../schema'
import type { UndoStep } from '../undo'
```

Keep every doc comment with the function it belongs to. `appendPositionIn` is not used yet — Task 5 brings it in.

- [ ] **Step 5: Create `index.ts`**

Create `app/src/lib/repo/index.ts`:

```ts
/**
 * The repository layer — the only path by which anything writes.
 *
 * SPEC §13, P0b constraint: "every write in P0b goes through a repository
 * layer that writes the row and appends an outbox entry in one transaction
 * (§9.1) ... Skip this and P1 rewrites every write path in the app — which is
 * the single most common way local-first projects stall."
 *
 * Re-exports only. `write.ts`'s primitives are deliberately not among them:
 * outside this directory, a caller should never be able to write a row without
 * going through a named mutation.
 */
export * from './tasks'
```

- [ ] **Step 6: Delete `repo.ts` and run the existing tests untouched**

```bash
rm src/lib/repo.ts
npm test
```

Expected: PASS, 68 tests. `src/lib/repo.test.ts` still imports `from './repo'`, which now resolves to `./repo/index.ts` (`moduleResolution: "bundler"`). **Do not edit that test file to make it pass** — it passing as it stands is the whole proof the move was faithful. If it fails, the move is wrong; fix the move.

- [ ] **Step 7: Write the batch atomicity test**

Create `app/src/lib/repo/write.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import { batch, create, write, composite, now } from './write'

function projectRow(id: string) {
  const { workspaceId } = activeWorkspace()
  return {
    id,
    workspace_id: workspaceId,
    name: 'Temporary',
    color: null,
    icon: null,
    position: 'a5',
    archived_at: null,
    updated_at: now(),
    deleted_at: null,
    client_id: 'test',
  }
}

describe('write primitives', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    await db.outbox.clear()
  })

  // The whole design of `addProject` and `deleteSection` rests on Dexie
  // joining an inner transaction to an outer one. If it ever stops doing
  // that, a half-built project reaches the database and this test says so.
  it('rolls back both the row and its outbox entry when a batch fails', async () => {
    await expect(
      batch(['projects'], async () => {
        await create('projects', projectRow('roll-me-back'), 'Project added')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await db.projects.get('roll-me-back')).toBeUndefined()
    const entries = await db.outbox
      .where('[table+row_id]')
      .equals(['projects', 'roll-me-back'])
      .toArray()
    expect(entries).toHaveLength(0)
  })

  it('commits every row in a batch that succeeds', async () => {
    await batch(['projects'], async () => {
      await create('projects', projectRow('one'), 'Project added')
      await create('projects', projectRow('two'), 'Project added')
    })

    expect(await db.projects.get('one')).toBeDefined()
    expect(await db.projects.get('two')).toBeDefined()
  })

  it('reverses a composite step newest-first', async () => {
    const order: string[] = []
    const step = composite('Batch', [
      { label: 'a', toast: false, apply: async () => void order.push('a') },
      { label: 'b', toast: false, apply: async () => void order.push('b') },
    ])

    await step.apply()

    expect(order).toEqual(['b', 'a'])
  })

  it('ignores nulls among a composite step\'s parts', async () => {
    await create('projects', projectRow('keep'), 'Project added')
    const step = composite('Batch', [
      null,
      await write('projects', 'keep', { name: 'Renamed' }, 'Renamed'),
      await write('projects', 'missing', { name: 'Nope' }, 'Renamed'),
    ])

    await step.apply()

    expect((await db.projects.get('keep'))?.name).toBe('Temporary')
  })
})
```

- [ ] **Step 8: Run the new tests**

```bash
npx vitest run src/lib/repo/write.test.ts
```
Expected: PASS, 4 tests. If the first one fails, Dexie is not nesting transactions the way this design assumes — **stop and report it**, because Tasks 3 and 4 both depend on it.

- [ ] **Step 9: Move the task tests alongside their code**

```bash
git mv src/lib/repo.test.ts src/lib/repo/tasks.test.ts
```

Then in `src/lib/repo/tasks.test.ts` change exactly two import lines:

```ts
import { db } from '../db'
```
```ts
import { activeWorkspace } from '../workspace'
```

and the repo import, which keeps naming the directory rather than a file inside it:

```ts
import {
  addTask, setTaskDone, renameTask, deleteTask, listTasks,
  getTask, setTaskNotes, setTaskDue, setTaskPriority,
} from './index'
```

- [ ] **Step 10: Verify the whole suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 72 tests (68 + 4); build clean; lint clean.

- [ ] **Step 11: Commit**

```bash
git add -A src/lib
git commit -m "$(cat <<'EOF'
refactor: repo.ts becomes repo/, with a batch and a composite undo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `nav.ts` — the open project

**Files:**
- Create: `app/src/lib/nav.ts`, `app/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: `activeWorkspace()` from `src/lib/workspace.ts`, which returns `{ workspaceId, projectId, sectionId, doneSectionId }` — `projectId` is the pinned Inbox project.
- Produces:
  - `type Route = { kind: 'project'; projectId: string }`
  - `subscribe(listener: () => void): () => void`
  - `getRoute(): Route`
  - `openProject(projectId: string): void`
  - `resolveProject(projects: Project[], current: Route): string`

`resolveProject` is pure and separate from the store on purpose: "the stored project no longer exists" and "the stored project was just archived" are the same question, and answering it against a list the component already has avoids making the store async or teaching it about Dexie.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/nav.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getRoute, openProject, resolveProject, subscribe } from './nav'
import { activeWorkspace } from './workspace'
import type { Project } from './schema'

const inbox = activeWorkspace().projectId

function project(id: string): Project {
  return {
    id,
    workspace_id: activeWorkspace().workspaceId,
    name: id,
    color: null,
    icon: null,
    position: 'a0',
    archived_at: null,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

describe('nav', () => {
  beforeEach(() => {
    localStorage.clear()
    openProject(inbox)
  })

  it('opens the Inbox project by default', () => {
    expect(getRoute()).toEqual({ kind: 'project', projectId: inbox })
  })

  it('remembers the open project across a reload', () => {
    openProject('some-project')
    // What a fresh tab would read: the module reloads and re-reads storage.
    expect(localStorage.getItem('lane.route')).toBe('some-project')
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openProject('a')
    openProject('b')
    unsubscribe()
    openProject('c')

    expect(calls).toBe(2)
  })

  it('does not notify when the same project is opened twice', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openProject('a')
    openProject('a')
    unsubscribe()

    // useSyncExternalStore re-reads on every emit; a no-op change should not
    // cost the whole list a render.
    expect(calls).toBe(1)
  })

  it('resolves to the open project when it still exists', () => {
    const projects = [project(inbox), project('work')]
    expect(resolveProject(projects, { kind: 'project', projectId: 'work' }))
      .toBe('work')
  })

  it('falls back to Inbox when the open project is gone or archived', () => {
    // `listProjects` excludes both deleted and archived projects, so this one
    // branch covers "deleted on another device" and "archived a moment ago".
    const projects = [project(inbox)]
    expect(resolveProject(projects, { kind: 'project', projectId: 'work' }))
      .toBe(inbox)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/nav.test.ts
```
Expected: FAIL — cannot find module `./nav`.

- [ ] **Step 3: Write `nav.ts`**

Create `app/src/lib/nav.ts`:

```ts
/**
 * Where you are.
 *
 * SPEC §11.3 rule 2 — "prefer ~40 lines you own to a package" — already
 * rejected React Router once. This is the same shape as `undo.ts`: a
 * framework-free module singleton, read through `useSyncExternalStore`.
 *
 * Persisted, so reopening the installed app returns you to the project you
 * were in rather than to a default. Slice 4 widens `Route` to a union with
 * `{ kind: 'today' }` and the drawer grows a group above the project list;
 * nothing else moves.
 */
import { activeWorkspace } from './workspace'
import type { Project } from './schema'

const KEY = 'lane.route'

export type Route = { kind: 'project'; projectId: string }

function load(): Route {
  return {
    kind: 'project',
    projectId: localStorage.getItem(KEY) ?? activeWorkspace().projectId,
  }
}

let route: Route = load()
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Returns the same object until the route actually changes.
 * `useSyncExternalStore` compares by identity and would loop forever on a
 * fresh object every call.
 */
export function getRoute(): Route {
  return route
}

export function openProject(projectId: string): void {
  if (route.kind === 'project' && route.projectId === projectId) return
  route = { kind: 'project', projectId }
  localStorage.setItem(KEY, projectId)
  for (const listener of listeners) listener()
}

/**
 * The project to actually show, given what is stored and what exists.
 *
 * Pure, and given the list the caller already has, so that "deleted on another
 * device" and "archived a moment ago" resolve through one branch: both simply
 * stop appearing in `listProjects`.
 */
export function resolveProject(projects: Project[], current: Route): string {
  const exists = projects.some((p) => p.id === current.projectId)
  return exists ? current.projectId : activeWorkspace().projectId
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/nav.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the build**

```bash
npm test && npm run build
```
Expected: PASS, 78 tests; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "$(cat <<'EOF'
feat: the open project, persisted, without a router

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Projects

**Files:**
- Create: `app/src/lib/repo/projects.ts`, `app/src/lib/repo/projects.test.ts`
- Modify: `app/src/lib/repo/index.ts`

**Interfaces:**
- Consumes: `create`, `write`, `composite`, `batch`, `now` from `./write`; `sectionRowsFor(projectId: string): [Section, Section]` from `./sections` (Task 4 writes that file — **Task 3 writes a minimal version of it first, in Step 3 below**, and Task 4 fills it out).
- Produces:
  - `listProjects(): Promise<Project[]>` — live, non-archived, position order
  - `getProject(id: string): Promise<Project | undefined>`
  - `addProject(name: string): Promise<{ id: string; undo: UndoStep }>`
  - `renameProject(id: string, name: string): Promise<UndoStep | null>`
  - `archiveProject(id: string): Promise<UndoStep | null>`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/repo/projects.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import {
  listProjects, getProject, addProject, renameProject, archiveProject,
} from './index'

describe('projects', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    // The v2 migration seeds the Inbox project and its two sections.
    await db.outbox.clear()
  })

  it('creates a project with its two sections', async () => {
    const { id } = await addProject('Work')

    const sections = await db.sections
      .filter((s) => s.project_id === id)
      .toArray()
    // SPEC §4: "each project has exactly one section flagged is_done_section".
    expect(sections).toHaveLength(2)
    expect(sections.filter((s) => s.is_done_section)).toHaveLength(1)
  })

  it('enqueues the project before the sections that reference it', async () => {
    const { id } = await addProject('Work')
    const entries = await db.outbox.toArray()

    // SPEC §9.2: seq is the push order, and a section cannot arrive first.
    const project = entries.find((e) => e.row_id === id)
    const sections = entries.filter((e) => e.table === 'sections')
    expect(entries).toHaveLength(3)
    expect(project).toBeDefined()
    for (const section of sections) {
      expect(section.seq).toBeGreaterThan(project!.seq)
    }
  })

  it('undoes a creation by tombstoning all three rows', async () => {
    const { id, undo } = await addProject('Work')

    await undo.apply()

    expect((await db.projects.get(id))?.deleted_at).not.toBeNull()
    const sections = await db.sections
      .filter((s) => s.project_id === id)
      .toArray()
    expect(sections.every((s) => s.deleted_at !== null)).toBe(true)
  })

  it('refuses a project with no name', async () => {
    await expect(addProject('   ')).rejects.toThrow()
  })

  it('renames a project, and ignores an empty rename', async () => {
    const { id } = await addProject('Wrok')

    await renameProject(id, 'Work')
    expect((await getProject(id))?.name).toBe('Work')

    expect(await renameProject(id, '  ')).toBeNull()
    expect((await getProject(id))?.name).toBe('Work')
  })

  it('archives a project out of the list, and undo brings it back', async () => {
    const { id } = await addProject('Work')
    expect((await listProjects()).map((p) => p.id)).toContain(id)

    const undo = await archiveProject(id)
    expect((await listProjects()).map((p) => p.id)).not.toContain(id)

    await undo!.apply()
    expect((await listProjects()).map((p) => p.id)).toContain(id)
  })

  it('offers to undo an archive with a toast, since it leaves the drawer', async () => {
    const { id } = await addProject('Work')
    const undo = await archiveProject(id)
    expect(undo?.toast).toBe(true)
  })

  it('lists projects in position order and hides tombstones', async () => {
    const { id: first } = await addProject('Aaa')
    const { id: second } = await addProject('Bbb')
    await db.projects.update(first, { deleted_at: new Date().toISOString() })

    const ids = (await listProjects()).map((p) => p.id)
    expect(ids).not.toContain(first)
    expect(ids.at(-1)).toBe(second)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/repo/projects.test.ts
```
Expected: FAIL — `listProjects` is not exported.

- [ ] **Step 3: Write the section rows helper**

Create `app/src/lib/repo/sections.ts` with just this much for now — Task 4 adds the rest:

```ts
/**
 * Sections. SPEC §4: "Sections belong to a project", and each project has
 * exactly one flagged `is_done_section`.
 */
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { now } from './write'
import { uuidv7 } from '../ids'
import type { Section } from '../schema'

/**
 * The two sections every project is born with.
 *
 * The names match what `db.ts`'s `seedWorkspace` gives the Inbox project, so a
 * project the user creates and the project the migration created are the same
 * shape.
 */
export function sectionRowsFor(projectId: string): [Section, Section] {
  const { workspaceId } = activeWorkspace()
  const sync = {
    workspace_id: workspaceId,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }
  const first = generateKeyBetween(null, null)
  return [
    {
      id: uuidv7(),
      project_id: projectId,
      name: 'Tasks',
      position: first,
      is_done_section: false,
      ...sync,
    },
    {
      id: uuidv7(),
      project_id: projectId,
      name: 'Done',
      position: generateKeyBetween(first, null),
      is_done_section: true,
      ...sync,
    },
  ]
}
```

- [ ] **Step 4: Write `projects.ts`**

Create `app/src/lib/repo/projects.ts`:

```ts
/**
 * Projects. SPEC §4.4 decides what happens when one goes away: archiving is
 * "the safe default the UI should nudge toward" and is what this slice ships;
 * deleting cascades to sections, tasks and checklist items and gets its own
 * slice with a confirm.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { create, write, composite, batch, now } from './write'
import { sectionRowsFor } from './sections'
import type { Project } from '../schema'
import type { UndoStep } from '../undo'

/** What the drawer shows: live, not archived, in order. */
export async function listProjects(): Promise<Project[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.projects
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((p) => p.deleted_at === null && p.archived_at === null)
}

export function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}

/**
 * SPEC §4: a project is never created alone — it has exactly one done section
 * from the moment it exists, or the binding has nowhere to move tasks to.
 *
 * The three rows go in one transaction and come back as one undo step. The
 * order matters beyond tidiness: SPEC §9.2 makes seq the push order, and the
 * project cannot arrive after the sections that reference it.
 */
export async function addProject(
  name: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('refusing to create a project with no name')

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()
  const last = await db.projects
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .last()

  const project: Project = {
    id,
    workspace_id: workspaceId,
    name: trimmed,
    color: null,
    icon: null,
    position: generateKeyBetween(last?.position ?? null, null),
    archived_at: null,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }
  const [tasks, done] = sectionRowsFor(id)

  const steps = await batch(['projects', 'sections'], async () => [
    await create('projects', project, 'Project added'),
    await create('sections', tasks, 'Project added'),
    await create('sections', done, 'Project added'),
  ])

  return { id, undo: composite('Project added', steps) }
}

export function renameProject(
  id: string,
  name: string,
): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('projects', id, { name: trimmed }, 'Project renamed')
}

/**
 * SPEC §4.4: "nothing is deleted; it leaves the sidebar". A toast, because
 * leaving the sidebar is exactly the kind of disappearance §4.5's undo exists
 * for.
 */
export function archiveProject(id: string): Promise<UndoStep | null> {
  return write('projects', id, { archived_at: now() }, 'Project archived', true)
}
```

- [ ] **Step 5: Export them**

In `app/src/lib/repo/index.ts`, add below the tasks line:

```ts
export * from './projects'
export * from './sections'
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/lib/repo/projects.test.ts
```
Expected: PASS, 8 tests.

- [ ] **Step 7: Verify the whole suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 86 tests; build clean; lint clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/repo
git commit -m "$(cat <<'EOF'
feat: projects, born with their done section

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Sections, and §4.4's rules

**Files:**
- Modify: `app/src/lib/repo/sections.ts`
- Create: `app/src/lib/repo/sections.test.ts`

**Interfaces:**
- Consumes: `create`, `write`, `composite`, `batch`, `now` from `./write`; `appendPositionIn(sectionId: string): Promise<string>` from `./positions`.
- Produces:
  - `sectionRowsFor(projectId: string): [Section, Section]` (already written in Task 3)
  - `listSections(projectId: string): Promise<Section[]>` — live, position order
  - `getSection(id: string): Promise<Section | undefined>`
  - `doneSectionOf(projectId: string): Promise<Section>`
  - `firstOpenSectionOf(projectId: string): Promise<Section>`
  - `addSection(projectId: string, name: string): Promise<{ id: string; undo: UndoStep }>`
  - `renameSection(id: string, name: string): Promise<UndoStep | null>`
  - `deleteSection(id: string): Promise<UndoStep>`

SPEC §4.4, verbatim, is what this task implements:

> **Delete a section** → its tasks move to the project's first remaining section, they are *not* deleted. A section is a status label, and losing a status should never lose the work. A project therefore always has at least one section, and deleting the last one is refused.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/repo/sections.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { activeWorkspace } from '../workspace'
import {
  listSections, getSection, addSection, renameSection, deleteSection,
  doneSectionOf, firstOpenSectionOf, addTask, getTask,
} from './index'

const inbox = activeWorkspace().projectId

describe('sections', () => {
  beforeEach(async () => {
    if (db.isOpen()) db.close()
    await db.delete()
    await db.open()
    await db.outbox.clear()
  })

  it('lists a project\'s live sections in position order', async () => {
    await addSection(inbox, 'This weekend')
    const names = (await listSections(inbox)).map((s) => s.name)
    expect(names).toEqual(['Tasks', 'Done', 'This weekend'])
  })

  it('finds the done section and the first open section', async () => {
    expect((await doneSectionOf(inbox)).is_done_section).toBe(true)
    expect((await firstOpenSectionOf(inbox)).name).toBe('Tasks')
  })

  it('appends a new section and undoes it by tombstoning', async () => {
    const { id, undo } = await addSection(inbox, 'This weekend')
    expect((await getSection(id))?.name).toBe('This weekend')

    await undo.apply()
    expect((await getSection(id))?.deleted_at).not.toBeNull()
    expect((await listSections(inbox)).map((s) => s.id)).not.toContain(id)
  })

  it('ignores an empty rename', async () => {
    const { id } = await addSection(inbox, 'Weekend')
    expect(await renameSection(id, '   ')).toBeNull()
    expect((await getSection(id))?.name).toBe('Weekend')
  })

  // SPEC §4.4: "its tasks move to the project's first remaining section, they
  // are *not* deleted. A section is a status label, and losing a status should
  // never lose the work."
  it('moves a deleted section\'s tasks into the first remaining section', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id: task } = await addTask('clear the shed', inbox)
    await db.tasks.update(task, { section_id: weekend })

    await deleteSection(weekend)

    const moved = await getTask(task)
    expect(moved?.deleted_at).toBeNull()
    expect(moved?.section_id).toBe((await firstOpenSectionOf(inbox)).id)
    expect((await getSection(weekend))?.deleted_at).not.toBeNull()
  })

  it('undoes a section delete by restoring the section and the tasks', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id: task } = await addTask('clear the shed', inbox)
    await db.tasks.update(task, { section_id: weekend })

    const undo = await deleteSection(weekend)
    await undo.apply()

    expect((await getSection(weekend))?.deleted_at).toBeNull()
    expect((await getTask(task))?.section_id).toBe(weekend)
  })

  it('offers to undo a section delete with a toast', async () => {
    const { id } = await addSection(inbox, 'This weekend')
    expect((await deleteSection(id)).toast).toBe(true)
  })

  // SPEC §4: exactly one done section per project.
  it('refuses to delete the done section', async () => {
    const done = await doneSectionOf(inbox)
    await expect(deleteSection(done.id)).rejects.toThrow(/done section/)
  })

  // SPEC §4.4: "deleting the last one is refused".
  it('refuses to delete the last open section', async () => {
    const open = await firstOpenSectionOf(inbox)
    await expect(deleteSection(open.id)).rejects.toThrow(/at least one/)
  })

  it('refuses to delete a section that is not there', async () => {
    await expect(deleteSection('no-such-section')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/repo/sections.test.ts
```
Expected: FAIL — `listSections` is not exported. (`addTask(title, projectId)` gains its second parameter in Task 5; until then TypeScript flags it in this file, and `npm test` still runs because Vitest does not typecheck. That is expected and Task 5 clears it — do not "fix" it by dropping the argument.)

- [ ] **Step 3: Write the rest of `sections.ts`**

Append to `app/src/lib/repo/sections.ts` (keeping `sectionRowsFor` from Task 3, and adding these to its imports — no
`MIN_KEY`/`MAX_KEY`, since `listSections` queries by project rather than by
position range, and an unused import fails `npm run lint`):

```ts
import { db } from '../db'
import { create, write, composite, batch } from './write'
import { appendPositionIn } from './positions'
import type { UndoStep } from '../undo'
```


```ts
/**
 * Live sections of one project, in position order.
 *
 * Sorted in memory because the `[workspace_id+project_id]` index does not
 * carry position — one index that answers "which sections" is enough for a
 * handful of rows, and a second one would be a second thing to keep correct.
 *
 * Deliberately does NOT force the done section last: `groupBySection` owns
 * display order, and two places enforcing one rule is how they drift apart.
 */
export async function listSections(projectId: string): Promise<Section[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.sections
    .where('[workspace_id+project_id]')
    .equals([workspaceId, projectId])
    .toArray()
  return rows
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
}

export function getSection(id: string): Promise<Section | undefined> {
  return db.sections.get(id)
}

/** SPEC §4: every project has exactly one. Its absence is broken data. */
export async function doneSectionOf(projectId: string): Promise<Section> {
  const section = (await listSections(projectId)).find((s) => s.is_done_section)
  if (section === undefined) {
    throw new Error(`project ${projectId} has no done section`)
  }
  return section
}

/** SPEC §4.4 refuses to delete the last one, so this always finds one. */
export async function firstOpenSectionOf(projectId: string): Promise<Section> {
  const section = (await listSections(projectId)).find((s) => !s.is_done_section)
  if (section === undefined) {
    throw new Error(`project ${projectId} has no open section`)
  }
  return section
}

/** Appends after the last section, which keeps Done at the foot. */
export async function addSection(
  projectId: string,
  name: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('refusing to create a section with no name')

  const sections = await listSections(projectId)
  const row: Section = {
    id: uuidv7(),
    workspace_id: activeWorkspace().workspaceId,
    project_id: projectId,
    name: trimmed,
    position: generateKeyBetween(sections.at(-1)?.position ?? null, null),
    is_done_section: false,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }

  return { id: row.id, undo: await create('sections', row, 'Section added') }
}

export function renameSection(
  id: string,
  name: string,
): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('sections', id, { name: trimmed }, 'Section renamed')
}

/**
 * SPEC §4.4: "its tasks move to the project's first remaining section, they
 * are *not* deleted. A section is a status label, and losing a status should
 * never lose the work."
 *
 * Both refusals come from the same paragraph: a project keeps exactly one done
 * section (§4) and at least one open one, "and deleting the last one is
 * refused".
 *
 * The task moves do not go through the §4 binding, and do not need to: neither
 * the section being emptied nor the one receiving its tasks can be a done
 * section, so no task's `completed_at` changes.
 */
export async function deleteSection(id: string): Promise<UndoStep> {
  const section = await getSection(id)
  if (section === undefined || section.deleted_at !== null) {
    throw new Error(`no such section: ${id}`)
  }
  if (section.is_done_section) {
    throw new Error('the done section cannot be deleted')
  }

  const remaining = (await listSections(section.project_id)).filter(
    (s) => !s.is_done_section && s.id !== id,
  )
  if (remaining.length === 0) {
    throw new Error('a project needs at least one open section')
  }
  const target = remaining[0]

  const orphans = (await db.tasks.toArray()).filter(
    (t) => t.section_id === id && t.deleted_at === null,
  )

  const steps = await batch(['sections', 'tasks'], async () => {
    const moves: (UndoStep | null)[] = []
    for (const task of orphans) {
      moves.push(
        await write(
          'tasks',
          task.id,
          { section_id: target.id, position: await appendPositionIn(target.id) },
          'Section deleted',
        ),
      )
    }
    // The section goes last, so undoing newest-first restores it before the
    // tasks move back into it.
    moves.push(await write('sections', id, { deleted_at: now() }, 'Section deleted'))
    return moves
  })

  return composite('Section deleted', steps, true)
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/repo/sections.test.ts
```
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify the suite**

```bash
npm test
```
Expected: PASS, 96 tests. `npm run build` will **fail** here on `addTask('…', inbox)` taking two arguments — Task 5 is what adds the parameter, and this is the one commit in the plan that lands with a known type error. If you would rather not commit a red build, do Tasks 4 and 5 as one commit.

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo/sections.ts src/lib/repo/sections.test.ts
git commit -m "$(cat <<'EOF'
feat: sections, and SPEC 4.4's rules for deleting one

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tasks scoped to a project, and the §4 binding

**Files:**
- Modify: `app/src/lib/repo/tasks.ts`, `app/src/lib/repo/tasks.test.ts`, `app/src/components/TaskList.tsx`, `app/src/components/QuickAdd.tsx`

**Interfaces:**
- Consumes: `doneSectionOf`, `firstOpenSectionOf`, `getSection` from `./sections`; `appendPositionIn` from `./positions`; `getRoute`, `subscribe` from `../lib/nav`.
- Produces:
  - `listTasks(projectId: string): Promise<Task[]>` — **signature change**
  - `addTask(title: string, projectId: string): Promise<{ id: string; undo: UndoStep }>` — **signature change**
  - `setTaskDone(id: string, done: boolean): Promise<UndoStep | null>` — now moves the task
  - `setTaskSection(id: string, sectionId: string): Promise<UndoStep | null>`
  - `setTaskProject(id: string, projectId: string): Promise<UndoStep | null>`

The two signature changes break `TaskList.tsx` and `QuickAdd.tsx`, which is why their call sites are updated in this same task — every commit in this plan leaves the build green except Task 4's.

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/repo/tasks.test.ts`, inside the existing `describe('repo', …)` block:

```ts
  it('scopes the list to one project', async () => {
    const { id: other } = await addProject('Work')
    const { id: here } = await addTask('mow the lawn', inbox)
    const { id: there } = await addTask('email the accountant', other)

    const ids = (await listTasks(inbox)).map((t) => t.id)
    expect(ids).toContain(here)
    expect(ids).not.toContain(there)
  })

  it('adds a task into the project\'s first open section', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(inbox)).id,
    )
  })

  // SPEC §4: "completed_at and section_id are always written together, never
  // independently."
  it('moves a completed task into the done section, in one outbox entry', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    await db.outbox.clear()

    await setTaskDone(id, true)

    const task = await getTask(id)
    expect(task?.completed_at).not.toBeNull()
    expect(task?.section_id).toBe((await doneSectionOf(inbox)).id)

    const [entry] = await entriesFor(id)
    expect(entry.columns).toContain('completed_at')
    expect(entry.columns).toContain('section_id')
    expect(entry.columns).toContain('position')
  })

  it('undoes a completion back to the exact section and position', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id } = await addTask('clear the shed', inbox)
    await setTaskSection(id, weekend)
    const before = await getTask(id)

    const undo = await setTaskDone(id, true)
    await undo!.apply()

    const after = await getTask(id)
    expect(after?.section_id).toBe(weekend)
    expect(after?.position).toBe(before?.position)
    expect(after?.completed_at).toBeNull()
  })

  it('sends a manual uncheck to the first open section', async () => {
    const { id: weekend } = await addSection(inbox, 'This weekend')
    const { id } = await addTask('clear the shed', inbox)
    await setTaskSection(id, weekend)
    await setTaskDone(id, true)

    await setTaskDone(id, false)

    // Nothing on the row remembers where it was; only undo restores that.
    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(inbox)).id,
    )
  })

  it('offers a toast on completion but not on reopening', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    expect((await setTaskDone(id, true))?.toast).toBe(true)
    expect((await setTaskDone(id, false))?.toast).toBe(false)
  })

  // The binding is two-way: the Section picker is the non-drag equivalent of
  // dragging a task into the done column.
  it('completes a task moved into the done section by the picker', async () => {
    const { id } = await addTask('mow the lawn', inbox)

    await setTaskSection(id, (await doneSectionOf(inbox)).id)

    expect((await getTask(id))?.completed_at).not.toBeNull()
  })

  it('reopens a task moved out of the done section by the picker', async () => {
    const { id } = await addTask('mow the lawn', inbox)
    await setTaskDone(id, true)

    await setTaskSection(id, (await firstOpenSectionOf(inbox)).id)

    expect((await getTask(id))?.completed_at).toBeNull()
  })

  it('keeps the original completion time when a done task moves', async () => {
    const { id: other } = await addProject('Work')
    const { id } = await addTask('mow the lawn', inbox)
    await setTaskDone(id, true)
    const completedAt = (await getTask(id))?.completed_at

    await setTaskProject(id, other)

    const moved = await getTask(id)
    // P2's completed log should read when the work was finished, not when the
    // row was last touched.
    expect(moved?.completed_at).toBe(completedAt)
    expect(moved?.project_id).toBe(other)
    expect(moved?.section_id).toBe((await doneSectionOf(other)).id)
  })

  it('moves an open task to the target project\'s first open section', async () => {
    const { id: other } = await addProject('Work')
    const { id } = await addTask('mow the lawn', inbox)

    await setTaskProject(id, other)

    expect((await getTask(id))?.section_id).toBe(
      (await firstOpenSectionOf(other)).id,
    )
  })
```

Extend that file's import block to:

```ts
import {
  addTask, setTaskDone, renameTask, deleteTask, listTasks,
  getTask, setTaskNotes, setTaskDue, setTaskPriority,
  setTaskSection, setTaskProject,
  addProject, addSection, doneSectionOf, firstOpenSectionOf,
} from './index'
```

and add below it:

```ts
const inbox = activeWorkspace().projectId
```

Then update the six existing `await addTask('…')` calls in that file to `await addTask('…', inbox)`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/repo/tasks.test.ts
```
Expected: FAIL — `setTaskSection` is not exported.

- [ ] **Step 3: Rewrite the task mutations**

In `app/src/lib/repo/tasks.ts`, extend the imports:

```ts
import { doneSectionOf, firstOpenSectionOf, getSection } from './sections'
import { appendPositionIn } from './positions'
import type { Section } from '../schema'
```

Replace `listTasks` and `addTask`'s signature, and replace `setTaskDone` entirely:

```ts
/** Rows the list view shows: not deleted, in this project, in order. */
export async function listTasks(projectId: string): Promise<Task[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // Filtered rather than indexed by project: slice 4's Today and Upcoming span
  // every project and want this same workspace-wide read, so a second index
  // would be a second thing to keep correct for no measured gain.
  return rows.filter((t) => t.deleted_at === null && t.project_id === projectId)
}

export async function addTask(
  title: string,
  projectId: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a task with no title')

  const { workspaceId } = activeWorkspace()
  const section = await firstOpenSectionOf(projectId)
  const id = uuidv7()

  const row: Task = {
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    section_id: section.id,
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
    position: await appendPositionIn(section.id),
    created_by: null,
    assignee_id: null,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }

  return { id, undo: await create('tasks', row, 'Task added') }
}

/**
 * The §4 binding, in one place. Nothing else writes these three columns.
 *
 * SPEC §4: "checking a task's checkbox moves it into that section, and
 * dragging a task into that section checks its checkbox. `completed_at` and
 * `section_id` are always written together, never independently." Both public
 * entry points below route through here, so the two halves cannot disagree —
 * and the drag slice adds a third caller rather than a fourth copy of the rule.
 */
async function moveTaskTo(
  task: Task,
  target: Section,
  label: string,
  toast: boolean,
  extra: Record<string, unknown> = {},
): Promise<UndoStep | null> {
  return write(
    'tasks',
    task.id,
    {
      ...extra,
      // Landing in the done section completes the task; leaving it reopens it.
      // An existing timestamp is kept, so P2's completed log reads the moment
      // the work was finished rather than the last time the row was touched.
      completed_at: target.is_done_section ? (task.completed_at ?? now()) : null,
      section_id: target.id,
      position: await appendPositionIn(target.id),
    },
    label,
    toast,
  )
}

/**
 * A toast, because this is the one completion path that takes its result off
 * the screen — the task leaves the section you were looking at. Reopening does
 * not: the task appears in the first open section, in view.
 */
export async function setTaskDone(
  id: string,
  done: boolean,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  if (task === undefined) return null
  const target = done
    ? await doneSectionOf(task.project_id)
    : await firstOpenSectionOf(task.project_id)
  return moveTaskTo(
    task,
    target,
    done ? 'Task completed' : 'Task reopened',
    done,
  )
}

/** The sheet's Section picker — the non-drag half of §4's binding. */
export async function setTaskSection(
  id: string,
  sectionId: string,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null
  return moveTaskTo(task, target, 'Task moved', target.is_done_section)
}

/**
 * A `section_id` from the old project would orphan the row, so the task lands
 * in the target project's done section if it was complete and its first open
 * section otherwise — which keeps §4's rule true across the move.
 */
export async function setTaskProject(
  id: string,
  projectId: string,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  if (task === undefined) return null
  const target =
    task.completed_at !== null
      ? await doneSectionOf(projectId)
      : await firstOpenSectionOf(projectId)
  return moveTaskTo(task, target, 'Task moved', false, { project_id: projectId })
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/repo
```
Expected: PASS — 4 (write) + 8 (projects) + 10 (sections) + 27 (tasks: 17 existing + 10 new) = 49 in the directory.

- [ ] **Step 5: Update the two call sites**

In `app/src/components/TaskList.tsx`, add the nav import and pass the project through:

```tsx
import { useSyncExternalStore } from 'react'
import { subscribe, getRoute } from '../lib/nav'
```
```tsx
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const tasks = useLiveQuery(() => listTasks(route.projectId), [route.projectId])
```

In `app/src/components/QuickAdd.tsx`, the same:

```tsx
import { useSyncExternalStore } from 'react'
import { subscribe, getRoute } from '../lib/nav'
```
```tsx
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
```
```tsx
    const { undo } = await addTask(value, route.projectId)
```

- [ ] **Step 6: Verify the whole suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 106 tests; build clean; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/repo src/components/TaskList.tsx src/components/QuickAdd.tsx
git commit -m "$(cat <<'EOF'
feat: the done binding — completing a task moves it into Done

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `grouping.ts`

**Files:**
- Create: `app/src/lib/grouping.ts`, `app/src/lib/grouping.test.ts`

**Interfaces:**
- Produces:
  - `interface SectionGroup { section: Section; tasks: Task[] }`
  - `groupBySection(sections: Section[], tasks: Task[]): SectionGroup[]`

Pure, so §4.4's orphan rule is testable without a DOM:

> **A task arrives referencing a section deleted on another device** → it lands in the project's first section rather than being dropped. Sync must never silently discard a row because its parent moved.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/grouping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupBySection } from './grouping'
import type { Section, Task } from './schema'

function section(id: string, position: string, done = false): Section {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    name: id,
    position,
    is_done_section: done,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function task(id: string, sectionId: string, position: string): Task {
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
    position,
    created_by: null,
    assignee_id: null,
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

describe('groupBySection', () => {
  it('keeps sections in the order given', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('weekend', 'a1')],
      [],
    )
    expect(groups.map((g) => g.section.id)).toEqual(['todo', 'weekend'])
  })

  it('forces the done section last whatever its position', () => {
    // A done section whose key sorts first is not hypothetical: a user can
    // create sections above it long after the project was made.
    const groups = groupBySection(
      [section('done', 'a0', true), section('todo', 'a1')],
      [],
    )
    expect(groups.map((g) => g.section.id)).toEqual(['todo', 'done'])
  })

  it('puts each task in its own section, in the order given', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('weekend', 'a1')],
      [task('one', 'todo', 'a0'), task('two', 'weekend', 'a0'), task('three', 'todo', 'a1')],
    )
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['one', 'three'])
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['two'])
  })

  it('keeps empty sections', () => {
    const groups = groupBySection([section('todo', 'a0'), section('weekend', 'a1')], [])
    expect(groups).toHaveLength(2)
    expect(groups[1].tasks).toEqual([])
  })

  // SPEC §4.4: "it lands in the project's first section rather than being
  // dropped. Sync must never silently discard a row because its parent moved."
  it('folds a task with an unknown section into the first group', () => {
    const groups = groupBySection(
      [section('todo', 'a0'), section('done', 'a1', true)],
      [task('orphan', 'deleted-elsewhere', 'a0')],
    )
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['orphan'])
  })

  it('drops every task rather than crashing when a project has no sections', () => {
    expect(groupBySection([], [task('one', 'gone', 'a0')])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/grouping.test.ts
```
Expected: FAIL — cannot find module `./grouping`.

- [ ] **Step 3: Write `grouping.ts`**

Create `app/src/lib/grouping.ts`:

```ts
/**
 * How the list is divided.
 *
 * Pure and framework-free, because the interesting rule in here is SPEC §4.4's
 * — a task whose section no longer exists lands in the project's first section
 * rather than being dropped — and that deserves a test, not a DOM.
 *
 * Both inputs arrive in position order from `listSections` and `listTasks`;
 * this preserves that order rather than re-sorting.
 */
import type { Section, Task } from './schema'

export interface SectionGroup {
  section: Section
  tasks: Task[]
}

export function groupBySection(
  sections: Section[],
  tasks: Task[],
): SectionGroup[] {
  // The done section renders last however its key sorts: sections created
  // after the project was made can easily land above it.
  const ordered = [
    ...sections.filter((s) => !s.is_done_section),
    ...sections.filter((s) => s.is_done_section),
  ]
  if (ordered.length === 0) return []

  const groups = new Map(ordered.map((s) => [s.id, [] as Task[]]))
  const fallback = groups.get(ordered[0].id)!

  for (const task of tasks) {
    // SPEC §4.4: "Sync must never silently discard a row because its parent
    // moved." P1's first cross-device section delete produces exactly this row.
    ;(groups.get(task.section_id) ?? fallback).push(task)
  }

  return ordered.map((section) => ({ section, tasks: groups.get(section.id)! }))
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/grouping.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 112 tests; build clean; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/grouping.ts src/lib/grouping.test.ts
git commit -m "$(cat <<'EOF'
feat: grouping tasks into sections, with SPEC 4.4's orphan rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The drawer and the project header

**Files:**
- Create: `app/src/components/Drawer.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `listProjects`, `addProject`, `renameProject`, `archiveProject` from `../lib/repo`; `subscribe`, `getRoute`, `openProject`, `resolveProject` from `../lib/nav`; `pushUndo` from `../lib/undo`.
- Produces: `<Drawer open={boolean} onClose={() => void} />`

- [ ] **Step 1: Write the drawer**

Create `app/src/components/Drawer.tsx`:

```tsx
/**
 * Where you are, and where else you could be.
 *
 * An overlay on a phone; pinned open at `lg` and wider, where there is room
 * for it to be a sidebar. Slice 4 adds Inbox / Today / Upcoming as a group
 * above the project list.
 *
 * Project rename and archive live in the header rather than on these rows, so
 * the drawer stays a place you pass through rather than a control panel.
 */
import { useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listProjects, addProject } from '../lib/repo'
import { subscribe, getRoute, openProject, resolveProject } from '../lib/nav'
import { pushUndo } from '../lib/undo'

export function Drawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])
  const [adding, setAdding] = useState('')

  const openId = resolveProject(projects ?? [], route)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setAdding('')
    const { id, undo } = await addProject(name)
    pushUndo(undo)
    openProject(id)
    onClose()
  }

  return (
    <div
      className={
        'fixed inset-0 z-20 lg:static lg:z-auto lg:block ' +
        (open ? 'block' : 'hidden')
      }
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 lg:hidden"
      />
      <nav
        aria-label="Projects"
        className="relative flex h-full w-72 flex-col border-r border-black/5 bg-white px-2 dark:border-white/10 dark:bg-ink"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Projects
        </p>
        <ul className="flex-1 overflow-y-auto">
          {(projects ?? []).map((project) => (
            <li key={project.id}>
              <button
                type="button"
                aria-current={project.id === openId ? 'page' : undefined}
                onClick={() => {
                  openProject(project.id)
                  onClose()
                }}
                className={
                  'min-h-11 w-full truncate rounded-xl px-3 text-left ' +
                  (project.id === openId
                    ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-300')
                }
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="border-t border-black/5 py-2 dark:border-white/10">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="+ Project"
            aria-label="New project"
            enterKeyHint="done"
            className="min-h-11 w-full rounded-xl bg-transparent px-3 text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </form>
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

Rewrite `app/src/App.tsx`:

```tsx
import { useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { InstallButton } from './components/InstallButton'
import { QuickAdd } from './components/QuickAdd'
import { TaskList } from './components/TaskList'
import { UndoToast } from './components/Toast'
import { TaskSheet } from './components/TaskSheet'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Drawer } from './components/Drawer'
import { listProjects, renameProject, archiveProject } from './lib/repo'
import { subscribe, getRoute, resolveProject } from './lib/nav'
import { pushUndo } from './lib/undo'

/**
 * P0b slice 3 — projects and sections (SPEC §13).
 *
 * The drawer is an overlay on a phone and a pinned sidebar from `lg` up, which
 * is why the layout is a flex row rather than the single column P0a had.
 */
export default function App() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])
  const openId = resolveProject(projects ?? [], route)
  const project = (projects ?? []).find((p) => p.id === openId)

  async function archive() {
    if (project === undefined) return
    pushUndo(await archiveProject(project.id))
  }

  return (
    <div className="flex h-full bg-white text-[15px] dark:bg-ink">
      <UpdatePrompt />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="border-b border-black/5 px-4 pb-3 dark:border-white/10"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button
              type="button"
              aria-label="Projects"
              onClick={() => setDrawerOpen(true)}
              className="-ml-2 min-h-11 px-2 text-neutral-500 lg:hidden dark:text-neutral-400"
            >
              ☰
            </button>
            {renaming && project !== undefined ? (
              <input
                defaultValue={project.name}
                autoFocus
                aria-label="Project name"
                onBlur={async (e) => {
                  setRenaming(false)
                  pushUndo(await renameProject(project.id, e.target.value))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="min-h-11 flex-1 bg-transparent text-lg font-semibold tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
              />
            ) : (
              <h1
                onDoubleClick={() => setRenaming(true)}
                className="flex-1 truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {project?.name ?? 'Lane'}
              </h1>
            )}
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={archive}
              className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
            >
              Archive
            </button>
            <InstallButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <TaskList onOpen={setOpenTaskId} />
        </main>

        <QuickAdd />
      </div>

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
    </div>
  )
}
```

- [ ] **Step 3: Verify the suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 112 tests; build clean; lint clean.

- [ ] **Step 4: Verify in a browser**

```bash
npm run dev
```

At a phone width (390×844): the hamburger opens the drawer; typing a name into `+ Project` and pressing Enter creates the project, opens it, and closes the drawer; the new project's list is empty; adding a task through QuickAdd lands in *that* project; switching back to Inbox shows Inbox's tasks and not the new project's. Reload the page and confirm you are still in the project you were in. Then widen the window past `lg` and confirm the drawer is pinned open and the hamburger is gone. Finally, archive a project and confirm it leaves the drawer and the view falls back to Inbox — then Ctrl+Z and confirm it comes back.

- [ ] **Step 5: Commit**

```bash
git add src/components/Drawer.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: the project drawer, an overlay on a phone and a sidebar on a desktop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The grouped list

**Files:**
- Create: `app/src/components/SectionHeader.tsx`
- Modify: `app/src/components/TaskList.tsx`

**Interfaces:**
- Consumes: `groupBySection` from `../lib/grouping`; `listSections`, `addSection`, `renameSection`, `deleteSection` from `../lib/repo`.
- Produces: `SectionHeader({ section: Section, count: number, collapsed: boolean | null, onToggle: () => void, deletable: boolean })` — `collapsed: null` means the section does not collapse at all, which is every section but Done.

- [ ] **Step 1: Write the section header**

Create `app/src/components/SectionHeader.tsx`:

```tsx
/**
 * A section's name, and the two things you can do to it.
 *
 * Only the done section collapses: one affordance and one piece of state, and
 * an open section has no reason to hide. The count sits next to the name for
 * the same reason a collapsed Done needs one — it is the only way to see how
 * much is behind it.
 */
import { useState } from 'react'
import { renameSection, deleteSection } from '../lib/repo'
import { pushUndo } from '../lib/undo'
import type { Section } from '../lib/schema'

export function SectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  deletable,
}: {
  section: Section
  count: number
  collapsed: boolean | null
  onToggle: () => void
  deletable: boolean
}) {
  const [renaming, setRenaming] = useState(false)

  if (renaming) {
    return (
      <input
        defaultValue={section.name}
        autoFocus
        aria-label="Section name"
        onBlur={async (e) => {
          setRenaming(false)
          pushUndo(await renameSection(section.id, e.target.value))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setRenaming(false)
        }}
        className="mt-4 min-h-11 w-full bg-transparent px-2 text-xs font-medium uppercase tracking-wide text-neutral-500 outline-none dark:text-neutral-400"
      />
    )
  }

  return (
    <div className="group/section mt-4 flex items-center gap-2 px-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={collapsed === null}
        aria-expanded={collapsed === null ? undefined : !collapsed}
        className="min-h-9 flex-1 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 disabled:cursor-default dark:text-neutral-400"
      >
        {collapsed === null ? '' : collapsed ? '▸ ' : '▾ '}
        {section.name}
        {count > 0 && (
          <span className="ml-2 text-neutral-400 dark:text-neutral-500">
            {count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setRenaming(true)}
        aria-label={`Rename ${section.name}`}
        className="min-h-9 px-2 text-xs text-neutral-400 opacity-0 transition-opacity group-hover/section:opacity-100 focus:opacity-100 dark:text-neutral-500"
      >
        Rename
      </button>
      {deletable && (
        <button
          type="button"
          onClick={async () => pushUndo(await deleteSection(section.id))}
          aria-label={`Delete ${section.name}`}
          className="min-h-9 px-2 text-xs text-red-600 opacity-0 transition-opacity group-hover/section:opacity-100 focus:opacity-100 dark:text-red-400"
        >
          Delete
        </button>
      )}
    </div>
  )
}
```

`deletable` is decided by the caller rather than in here, because the rule needs the whole section list: SPEC §4.4 refuses the done section and the last open one.

- [ ] **Step 2: Rewrite `TaskList.tsx` around the groups**

Replace the body of `app/src/components/TaskList.tsx`. The row itself — checkbox, title button, due chip, delete — is unchanged from slice 2; only what wraps it is new:

```tsx
/**
 * The list, divided by section.
 *
 * SPEC §4: completing a task moves it into the project's done section, so the
 * row genuinely leaves the group you were looking at. The done section is
 * collapsed by default and is the only one that collapses — a project you have
 * used for a month is mostly history, and the completed log is P2's job.
 */
import { useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listTasks, listSections, setTaskDone, deleteTask, addSection,
} from '../lib/repo'
import { groupBySection } from '../lib/grouping'
import { formatDue, isOverdue } from '../lib/dates'
import { subscribe, getRoute } from '../lib/nav'
import { pushUndo } from '../lib/undo'
import { SectionHeader } from './SectionHeader'

export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
  const route = useSyncExternalStore(subscribe, getRoute, getRoute)
  const tasks = useLiveQuery(() => listTasks(route.projectId), [route.projectId])
  const sections = useLiveQuery(
    () => listSections(route.projectId),
    [route.projectId],
  )
  const [doneOpen, setDoneOpen] = useState(false)
  const [adding, setAdding] = useState('')

  if (tasks === undefined || sections === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups = groupBySection(sections, tasks)
  const openSections = sections.filter((s) => !s.is_done_section).length

  async function addNewSection(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (!name) return
    setAdding('')
    pushUndo((await addSection(route.projectId, name)).undo)
  }

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {groups.map((group) => {
        const isDone = group.section.is_done_section
        const collapsed = isDone ? !doneOpen : null
        return (
          <section key={group.section.id}>
            <SectionHeader
              section={group.section}
              count={group.tasks.length}
              collapsed={collapsed}
              onToggle={() => setDoneOpen((open) => !open)}
              // SPEC §4.4: the done section is never deletable, and neither is
              // the last open one.
              deletable={!isDone && openSections > 1}
            />
            {collapsed !== true && (
              <ul>
                {group.tasks.map((task) => {
                  const done = task.completed_at !== null
                  const due = formatDue(task.due_on, task.due_time)
                  // A completed task is not overdue, however late it was.
                  const overdue = !done && isOverdue(task.due_on, task.due_time)
                  return (
                    <li
                      key={task.id}
                      className="group flex items-center gap-3 rounded-xl px-1 py-1"
                    >
                      <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-1">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={(e) =>
                            void setTaskDone(task.id, e.target.checked).then(pushUndo)
                          }
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
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTask(task.id).then(pushUndo)}
                        aria-label={`Delete ${task.title}`}
                        className="min-h-11 px-2 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 dark:text-neutral-600"
                      >
                        &times;
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      <form onSubmit={addNewSection} className="mt-4">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ Section"
          aria-label="New section"
          enterKeyHint="done"
          className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </form>
    </div>
  )
}
```

The empty-list message is gone on purpose: a project with no tasks now shows its section headers and the `+ Section` row, which says more about what to do next than "Nothing here yet" did.

- [ ] **Step 3: Verify the suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 112 tests; build clean; lint clean.

- [ ] **Step 4: Verify in a browser**

With `npm run dev` running: the Inbox project shows a `TASKS` header and a collapsed `DONE`; checking a task makes it vanish from Tasks and the Done count go up by one; expanding Done shows it struck through; unchecking it there sends it back to the top section; the completion raised a toast, and Ctrl+Z immediately after completing puts the task back exactly where it was. Add a section, drag nothing, and confirm `+ Section` appends it above Done. Rename a section. Delete a section that has a task in it and confirm the task moved rather than vanished, then undo and confirm both come back. Confirm Delete is not offered on Done or on the only open section.

- [ ] **Step 5: Commit**

```bash
git add src/components/SectionHeader.tsx src/components/TaskList.tsx
git commit -m "$(cat <<'EOF'
feat: the list divided by section, with Done collapsed at the foot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The sheet's pickers

**Files:**
- Modify: `app/src/components/TaskSheet.tsx`

**Interfaces:**
- Consumes: `listProjects`, `listSections`, `setTaskProject`, `setTaskSection` from `../lib/repo`.

- [ ] **Step 1: Add the pickers**

In `app/src/components/TaskSheet.tsx`, extend the imports:

```tsx
import { useLiveQuery } from 'dexie-react-hooks'
```
```tsx
import {
  getTask, renameTask, setTaskNotes, setTaskDue, setTaskPriority, deleteTask,
  listProjects, listSections, setTaskProject, setTaskSection,
} from '../lib/repo'
```

Add two fields to the `Draft` interface and to where it is loaded:

```tsx
interface Draft {
  title: string
  notes: string
  dueOn: string
  dueTime: string
  priority: 0 | 1 | 2 | 3
  projectId: string
  sectionId: string
}
```
```tsx
      setDraft({
        title: task.title,
        notes: task.notes ?? '',
        dueOn: task.due_on ?? '',
        dueTime: task.due_time ?? '',
        priority: task.priority,
        projectId: task.project_id,
        sectionId: task.section_id,
      })
```

Add the two live reads next to the existing state:

```tsx
  const projects = useLiveQuery(() => listProjects(), [])
  const sections = useLiveQuery(
    () => (draft === null ? Promise.resolve([]) : listSections(draft.projectId)),
    [draft?.projectId],
  )
```

And render them after the priority row:

```tsx
            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Project
              </span>
              <select
                value={draft.projectId}
                aria-label="Project"
                onChange={(e) => {
                  const projectId = e.target.value
                  // The section is not carried across: `setTaskProject` lands
                  // the task in the new project's own first open section, and
                  // the draft has to agree with the row it just wrote.
                  setDraft({ ...draft, projectId, sectionId: '' })
                  commitNow(async () => {
                    const step = await setTaskProject(taskId, projectId)
                    const moved = await getTask(taskId)
                    if (moved !== undefined) {
                      setDraft((d) =>
                        d === null ? d : { ...d, sectionId: moved.section_id },
                      )
                    }
                    return step
                  })
                }}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              >
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Section
              </span>
              <select
                value={draft.sectionId}
                aria-label="Section"
                onChange={(e) => {
                  const sectionId = e.target.value
                  setDraft({ ...draft, sectionId })
                  // SPEC §4's binding, reached without a drag: choosing Done
                  // here completes the task, exactly as dragging it there
                  // would.
                  commitNow(() => setTaskSection(taskId, sectionId))
                }}
                className="min-h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-neutral-900 outline-none focus:border-accent dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
              >
                {(sections ?? []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </div>
```

`commitNow` takes a `() => Promise<UndoStep | null>`, which the project handler satisfies by returning the step after re-reading the row.

- [ ] **Step 2: Verify the suite and the build**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 112 tests; build clean; lint clean.

- [ ] **Step 3: Verify in a browser**

Open a task's sheet. Move it to another section and confirm the row moves in the list behind the sheet. Move it to **Done** from the picker and confirm the checkbox on the row is now ticked and the task sits in the Done section — this is the half of §4's binding that has no drag yet, and it is the thing most likely to be wrong. Move a task to another project and confirm it leaves this project's list, appears in the other one's first section, and that the Section picker in the sheet now lists *that* project's sections. Complete a task, then move it to another project, and confirm it lands in that project's Done section still ticked.

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskSheet.tsx
git commit -m "$(cat <<'EOF'
feat: project and section pickers, the non-drag half of the binding

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Documentation and the whole-slice check

**Files:**
- Modify: `app/README.md`

- [ ] **Step 1: Update the README**

Change the status line to **"P0b slice 3 — projects, sections and the done binding"**, and describe what the app now is: real projects with sections, a drawer, and checking a task moving it into its project's Done section.

Replace the `lib/` block of the layout map with:

```
src/
  lib/
    ids.ts                  UUIDv7, vendored (SPEC §4.1)
    fractional-indexing.ts  order keys, vendored (SPEC §4.2, §11.2)
    schema.ts               row shapes + the sync column set (SPEC §4.1)
    device.ts               per-device id, no user identity (SPEC §12 item 7)
    workspace.ts            the active workspace (SPEC §12.3 item 1)
    nav.ts                  the open project, persisted (no router)
    undo.ts                 the single-step undo store (SPEC §4.5)
    dates.ts                due-date formatting and the overdue predicate
    grouping.ts             tasks into sections, incl. SPEC §4.4's orphan rule
    db.ts                   the ONLY file importing Dexie (SPEC §11.3 rule 1)
    outbox.ts               the coalescing append (SPEC §9.1)
    repo/                   the ONLY write path (SPEC §13 P0b constraint)
      write.ts              create / write / composite / batch
      positions.ts          where a task lands in a section
      tasks.ts · projects.ts · sections.ts
  components/               UI
    Drawer.tsx              projects
    SectionHeader.tsx       rename, delete, collapse
    TaskSheet.tsx           the task editor, auto-saving
    Toast.tsx               the undo offer and Ctrl+Z
  sw.ts                     hand-written service worker (SPEC §11.2)
```

Update the second convention bullet to name the directory rather than the file — "**Nothing writes to the database except `repo/`**, and inside it nothing opens a transaction except `write.ts`" — and add:

> Checking a task moves it into its project's done section: SPEC §4's binding,
> written once in `moveTaskTo` so the checkbox and the sheet's Section picker
> cannot disagree. `completed_at`, `section_id` and `position` always move
> together.

- [ ] **Step 2: Run everything**

```bash
npm test && npm run build && npm run lint
```
Expected: PASS, 112 tests; build clean; lint clean.

- [ ] **Step 3: Walk the whole slice in a browser**

Create a project. Add three tasks to it. Add a section and move a task into it through the sheet. Complete one task from the list and one through the sheet's Section picker, and confirm both end up ticked in Done. Undo the last one with Ctrl+Z. Delete a section holding a task and undo it from the toast. Archive the project and undo it. Reload and confirm every change survived and you are still in the same project.

Then check the outbox in the console:

```js
await (await import('/src/lib/db.ts')).db.outbox.toArray()
```

Expect one entry per touched row and no more — in particular, after a section delete that moved three tasks, four entries (three tasks and one section), not seven. Confirm no entry's `columns` array contains `updated_at`, and that the project entry's `seq` is lower than its sections'.

- [ ] **Step 4: Commit and open the PR**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: projects, sections and the repo directory, in the README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin p0b-3-projects-sections
gh pr create --title "P0b slice 3 — projects, sections and the done binding" --body "$(cat <<'EOF'
Slice 3 of P0b: SPEC §4's "whole thesis in one behaviour", built.

- Checking a task moves it into its project's done section. `completed_at`,
  `section_id` and `position` are written together in one place, `moveTaskTo`,
  which the checkbox and the sheet's Section picker both route through — so the
  two halves of §4's binding cannot disagree, and the drag slice adds a third
  caller rather than a fourth copy of the rule.
- Real projects: create, rename, archive, in a drawer that is an overlay on a
  phone and a pinned sidebar on a desktop. The open project survives a reload.
- Sections: create, rename, delete — with §4.4 implemented literally, including
  "its tasks move to the project's first remaining section, they are *not*
  deleted" and both refusals.
- `repo.ts` becomes `repo/`, with a `batch()` transaction helper and a
  `composite()` undo step so one action can span several rows.

No new dependencies. Undo still never rewinds the outbox.

Design: `docs/superpowers/specs/2026-08-18-p0b-projects-sections-design.md`
Plan: `docs/superpowers/plans/2026-08-18-p0b-projects-sections.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **Do not add a dependency.** Not a router, not a toast library, not jsdom or `@testing-library/react`. SPEC §11.3 rule 2. If a step seems to need one, stop and ask.
- **Do not "fix" the failing test in Task 4 Step 2 by dropping `addTask`'s second argument.** Task 5 adds the parameter; Task 4 is written against the finished signature on purpose.
- **Task 1 changes no behaviour.** If `src/lib/repo.test.ts` needs editing to pass in Step 6, the move is wrong — fix the move, not the test.
- **If Task 1 Step 8's atomicity test fails, stop and report it.** Tasks 3 and 4 both assume Dexie joins a nested transaction to its parent; if it does not, `addProject` and `deleteSection` need rethinking before they are written.
- **Do not touch `reminder_at`.** It needs the workspace timezone and a reminder pipeline; both are P1.
- **Do not add a `previous_section_id` column.** The design considered and rejected it: undo already restores the exact section, and the column would be a schema change P1's server carries forever for the case undo covers.
- **`npm test` is not enough.** Slice 1 shipped a TypeScript error past a green test run. Every commit step runs `npm run build` too.
- **If a test needs Dexie imported outside `db.ts`, stop.** SPEC §11.3 rule 1.
- The test counts run 68 → 72 (Task 1) → 78 (2) → 86 (3) → 96 (4) → 106 (5) → 112 (6). Recount rather than trusting the figure if it disagrees.
