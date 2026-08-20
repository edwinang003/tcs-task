# P0b slice 5 — Today and Upcoming: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two cross-project views — Today (overdue, then due today) and Upcoming (tomorrow to +7, grouped by day) — reachable from the drawer and remembered across a reload.

**Architecture:** The route becomes a union, and everything that follows falls out of it. What is overdue, what is due today and how the next seven days bucket are pure functions in `lib/agenda.ts`, beside `grouping.ts` and `drag.ts`, so the date arithmetic is unit-tested in node rather than trapped in a component. The project list and the agenda views are separate components sharing one `TaskRow`, because they differ in affordances — drag, sections and section CRUD on one side, a project badge on the other — and not merely in data.

**Tech Stack:** React 19.2.8, Vite 8.2.1, TypeScript 6.0.3, Tailwind 4.3.3, Dexie 4.4.5, dexie-react-hooks 4.4.0, Vitest 4.1.10 (`environment: 'node'`), fake-indexeddb 6.2.5, oxlint 1.78.0, @dnd-kit 6.3.1/10.0.0/9.0.0/3.2.2. **No new dependencies in this slice.**

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-today-upcoming-design.md`

## Global Constraints

- **No new dependencies.** If one seems necessary, stop and ask (SPEC §11.3 rule 3).
- **Dexie is imported in `db.ts` and nowhere else**; `dnd-kit` in `DraggableList.tsx` and nowhere else (SPEC §11.3 rule 1).
- **Nothing writes to the database except `lib/repo/`**, and inside it nothing opens a transaction except `write.ts`.
- **SPEC §9.1:** every local mutation writes the row **and** appends an outbox entry **in the same IndexedDB transaction**.
- **No new writer of `completed_at`, `section_id` or `position`.** Ticking a row in an agenda view calls the same `setTaskDone` the project list calls.
- **No jsdom, no `@testing-library/react`** (SPEC §11.3 rule 2). Components are verified in a real browser and on the phone, as slices 1–4 were.
- **Dates are strings.** All comparisons are string arithmetic on `YYYY-MM-DD` / `HH:MM` (SPEC §4.1). The only `Date` involved is an injected "now", exactly as `dates.ts` does it.
- Every mutation returns the `UndoStep` that reverses it; the component pushes it.

**Baseline:** the suite is at **147 tests** before Task 1.

---

### Task 1: `lib/nav.ts` — a route that is not always a project

**Files:**
- Modify: `app/src/lib/nav.ts`
- Modify: `app/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: `activeWorkspace` from `./workspace`, `todayLocal` from `./dates`.
- Produces:
  - `type Route = { kind: 'project'; projectId: string } | { kind: 'today' } | { kind: 'upcoming' }`
  - `openView(kind: 'today' | 'upcoming'): void`
  - `captureTarget(route: Route, at?: Date): { projectId: string; dueOn: string | null }`
  - `parseStored(stored: string | null): Route`
  - `resolveProject(projects: Project[] | undefined, projectId: string): string` — **signature changed**, now takes the id rather than a `Route`.
  - Task 4 consumes all of these; Task 7 consumes `captureTarget`.

- [ ] **Step 1: Write the failing tests**

In `app/src/lib/nav.test.ts`, update the import line to:

```ts
import {
  getRoute, openProject, openView, captureTarget, parseStored, resolveProject,
  subscribe,
} from './nav'
```

The four existing `resolveProject` tests pass a `Route` object and must now pass an id. Replace each `{ kind: 'project', projectId: 'work' }` argument with `'work'`, so those four assertions read:

```ts
    expect(resolveProject(projects, 'work')).toBe('work')
    expect(resolveProject(projects, 'work')).toBe(inbox)
    expect(resolveProject(undefined, 'work')).toBe('work')
    expect(resolveProject([], 'work')).toBe(inbox)
```

Then append these tests inside the `describe('nav', ...)` block, before its closing `})`:

```ts
  it('opens Today, and remembers it across a reload', () => {
    openView('today')

    expect(getRoute()).toEqual({ kind: 'today' })
    expect(localStorage.getItem('lane.route')).toBe('today')
  })

  it('opens Upcoming', () => {
    openView('upcoming')

    expect(getRoute()).toEqual({ kind: 'upcoming' })
  })

  it('does not notify when the same view is opened twice', () => {
    openView('today')
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    openView('today')
    unsubscribe()

    expect(calls).toBe(0)
  })

  it('returns the same object until the route changes', () => {
    // `useSyncExternalStore` compares by identity and loops forever on a fresh
    // object every call.
    openView('today')
    expect(getRoute()).toBe(getRoute())
  })

  // `parseStored` is exported so that what a stored string means is testable at
  // all: the module reads storage once, at import, so a test that writes to
  // localStorage afterwards proves nothing about how a fresh tab would load.
  it('reads a project id written by the previous build, which stored a bare uuid', () => {
    // This is the guarantee that lets the route become a union with no
    // migration step: an installed phone must not lose its place on update.
    expect(parseStored('0192f0c4-0000-7000-8000-000000000000')).toEqual({
      kind: 'project',
      projectId: '0192f0c4-0000-7000-8000-000000000000',
    })
  })

  it('reads the two view words back as views', () => {
    expect(parseStored('today')).toEqual({ kind: 'today' })
    expect(parseStored('upcoming')).toEqual({ kind: 'upcoming' })
  })

  it('falls back to Inbox when nothing is stored', () => {
    expect(parseStored(null)).toEqual({ kind: 'project', projectId: inbox })
  })

  it('captures into the open project, undated', () => {
    expect(captureTarget({ kind: 'project', projectId: 'work' })).toEqual({
      projectId: 'work',
      dueOn: null,
    })
  })

  it('captures into Inbox dated today, so the task does not vanish as you type', () => {
    const at = new Date(2026, 7, 20, 9, 0)

    expect(captureTarget({ kind: 'today' }, at)).toEqual({
      projectId: inbox,
      dueOn: '2026-08-20',
    })
  })

  it('captures into Inbox undated from Upcoming, because no date is obvious', () => {
    // SPEC §5.1: a guess that hides itself is worse than no parsing at all.
    expect(captureTarget({ kind: 'upcoming' })).toEqual({
      projectId: inbox,
      dueOn: null,
    })
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd app && npx vitest run src/lib/nav.test.ts
```
Expected: FAIL — `openView is not a function`.

- [ ] **Step 3: Rewrite `lib/nav.ts`**

Replace the whole file with:

```ts
/**
 * Where you are.
 *
 * SPEC §11.3 rule 2 — "prefer ~40 lines you own to a package" — already
 * rejected React Router once. This is the same shape as `undo.ts`: a
 * framework-free module singleton, read through `useSyncExternalStore`.
 *
 * Persisted, so reopening the installed app returns you to where you were
 * rather than to a default. One string holds it: `'today'`, `'upcoming'`, or a
 * project uuid. A uuid cannot collide with either word, so a value written by
 * the previous build still loads as a project route and no migration is needed.
 */
import { activeWorkspace } from './workspace'
import { todayLocal } from './dates'
import type { Project } from './schema'

const KEY = 'lane.route'

export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }

/**
 * What a stored string means.
 *
 * Exported because the module reads storage once, at import: a test that writes
 * to `localStorage` afterwards proves nothing about how a fresh tab would load,
 * and "a uuid written by the previous build still opens that project" is the
 * guarantee that lets this type change without a migration.
 */
export function parseStored(stored: string | null): Route {
  if (stored === 'today') return { kind: 'today' }
  if (stored === 'upcoming') return { kind: 'upcoming' }
  return {
    kind: 'project',
    projectId: stored ?? activeWorkspace().projectId,
  }
}

let route: Route = parseStored(localStorage.getItem(KEY))
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

function go(next: Route, stored: string): void {
  route = next
  localStorage.setItem(KEY, stored)
  for (const listener of listeners) listener()
}

export function openProject(projectId: string): void {
  if (route.kind === 'project' && route.projectId === projectId) return
  go({ kind: 'project', projectId }, projectId)
}

export function openView(kind: 'today' | 'upcoming'): void {
  if (route.kind === kind) return
  go({ kind }, kind)
}

/**
 * Where a captured task lands, and whether it arrives dated.
 *
 * A task typed into Today that landed undated in Inbox would vanish as you
 * finished typing, which reads as a bug and teaches people not to trust the
 * field — so Today dates it. Upcoming has no single obvious date to assume,
 * and guessing one would be the silent mis-dating SPEC §5.1 warns about.
 *
 * A rule about routes, so it lives here rather than as a branch inside
 * `QuickAdd`, where it could not be tested without a DOM.
 */
export function captureTarget(
  route: Route,
  at: Date = new Date(),
): { projectId: string; dueOn: string | null } {
  if (route.kind === 'project') {
    return { projectId: route.projectId, dueOn: null }
  }
  return {
    projectId: activeWorkspace().projectId,
    dueOn: route.kind === 'today' ? todayLocal(at) : null,
  }
}

/**
 * The project to actually show, given what is stored and what exists.
 *
 * Pure, and given the list the caller already has, so that "deleted on another
 * device" and "archived a moment ago" resolve through one branch: both simply
 * stop appearing in `listProjects`.
 */
export function resolveProject(
  projects: Project[] | undefined,
  projectId: string,
): string {
  // `undefined` means the read has not answered yet. An empty list would
  // otherwise read as "your project is gone" and resolve to Inbox, so the
  // stored id is trusted until there is something to check it against.
  if (projects === undefined) return projectId
  const exists = projects.some((p) => p.id === projectId)
  return exists ? projectId : activeWorkspace().projectId
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npx vitest run src/lib/nav.test.ts
```
Expected: PASS, 18 tests (8 existing, 10 new).

The whole suite will not build yet — `useOpenProject.ts` still calls `resolveProject` with a `Route`. Task 4 fixes that; do not fix it here.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "$(cat <<'EOF'
feat: a route that is not always a project

One string still holds it. `'today'` and `'upcoming'` cannot collide with a
uuid, so a value written by the previous build still loads as a project route
and the installed phone reopens where it left off — no migration step.

`captureTarget` is here rather than inside QuickAdd because it is a rule about
routes, and a rule about routes can be tested without a DOM.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `lib/agenda.ts` — what is due, and when

**Files:**
- Create: `app/src/lib/agenda.ts`
- Create: `app/src/lib/agenda.test.ts`

**Interfaces:**
- Consumes: `todayLocal` and `formatDue` from `./dates`; `Task` and `Project` from `./schema`.
- Produces:
  - `interface AgendaGroup { key: string; title: string; tasks: Task[] }`
  - `todayAgenda(tasks: Task[], projects: Project[], at?: Date): AgendaGroup[]`
  - `upcomingAgenda(tasks: Task[], projects: Project[], at?: Date): AgendaGroup[]`
  - Task 6 calls both.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/agenda.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { todayAgenda, upcomingAgenda } from './agenda'
import type { Project, Task } from './schema'

/** A Wednesday morning. Every test reads "now" from here. */
const NOW = new Date(2026, 7, 19, 9, 0)

function project(id: string, archived = false): Project {
  return {
    id,
    workspace_id: 'w',
    name: id,
    color: null,
    icon: null,
    position: 'a0',
    archived_at: archived ? '2026-08-01T00:00:00.000Z' : null,
    updated_at: '2026-08-19T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
  }
}

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    workspace_id: 'w',
    project_id: 'p',
    section_id: 's',
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
    updated_at: '2026-08-19T00:00:00.000Z',
    deleted_at: null,
    client_id: 'test',
    ...fields,
  }
}

/** The one live project every task below belongs to. */
const live = [project('p')]

describe('todayAgenda', () => {
  it('pins overdue above what is due today', () => {
    const groups = todayAgenda(
      [
        task('due', { due_on: '2026-08-19' }),
        task('late', { due_on: '2026-08-17' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Overdue', 'Today'])
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['late'])
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['due'])
  })

  it('omits a group with nothing in it', () => {
    const groups = todayAgenda([task('due', { due_on: '2026-08-19' })], live, NOW)

    expect(groups.map((g) => g.title)).toEqual(['Today'])
  })

  it('ignores tasks with no due date, and tasks due later', () => {
    const groups = todayAgenda(
      [task('someday'), task('friday', { due_on: '2026-08-21' })],
      live,
      NOW,
    )

    expect(groups).toEqual([])
  })

  // The rule that keeps the screen still under your thumb: ticking a row must
  // not take it away, because Today has no Done section to move it to.
  it('keeps a task completed today, so a tick does not empty the screen', () => {
    const groups = todayAgenda(
      [
        task('done', {
          due_on: '2026-08-19',
          completed_at: '2026-08-19T08:30:00.000Z',
        }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['done'])
  })

  it('drops a task completed on an earlier day', () => {
    // Overdue is for work still owed. Yesterday's finished work is P2's log.
    const groups = todayAgenda(
      [
        task('old', {
          due_on: '2026-08-17',
          completed_at: '2026-08-18T08:30:00.000Z',
        }),
      ],
      live,
      NOW,
    )

    expect(groups).toEqual([])
  })

  it('drops tasks whose project is archived, and so absent from the list', () => {
    // The caller passes the list `listProjects` returns, which already excludes
    // archived and deleted projects. A task of theirs surfacing here would be
    // the one place the archive leaked — and reading the same list the drawer
    // reads is also what guarantees every row has a name for its badge.
    const groups = todayAgenda(
      [
        task('visible', { due_on: '2026-08-19' }),
        task('hidden', { due_on: '2026-08-19', project_id: 'archived' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['visible'])
  })

  it('reads down the clock, with untimed tasks after the timed ones', () => {
    // SPEC §4.1: "due Tuesday with no particular time is the common case". It
    // has no place in a time sequence, so it follows rather than sorting to
    // midnight and claiming the top of the day.
    const groups = todayAgenda(
      [
        task('anytime', { due_on: '2026-08-19' }),
        task('evening', { due_on: '2026-08-19', due_time: '18:00' }),
        task('morning', { due_on: '2026-08-19', due_time: '09:30' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual([
      'morning',
      'evening',
      'anytime',
    ])
  })

  it('breaks ties by position, so the order does not shuffle', () => {
    const groups = todayAgenda(
      [
        task('second', { due_on: '2026-08-19', position: 'a1' }),
        task('first', { due_on: '2026-08-19', position: 'a0' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['first', 'second'])
  })

  it('sorts overdue oldest first', () => {
    const groups = todayAgenda(
      [
        task('recent', { due_on: '2026-08-18' }),
        task('ancient', { due_on: '2026-07-01' }),
      ],
      live,
      NOW,
    )

    expect(groups[0].tasks.map((t) => t.id)).toEqual(['ancient', 'recent'])
  })
})

describe('upcomingAgenda', () => {
  it('starts at tomorrow, so nothing appears in both views', () => {
    const groups = upcomingAgenda(
      [
        task('today', { due_on: '2026-08-19' }),
        task('tomorrow', { due_on: '2026-08-20' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Tomorrow'])
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['tomorrow'])
  })

  it('runs to seven days out and no further', () => {
    const groups = upcomingAgenda(
      [
        task('last', { due_on: '2026-08-26' }),
        task('beyond', { due_on: '2026-08-27' }),
      ],
      live,
      NOW,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['last'])
  })

  it('omits days with nothing in them', () => {
    // Seven headers over two tasks is mostly furniture.
    const groups = upcomingAgenda(
      [
        task('thu', { due_on: '2026-08-20' }),
        task('sat', { due_on: '2026-08-22' }),
      ],
      live,
      NOW,
    )

    expect(groups.map((g) => g.title)).toEqual(['Tomorrow', 'Sat 22 Aug'])
  })

  it('ignores overdue work, which belongs to Today', () => {
    const groups = upcomingAgenda([task('late', { due_on: '2026-08-01' })], live, NOW)

    expect(groups).toEqual([])
  })

  it('keys each group by its date, so React can tell days apart', () => {
    const groups = upcomingAgenda([task('thu', { due_on: '2026-08-20' })], live, NOW)

    expect(groups[0].key).toBe('2026-08-20')
  })
})

describe('the local-midnight boundary', () => {
  it('treats a task due today as due today at one minute past midnight', () => {
    // `new Date('2026-08-19')` is UTC midnight, which is the previous day west
    // of Greenwich. Everything here goes through `todayLocal` for that reason.
    const justAfterMidnight = new Date(2026, 7, 19, 0, 1)

    const groups = todayAgenda(
      [task('due', { due_on: '2026-08-19' })],
      live,
      justAfterMidnight,
    )

    expect(groups.map((g) => g.title)).toEqual(['Today'])
  })

  it('moves it to Overdue once the day turns', () => {
    const nextMorning = new Date(2026, 7, 20, 0, 1)

    const groups = todayAgenda(
      [task('due', { due_on: '2026-08-19' })],
      live,
      nextMorning,
    )

    expect(groups.map((g) => g.title)).toEqual(['Overdue'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/lib/agenda.test.ts
```
Expected: FAIL — `Cannot find module './agenda'`.

- [ ] **Step 3: Write `lib/agenda.ts`**

```ts
/**
 * What is due, and when.
 *
 * Pure and framework-free, for the same reason `grouping.ts` and `drag.ts`
 * are: the interesting rules in here are date rules, and date rules deserve a
 * test rather than a DOM. `at` is injected exactly as `dates.ts` injects it,
 * so "due today, read at one minute past midnight" is a unit test rather than
 * a clock mock.
 *
 * Every comparison is string arithmetic on `YYYY-MM-DD` (SPEC §4.1): a task
 * due Tuesday stays due Tuesday wherever you are.
 */
import { todayLocal, formatDue } from './dates'
import type { Project, Task } from './schema'

export interface AgendaGroup {
  key: string
  title: string
  tasks: Task[]
}

/**
 * The tasks an agenda view may show at all.
 *
 * Two rules beyond "has a due date". A task from an archived project is gone
 * from the drawer, so surfacing it here would be the one place the archive
 * leaked — and reading the same list the drawer reads also guarantees every
 * row has a name for its badge. And a task completed *today* stays: the view
 * has no Done section to move a ticked row into, so filtering on completion
 * alone would take the row off the screen under the user's thumb.
 */
function visible(tasks: Task[], projects: Project[], today: string): Task[] {
  const live = new Set(projects.map((p) => p.id))
  return tasks.filter(
    (task) =>
      task.due_on !== null &&
      live.has(task.project_id) &&
      (task.completed_at === null ||
        todayLocal(new Date(task.completed_at)) === today),
  )
}

/**
 * Down the clock, then by position.
 *
 * Untimed tasks come after timed ones on the same day rather than sorting to
 * midnight: "due Tuesday with no particular time is the common case"
 * (SPEC §4.1) and has no place in a time sequence. `position` breaks the
 * remaining ties so the order is total and does not shuffle between renders.
 */
function byDue(a: Task, b: Task): number {
  if (a.due_on !== b.due_on) return (a.due_on ?? '') < (b.due_on ?? '') ? -1 : 1
  if (a.due_time !== b.due_time) {
    if (a.due_time === null) return 1
    if (b.due_time === null) return -1
    return a.due_time < b.due_time ? -1 : 1
  }
  return a.position < b.position ? -1 : 1
}

function group(key: string, title: string, tasks: Task[]): AgendaGroup[] {
  return tasks.length === 0 ? [] : [{ key, title, tasks: tasks.sort(byDue) }]
}

/** Overdue pinned above what is due today, across every project (SPEC §5). */
export function todayAgenda(
  tasks: Task[],
  projects: Project[],
  at: Date = new Date(),
): AgendaGroup[] {
  const today = todayLocal(at)
  const rows = visible(tasks, projects, today)

  return [
    ...group('overdue', 'Overdue', rows.filter((t) => t.due_on! < today)),
    ...group('today', 'Today', rows.filter((t) => t.due_on === today)),
  ]
}

/**
 * Tomorrow to +7, one group per day.
 *
 * It starts at tomorrow so that nothing appears in both views: complementary
 * views cannot disagree, and ticking a task in one can never leave a stale
 * copy in the other. Empty days are omitted — seven headers over two tasks is
 * mostly furniture.
 */
export function upcomingAgenda(
  tasks: Task[],
  projects: Project[],
  at: Date = new Date(),
): AgendaGroup[] {
  const rows = visible(tasks, projects, todayLocal(at))

  const groups: AgendaGroup[] = []
  for (let offset = 1; offset <= 7; offset += 1) {
    // Built from parts so the month and year roll over on their own.
    const day = todayLocal(
      new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset),
    )
    // `formatDue` already spells a bare date as "Tomorrow" or "Sat 22 Aug",
    // which is exactly the heading wanted here.
    groups.push(
      ...group(day, formatDue(day, null, at)!, rows.filter((t) => t.due_on === day)),
    )
  }
  return groups
}
```

- [ ] **Step 4: Run the tests**

```bash
cd app && npx vitest run src/lib/agenda.test.ts
```
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/agenda.ts src/lib/agenda.test.ts
git commit -m "$(cat <<'EOF'
feat: what is due, and when, as functions you can test

Three rules worth a test rather than a DOM. Upcoming starts at tomorrow, so
nothing appears in both views and neither can go stale against the other. A
task completed today stays on the screen, because an agenda view has no Done
section to move a ticked row into. And a task from an archived project never
appears, because the drawer already hides its project.

`at` is injected as `dates.ts` injects it, so the local-midnight boundary is a
unit test rather than a clock mock.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `repo` — the cross-project read, and a date at creation

**Files:**
- Modify: `app/src/lib/repo/tasks.ts`
- Modify: `app/src/lib/repo/tasks.test.ts`

**Interfaces:**
- Produces:
  - `listAllTasks(): Promise<Task[]>` — every live task in the workspace, in position order. Task 6 calls it.
  - `addTask(title: string, projectId: string, options?: { dueOn?: string | null }): Promise<{ id: string; undo: UndoStep }>` — Task 7 passes `dueOn`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('repo', ...)` block in `app/src/lib/repo/tasks.test.ts`, before its closing `})`:

```ts
  it('reads every project at once, in position order', async () => {
    const other = await addProject('work')
    await addTask('in inbox', inbox)
    await addTask('at work', other.id)

    const all = await listAllTasks()

    expect(all.map((t) => t.title).sort()).toEqual(['at work', 'in inbox'])
  })

  it('leaves tombstones out of the cross-project read', async () => {
    const { id } = await addTask('buy milk', inbox)
    await deleteTask(id)

    expect(await listAllTasks()).toEqual([])
  })

  it('creates a task already dated, in one transaction', async () => {
    // A second write would append a second outbox entry for one user action
    // and — because the undo store holds a single step (SPEC §4.5) — would push
    // a step over the create's own, so the undo would clear the date and leave
    // the task.
    const { id } = await addTask('buy milk', inbox, { dueOn: '2026-08-20' })

    const task = await getTask(id)
    expect(task!.due_on).toBe('2026-08-20')
    expect(await entriesFor(id)).toHaveLength(1)
  })

  it('undoes a dated creation whole', async () => {
    const { id, undo } = await addTask('buy milk', inbox, { dueOn: '2026-08-20' })

    await undo.apply()

    expect((await getTask(id))!.deleted_at).not.toBeNull()
  })

  it('still creates undated when no date is given', async () => {
    const { id } = await addTask('buy milk', inbox)

    expect((await getTask(id))!.due_on).toBeNull()
  })
```

Add `listAllTasks` to the existing import from `./index` at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/lib/repo/tasks.test.ts
```
Expected: FAIL — `listAllTasks is not a function`.

- [ ] **Step 3: Add the cross-project read**

In `app/src/lib/repo/tasks.ts`, replace the whole `listTasks` function — comment included — with:

```ts
/**
 * Every live task in the workspace, in position order.
 *
 * One index read serves both this and `listTasks`: Today and Upcoming span
 * every project, so a second index keyed by project would be a second thing to
 * keep correct for no measured gain.
 */
export async function listAllTasks(): Promise<Task[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((t) => t.deleted_at === null)
}

/** Rows the list view shows: not deleted, in this project, in order. */
export async function listTasks(projectId: string): Promise<Task[]> {
  const rows = await listAllTasks()
  return rows.filter((t) => t.project_id === projectId)
}
```

- [ ] **Step 4: Let `addTask` take a date**

In the same file, change `addTask`'s signature to:

```ts
export async function addTask(
  title: string,
  projectId: string,
  // A task captured from Today arrives dated, so it appears where it was
  // typed. Written in the create rather than in a second write: see the test.
  options: { dueOn?: string | null } = {},
): Promise<{ id: string; undo: UndoStep }> {
```

and inside the row literal, replace the `due_on` line with:

```ts
      due_on: options.dueOn ?? null,
```

- [ ] **Step 5: Run the tests**

```bash
cd app && npx vitest run src/lib/repo/tasks.test.ts
```
Expected: PASS — the five new tests plus the existing ones.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/repo/tasks.ts src/lib/repo/tasks.test.ts
git commit -m "$(cat <<'EOF'
feat: the cross-project read this file has been reserving

`listTasks` has always filtered by project after a workspace-wide index read,
with a comment saying Today and Upcoming would want the read itself. They do,
so it is now named — and `listTasks` is that read plus its filter, rather than
a second copy of the query.

`addTask` learns an optional date, written in the create. A follow-up
`setTaskDue` would append a second outbox entry for one user action and push a
step over the create's own, so the undo would clear the date and leave the task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `useRoute` — the React seam, and the app compiles again

**Files:**
- Create: `app/src/lib/useRoute.ts`
- Delete: `app/src/lib/useOpenProject.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/TaskList.tsx`
- Modify: `app/src/components/QuickAdd.tsx`
- Modify: `app/src/components/Drawer.tsx`

**Interfaces:**
- Consumes: `Route`, `subscribe`, `getRoute`, `resolveProject` from Task 1.
- Produces: `useRoute(): { route: Route; project: Project | undefined; projects: Project[]; loaded: boolean }`, where a `project` route's `projectId` is already resolved against what exists. Tasks 6 and 7 consume it.
- **`TaskList` changes signature** to `TaskList({ projectId, onOpen })` — it no longer reads the route itself, so it and `AgendaList` are symmetric and App decides which to show.

**This task changes no behaviour.** The app looks and works exactly as before; only the seam moves. That is what makes it reviewable on its own.

- [ ] **Step 1: Create `lib/useRoute.ts`**

```ts
/**
 * Where you are — the React seam.
 *
 * `nav.ts` stores a route and `resolveProject` interprets the project branch of
 * it; this is the hook between them. It lives here rather than in `nav.ts` so
 * `nav.ts` stays framework-free and its tests keep running without a DOM.
 *
 * Every component that needs the route reads it through here. When the header
 * and the task list each worked it out for themselves they drifted: archiving a
 * project moved the header to Inbox while the list went on showing the archived
 * project's tasks.
 */
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listProjects } from './repo'
import { subscribe, getRoute, resolveProject } from './nav'
import type { Route } from './nav'
import type { Project } from './schema'

export interface Nav {
  /**
   * The route to render. A `project` route always names a project that
   * exists — a stored id whose project was archived or deleted resolves to
   * Inbox before any component sees it.
   */
  route: Route
  /** The open project's row, on a project route once `listProjects` answers. */
  project: Project | undefined
  /** Every live project, in position order — what the drawer lists. */
  projects: Project[]
  /** False until `listProjects` has answered once. */
  loaded: boolean
}

export function useRoute(): Nav {
  const stored = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])

  const route: Route =
    stored.kind === 'project'
      ? { kind: 'project', projectId: resolveProject(projects, stored.projectId) }
      : stored

  return {
    route,
    project:
      route.kind === 'project'
        ? projects?.find((p) => p.id === route.projectId)
        : undefined,
    projects: projects ?? [],
    loaded: projects !== undefined,
  }
}
```

- [ ] **Step 2: Delete the old hook**

```bash
cd app && git rm src/lib/useOpenProject.ts
```

- [ ] **Step 3: Point `TaskList` at a prop instead of the hook**

In `app/src/components/TaskList.tsx`, delete the import line:

```tsx
import { useOpenProject } from '../lib/useOpenProject'
```

Change the component signature and drop the hook call — replace:

```tsx
export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
  const { projectId } = useOpenProject()
```

with:

```tsx
export function TaskList({
  projectId,
  onOpen,
}: {
  projectId: string
  onOpen: (id: string) => void
}) {
```

Nothing else in the file changes: `projectId` is now a prop with the same name and the same meaning.

- [ ] **Step 4: Point `QuickAdd` and `Drawer` at the new hook**

In `app/src/components/QuickAdd.tsx`, replace:

```tsx
import { useOpenProject } from '../lib/useOpenProject'
```
with
```tsx
import { useRoute } from '../lib/useRoute'
```

and replace:

```tsx
  const { projectId } = useOpenProject()
```
with
```tsx
  const { route } = useRoute()
  const projectId =
    route.kind === 'project' ? route.projectId : activeWorkspace().projectId
```

adding at the top of the file:

```tsx
import { activeWorkspace } from '../lib/workspace'
```

Task 7 replaces these three lines with `captureTarget`; this is the interim that keeps behaviour identical.

In `app/src/components/Drawer.tsx`, replace:

```tsx
import { useOpenProject } from '../lib/useOpenProject'
```
with
```tsx
import { useRoute } from '../lib/useRoute'
```

and replace:

```tsx
  const { projectId: openId, projects } = useOpenProject()
```
with
```tsx
  const { route, projects } = useRoute()
  const openId = route.kind === 'project' ? route.projectId : null
```

- [ ] **Step 5: Point `App` at the new hook**

In `app/src/App.tsx`, replace:

```tsx
import { useOpenProject } from './lib/useOpenProject'
```
with
```tsx
import { useRoute } from './lib/useRoute'
```

replace:

```tsx
  const { project, loaded } = useOpenProject()
```
with
```tsx
  const { route, project, loaded } = useRoute()
```

and replace the `<TaskList onOpen={setOpenTaskId} />` line with:

```tsx
          {route.kind === 'project' && (
            <TaskList projectId={route.projectId} onOpen={setOpenTaskId} />
          )}
```

- [ ] **Step 6: Verify the suite and the build**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 178 tests; build clean; lint clean.

- [ ] **Step 7: Verify nothing changed in a browser**

```bash
cd app && npm run dev
```

The app must look and behave exactly as before: the project list renders, the drawer switches projects, quick add works, and the open project survives a reload. Nothing new is visible yet.

- [ ] **Step 8: Commit**

```bash
cd app && git add -A src/lib/useRoute.ts src/lib/useOpenProject.ts src/App.tsx src/components/TaskList.tsx src/components/QuickAdd.tsx src/components/Drawer.tsx
git commit -m "$(cat <<'EOF'
refactor: components read a route, not a project id

No behaviour changes. `useOpenProject` answered "which project", which is not a
question the two new views have an answer to; `useRoute` answers "where are
you", and resolves the project branch against what exists before any component
sees it.

`TaskList` takes its project as a prop rather than reading the route itself, so
it and the agenda list are symmetric and App decides which one to show.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `TaskRow` — one row, two lists

**Files:**
- Create: `app/src/components/TaskRow.tsx`
- Modify: `app/src/components/TaskList.tsx`

**Interfaces:**
- Produces: `TaskRow({ task, onOpen, badge, handle })` where `badge?: string` names the project (agenda views only) and `handle?: Record<string, unknown>` carries the drag grip's props (project list only). Task 6 renders it with a `badge` and no `handle`.

**This task changes no behaviour either.** The project list must look pixel-identical afterwards.

- [ ] **Step 1: Create `components/TaskRow.tsx`**

```tsx
/**
 * One task, as a row.
 *
 * The project list and the agenda views differ in almost everything — sections
 * and drag on one side, days and a project badge on the other — but a task
 * must look and behave the same in both. That is this file: the part that must
 * not drift, in the one place it can be changed.
 *
 * Both extras are optional and absent by default, which is what keeps each
 * list honest. The agenda views have no drag because nothing hands them a
 * handle, not because a flag switched it off; the project list has no badge
 * because it would be the same word on every row.
 */
import { setTaskDone, deleteTask } from '../lib/repo'
import { formatDue, isOverdue } from '../lib/dates'
import { pushUndo } from '../lib/undo'
import type { Task } from '../lib/schema'

export function TaskRow({
  task,
  onOpen,
  badge,
  handle,
}: {
  task: Task
  onOpen: (id: string) => void
  /** The project's name, in views that span more than one project. */
  badge?: string
  /** dnd-kit's grip props, in the list that can be reordered. */
  handle?: Record<string, unknown>
}) {
  const done = task.completed_at !== null
  const due = formatDue(task.due_on, task.due_time)
  // A completed task is not overdue, however late it was.
  const overdue = !done && isOverdue(task.due_on, task.due_time)

  return (
    <div className="group flex items-center gap-3 rounded-xl px-1 py-1">
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center pl-1 pr-1">
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
        {badge !== undefined && (
          <span className="ml-2 whitespace-nowrap text-xs text-neutral-400 dark:text-neutral-500">
            {badge}
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
      {handle !== undefined && (
        <button
          type="button"
          {...handle}
          aria-label={`Reorder ${task.title}`}
          className="flex min-h-11 shrink-0 cursor-grab items-center pl-1 pr-2 text-lg leading-none text-neutral-300 dark:text-neutral-600"
        >
          &#10287;
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Use it from `TaskList`**

In `app/src/components/TaskList.tsx`, add the import:

```tsx
import { TaskRow } from './TaskRow'
```

and replace the whole body of the `group.tasks.map((task) => { ... })` callback — from `const done = task.completed_at !== null` through the closing `</DragItem>` — with:

```tsx
                {group.tasks.map((task) => (
                  <DragItem key={task.id} id={task.id}>
                    {(handle) => (
                      <TaskRow task={task} onOpen={onOpen} handle={handle} />
                    )}
                  </DragItem>
                ))}
```

Then remove the now-unused imports from `TaskList.tsx`: `setTaskDone` and `deleteTask` from `../lib/repo` (leave `listTasks`, `listSections`, `addSection` and `dropTaskAt`), and the whole `formatDue, isOverdue` import line from `../lib/dates`.

- [ ] **Step 3: Verify the suite, the build and the lint**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 178 tests; build clean; lint clean. Lint catches a missed unused import, which is the likeliest slip in this task.

- [ ] **Step 4: Verify the project list is unchanged in a browser**

```bash
cd app && npm run dev
```

Tick a task, delete one, drag one by its grip, open one — all exactly as before, and no project name on any row.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/components/TaskRow.tsx src/components/TaskList.tsx
git commit -m "$(cat <<'EOF'
refactor: a task looks the same in every list, by construction

The row is the part two lists must agree about, so it is the part they share.
Both extras are optional and absent by default: the agenda views will have no
drag because nothing hands them a handle, and the project list has no badge
because it would be the same word on every row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The views appear

**Files:**
- Create: `app/src/components/AgendaList.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/Drawer.tsx`

**Interfaces:**
- Consumes: `todayAgenda` / `upcomingAgenda` (Task 2), `listAllTasks` (Task 3), `useRoute` (Task 4), `TaskRow` (Task 5), `openView` (Task 1).
- Produces: `AgendaList({ kind, onOpen })` where `kind: 'today' | 'upcoming'`.

- [ ] **Step 1: Create `components/AgendaList.tsx`**

```tsx
/**
 * Today and Upcoming — the two views that span every project.
 *
 * Its own component rather than a mode of `TaskList`, because the two differ in
 * affordances and not merely in data: no sections, no section CRUD, no drag,
 * and one thing the project list must never show — which project a task came
 * from. What belongs in which group is decided by `lib/agenda.ts`, which is
 * pure and tested; this file only draws the answer.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTasks, listProjects } from '../lib/repo'
import { todayAgenda, upcomingAgenda } from '../lib/agenda'
import { TaskRow } from './TaskRow'

const EMPTY = {
  today: 'Nothing due today.',
  upcoming: 'Nothing in the next 7 days.',
}

export function AgendaList({
  kind,
  onOpen,
}: {
  kind: 'today' | 'upcoming'
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listAllTasks(), [])
  const projects = useLiveQuery(() => listProjects(), [])

  if (tasks === undefined || projects === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const groups =
    kind === 'today' ? todayAgenda(tasks, projects) : upcomingAgenda(tasks, projects)
  const names = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {groups.length === 0 && (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          {EMPTY[kind]}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.key}>
          <h2
            className={
              'px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide ' +
              // Overdue is the one heading that is not neutral: SPEC §5 asks
              // for it "pinned at top and visually distinct".
              (group.key === 'overdue'
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-400 dark:text-neutral-500')
            }
          >
            {group.title}
          </h2>
          <ul>
            {group.tasks.map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  onOpen={onOpen}
                  badge={names.get(task.project_id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Render it from `App`**

In `app/src/App.tsx`, add the import:

```tsx
import { AgendaList } from './components/AgendaList'
```

The header currently shows the project's name and a Rename and Archive button, none of which mean anything on an agenda route. Add above the `return`:

```tsx
  const TITLES = { today: 'Today', upcoming: 'Upcoming' }
  const title =
    route.kind === 'project' ? (loaded ? (project?.name ?? 'Lane') : '') : TITLES[route.kind]
```

Replace the `<h1>`'s body — `{loaded ? (project?.name ?? 'Lane') : ''}` — with `{title}`, and change its `onDoubleClick={rename.start}` to:

```tsx
                onDoubleClick={route.kind === 'project' ? rename.start : undefined}
```

Wrap the Rename and Archive buttons — both of them, in one expression — so they render only on a project route:

```tsx
            {route.kind === 'project' && (
              <>
                <button
                  type="button"
                  onClick={rename.start}
                  disabled={rename.renaming}
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
              </>
            )}
```

Also guard the rename `<input>` branch, which must not appear on an agenda route — change its condition from `rename.renaming && project !== undefined` to:

```tsx
            {route.kind === 'project' && rename.renaming && project !== undefined ? (
```

And render the agenda beside the list, in `<main>`:

```tsx
          {route.kind === 'project' ? (
            <TaskList projectId={route.projectId} onOpen={setOpenTaskId} />
          ) : (
            <AgendaList kind={route.kind} onOpen={setOpenTaskId} />
          )}
```

- [ ] **Step 3: Add the two entries to the drawer**

In `app/src/components/Drawer.tsx`, extend the `nav.ts` import to include `openView`:

```tsx
import { openProject, openView } from '../lib/nav'
```

Replace the `aria-label="Projects"` on the `<nav>` element with `aria-label="Views and projects"` — it is no longer only projects.

Insert this immediately above the existing `<p>Projects</p>` heading:

```tsx
        <ul className="pb-2">
          {(['today', 'upcoming'] as const).map((kind) => (
            <li key={kind}>
              <button
                type="button"
                aria-current={route.kind === kind ? 'page' : undefined}
                onClick={() => {
                  openView(kind)
                  onClose()
                }}
                className={
                  'min-h-11 w-full truncate rounded-xl px-3 text-left capitalize ' +
                  (route.kind === kind
                    ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-300')
                }
              >
                {kind}
              </button>
            </li>
          ))}
        </ul>
```

Update the file's header comment, which still says "Slice 4 adds Inbox / Today / Upcoming as a group above the project list", to say that Today and Upcoming sit above the projects, and that Inbox is not among them because it is a project.

- [ ] **Step 4: Verify the suite, the build and the lint**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 178 tests; build clean; lint clean.

- [ ] **Step 5: Verify in a browser**

```bash
cd app && npm run dev
```

Create tasks due today, yesterday and in three days, in two different projects. Then:

- Open **Today**: yesterday's task sits under a red **Overdue** heading above today's, each row named with its project, and there is no Rename or Archive in the header.
- Tick a task in Today: the row stays where it is, struck through. This is the slice's central behaviour.
- Open **Upcoming**: only the task three days out, under its own day heading. Nothing due today appears.
- Reload: the app comes back on the view you were in.
- Open a project: sections, drag and the section form are all still there.
- Empty a view (untick nothing due): the empty sentence appears rather than a blank screen.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/components/AgendaList.tsx src/App.tsx src/components/Drawer.tsx
git commit -m "$(cat <<'EOF'
feat: Today and Upcoming, across every project

The component draws groups and nothing else — what belongs in which group is
`lib/agenda.ts`, which is pure and tested. Overdue is the one heading that is
not neutral, because SPEC §5 asks for it pinned and visually distinct.

Rename and Archive leave the header on an agenda route rather than being
disabled there: a button that never enables is worse than an absent one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Capture lands where you can see it

**Files:**
- Modify: `app/src/components/QuickAdd.tsx`

**Interfaces:**
- Consumes: `captureTarget` (Task 1), `addTask`'s `{ dueOn }` option (Task 3), `useRoute` (Task 4).

- [ ] **Step 1: Wire `captureTarget`**

In `app/src/components/QuickAdd.tsx`, delete the interim lines Task 4 added:

```tsx
import { activeWorkspace } from '../lib/workspace'
```

and

```tsx
  const projectId =
    route.kind === 'project' ? route.projectId : activeWorkspace().projectId
```

Add to the `nav` imports:

```tsx
import { captureTarget } from '../lib/nav'
```

and replace the `addTask` call:

```tsx
      const { undo } = await addTask(value, projectId)
```

with:

```tsx
      // Where a captured task lands is a rule about routes, and it lives in
      // `nav.ts`: from Today it arrives in Inbox dated today, so it appears on
      // the screen it was typed into rather than vanishing as you finish.
      const target = captureTarget(route)
      const { undo } = await addTask(value, target.projectId, {
        dueOn: target.dueOn,
      })
```

- [ ] **Step 2: Update the file's header comment**

Its second paragraph still describes capture as landing in the open project. Add a sentence: capture from Today lands in Inbox dated today, because a task that vanishes as you finish typing teaches people not to trust the field.

- [ ] **Step 3: Verify the suite, the build and the lint**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 178 tests; build clean; lint clean.

- [ ] **Step 4: Verify in a browser**

```bash
cd app && npm run dev
```

In **Today**, type a task and press Enter: it appears immediately in the Today group, badged Inbox. In **Upcoming**, type one: the field clears and nothing appears, because it landed undated in Inbox — open Inbox and confirm it is there. In a project, capture is unchanged.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/components/QuickAdd.tsx
git commit -m "$(cat <<'EOF'
feat: a task captured in Today appears in Today

SPEC §3 puts capture ahead of organization and SPEC §8 makes the phone the
capture device, so quick add cannot be hidden on the two screens the phone will
sit on most. But a task typed into Today that landed undated in Inbox would
vanish as you finished typing, which reads as a bug.

Upcoming stays undated: it has no single obvious date to assume, and guessing
one would be the silent mis-dating SPEC §5.1 warns about.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Documentation and the whole-slice check

**Files:**
- Modify: `app/README.md`

- [ ] **Step 1: Update the README**

Change the status line to **"P0b slice 5 — Today and Upcoming"** and say what the app now is: two cross-project views beside the projects — Today, with overdue pinned above what is due today, and Upcoming, the next seven days grouped by day — reachable from the drawer and remembered across a reload.

In the layout map's `lib/` block, add after `drag.ts`:

```
    agenda.ts               what is due, and when (pure; SPEC §5)
```

and change the `nav.ts` line to read:

```
    nav.ts                  the open route, persisted (no router)
```

In the `components/` block, add:

```
    TaskRow.tsx             one row, shared by both lists
    AgendaList.tsx          Today and Upcoming
```

- [ ] **Step 2: Run everything**

```bash
cd app && npm test && npm run build && npm run lint
```
Expected: PASS, 178 tests; build clean; lint clean.

- [ ] **Step 3: Verify on the phone**

Deploy a preview and open it on the phone **in the browser, without installing**:

```bash
cd app && npm run build && npx wrangler deploy --temporary
```

`--temporary` deploys to a throwaway Cloudflare account with its own URL and a 60-minute claim window; production is untouched, and the separate origin means the installed PWA's service worker cannot serve a stale bundle over it.

On the phone: open Today from the drawer and confirm the overdue group reads clearly at arm's length; tick a row and confirm it stays put; capture a task from Today and confirm it appears; confirm the project list still scrolls, and still drags by the grip.

- [ ] **Step 4: Commit and open the PR**

```bash
cd app && git add README.md
git commit -m "$(cat <<'EOF'
docs: two views that are not projects

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin p0b-5-today-upcoming
gh pr create --base main --title "P0b slice 5 — Today and Upcoming" --body "$(cat <<'EOF'
Slice 5 of P0b: Today (overdue pinned above what is due today) and Upcoming
(tomorrow to +7, grouped by day), across every project, reachable from the
drawer and remembered across a reload.

- The route is a union now. One string still persists it, and `'today'` cannot
  collide with a uuid, so a value written by the previous build still loads as
  a project route — no migration, and the installed phone reopens where it was.
- What is overdue, what is due today and how the next seven days bucket are
  pure functions in `lib/agenda.ts`, tested in node with an injected clock,
  including the local-midnight boundary.
- **A ticked row stays**, because an agenda view shows tasks that are
  incomplete *or completed today*. The view has no Done section to move a row
  into, so filtering on completion alone would take the row off the screen
  under your thumb. It is gone the next day, and it survives a reload, because
  it is a fact about the data rather than state in a component.
- Upcoming starts at tomorrow, so nothing appears in both views and neither can
  go stale against the other.
- Capture still works in both: from Today a task lands in Inbox dated today, so
  it appears where it was typed. Upcoming stays undated, because guessing a
  date would be the silent mis-dating SPEC §5.1 warns about.
- Tasks from archived projects never appear — the drawer already hides the
  project, and this is the one place the archive could have leaked.
- No new dependencies. No new writer of `completed_at`, `section_id` or
  `position`: ticking a row in Today calls the same `setTaskDone` the project
  list calls.

Inbox is untouched: it is already a project, and making it a second kind of
thing would give the app two spellings of one concept.

Design: `docs/superpowers/specs/2026-08-20-p0b-today-upcoming-design.md`
Plan: `docs/superpowers/plans/2026-08-20-p0b-today-upcoming.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **Task 1 leaves the build broken on purpose.** `useOpenProject.ts` still calls `resolveProject` with a `Route`, and Task 4 replaces that file. Run the targeted test file in Tasks 1–3 rather than the whole suite; `npm test` is green again from Task 4 onward.
- **Do not filter completed tasks out of the agenda query.** The completed-today rule in `agenda.ts` is what keeps a ticked row on the screen, and it is the behaviour this slice exists to get right.
- **Do not add a Done section to the agenda views.** "Completed today" is a filter, not a history; SPEC §13 puts the completed log in P2.
- **Do not make `TaskList` and `AgendaList` one component.** That was decision 4 in the design, argued there; if it looks tempting mid-task, the row is the thing to share and it already is.
- **Do not derive a date from anything but `dates.ts`.** `new Date('2026-08-19')` is UTC midnight, which is the previous day west of Greenwich. `todayLocal` exists for that reason.
- **Do not add jsdom or `@testing-library/react`** to test the components. SPEC §11.3 rule 2 settled that, and Tasks 4–8 verify the UI in a browser and on the phone.
