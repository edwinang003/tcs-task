# P0b slice 6 — list ⇄ board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the same project viewable as either a list or a board, toggled
per project and remembered per device, over identical data.

**Architecture:** No second data path. `groupBySection` and `resolveDrop` are
already pure and reason about group membership rather than geometry, so the
board is `TaskList.tsx` with different class names and three behavioural
branches. The preference lives in a framework-free `view.ts` over
`localStorage` — the third module of the `undo.ts` / `nav.ts` shape — read
through a `useView.ts` hook. `projects.default_view` lands on the row now, with
a Dexie version 3 that backfills it.

**Tech Stack:** React 19.2.8, TypeScript 6.0.3, Vite 8.2.1, Tailwind 4.3.3,
Dexie 4.4.5, `@dnd-kit/*` (pinned), Vitest 4.1.10 in `environment: 'node'`,
fake-indexeddb 6.2.5, oxlint 1.78.0.

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-list-board-design.md`
(product spec: `docs/SPEC.md`)

## Global Constraints

- **SPEC §11.3 rule 1** — every dependency that could churn is imported in
  exactly one file. Dexie only in `src/lib/db.ts`; `dnd-kit` only in
  `src/components/DraggableList.tsx`. This slice adds no dependency.
- **SPEC §11.3 rule 2** — no jsdom, no happy-dom, no `@testing-library/react`.
  Tests run in `environment: 'node'`. Component behaviour is verified in a real
  browser, never in a simulated DOM.
- **SPEC §11.3 rule 3** — dependencies are pinned exactly. Nothing to add here.
- **SPEC §9.1** — nothing writes to the database except `src/lib/repo/`, and
  inside it nothing opens a transaction except `write.ts`. Every write lands the
  row and its outbox entry in one transaction.
- **SPEC §4.1** — dates are `YYYY-MM-DD` strings, never timestamps. Server-owned
  columns (`updated_at`, `reminder_sent_at`) are never pushed by a client.
- **SPEC §4.1** — `default_view` is a **per-device** preference in local storage
  *and* a **workspace-wide initial value** on the `projects` row. Both. The
  toggle writes local storage only; nothing in this slice writes the column.
- **Working directory is `app/`.** All `npm` commands and all paths below are
  relative to it unless they start with `docs/`.
- **Baseline:** `npm test` currently reports **180 passed (18 files)**. Each task
  states the count it should leave behind.
- **Commit style:** subject in the imperative describing the behaviour, body
  explaining *why*, ending with the `Co-Authored-By: Claude Opus 5
  <noreply@anthropic.com>` trailer. Never commit to `main`; this work is on
  branch `p0b-6-list-board`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/view.ts` | The list/board preference: a module singleton over `localStorage`, plus the pure `resolveView` rule. Framework-free. |
| `src/lib/view.test.ts` | Unit tests for the above. |
| `src/lib/useView.ts` | The React seam: subscribes to `view.ts` and to `matchMedia`, resolves the mode for a project. |

**Modified**

| File | Change |
|---|---|
| `src/lib/schema.ts` | `Project` gains `default_view: ViewMode`. |
| `src/lib/db.ts` | `seedWorkspace` writes it; version 3 backfills it; `ceiling` widens to `1 \| 2 \| 3`. |
| `src/lib/repo/projects.ts` | `addProject` writes `default_view: 'list'`. |
| `src/lib/migration.test.ts` | Two tests for the version 3 upgrade. |
| `src/lib/repo/projects.test.ts` | One test that a new project carries the field. |
| `src/lib/nav.test.ts`, `src/lib/agenda.test.ts` | Their `project()` helpers gain the new field (compile fix). |
| `src/components/TaskList.tsx` | Takes `view`; two layouts; the Done-visibility rule. |
| `src/components/DraggableList.tsx` | `DragArea` takes `vertical`; `DragGroup` takes `minHeight`. |
| `src/App.tsx` | The toggle button; passes `view` to `TaskList`. |
| `README.md` | Status line and the layout map. |

---

### Task 1: `projects.default_view` and database version 3

Closes the SPEC §15 gap — "every row is created with its full sync column set
(§4.1)" — before P1 has to close it under sync. Nothing reads the field until
Task 3; this task is only about the row being complete and existing rows being
brought up to date.

**Files:**
- Modify: `src/lib/schema.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/repo/projects.ts`
- Modify: `src/lib/nav.test.ts`, `src/lib/agenda.test.ts` (compile fixes)
- Test: `src/lib/migration.test.ts`, `src/lib/repo/projects.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Project.default_view: 'list' | 'board'` — read by `useView` in
  Task 3 as the `initial` argument to `resolveView`. `createDb(name, ceiling?)`
  where `ceiling` is now `1 | 2 | 3`, default `3`.

- [ ] **Step 1: Write the failing migration tests**

Append to the `describe` block in `src/lib/migration.test.ts` — a new
`describe`, as a sibling of `v1 → v2 migration`:

```ts
/**
 * A project row as the previous build wrote it: everything except the column
 * this slice adds. Cast because the type now requires the field — which is the
 * point: rows on a phone that installed last week do not have it.
 */
async function seedV2Project(name: string, id: string) {
  const v2 = createDb(name, 2)
  await v2.open()
  await v2.projects.add({
    id,
    workspace_id: workspaceId,
    name: 'Work',
    color: null,
    icon: null,
    position: 'a5',
    archived_at: null,
    updated_at: '2026-08-10T00:00:00.000Z',
    deleted_at: null,
    client_id: 'older-build',
  } as unknown as Project)
  const outboxLength = await v2.outbox.count()
  v2.close()
  return outboxLength
}

describe('v2 → v3 migration', () => {
  it('backfills default_view onto a project written by the previous build', async () => {
    const name = 'lane-migration-default-view'
    await seedV2Project(name, 'older-project')
    const db = createDb(name)
    await db.open()

    expect(await db.projects.get('older-project')).toMatchObject({
      name: 'Work',
      default_view: 'list',
    })
    db.close()
  })

  it('backfills without enqueuing anything to push', async () => {
    // Deliberately unlike the v2 upgrade, which enqueued tasks because those
    // rows had never been enqueued at all (SPEC §9.1: never drop an entry).
    // Here the value written is the column's own default on the server, so
    // there is nothing for a server to learn from being told it.
    const name = 'lane-migration-default-view-outbox'
    const before = await seedV2Project(name, 'quiet-project')
    const db = createDb(name)
    await db.open()

    expect(await db.outbox.count()).toBe(before)
    db.close()
  })
})
```

Add `Project` to that file's imports:

```ts
import type { Project } from './schema'
```

- [ ] **Step 2: Write the failing project-creation test**

Append inside the existing `describe('projects', ...)` block in
`src/lib/repo/projects.test.ts`:

```ts
  it('creates a project with the full sync column set, default_view included', async () => {
    // SPEC §15: every row is created with its full sync column set, so that P1
    // implements a transport rather than a migration.
    const { id } = await addProject('Work')

    expect(await db.projects.get(id)).toMatchObject({ default_view: 'list' })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- migration projects`

Expected: FAIL. The migration tests fail on `default_view: undefined` not
matching `'list'`; the projects test fails the same way. TypeScript is not
checked by `vitest`, so the `as unknown as Project` cast compiles either way.

- [ ] **Step 4: Add the field to the row type**

In `src/lib/schema.ts`, inside `interface Project`, immediately after `icon`:

```ts
  /**
   * SPEC §4.1: the workspace-wide *initial* view for this project. The live
   * per-device toggle is `lib/view.ts` over local storage and is deliberately
   * not synced — switching to board on the tablet must not switch the phone.
   * This column is only the starting point a device inherits before it has an
   * opinion of its own.
   */
  default_view: 'list' | 'board'
```

- [ ] **Step 5: Write it on every path that creates a project**

In `src/lib/db.ts`, in `seedWorkspace`, the `project` literal gains the field
(this literal is untyped — it is passed to `tx.table('projects')` — so the
compiler will not catch its absence):

```ts
  const project = {
    id: projectId,
    name: 'Inbox',
    color: null,
    icon: null,
    default_view: 'list',
    position: 'a0',
    archived_at: null,
    ...sync,
  }
```

In `src/lib/repo/projects.ts`, in `addProject`, the `project` object gains the
same line after `icon: null,`:

```ts
    default_view: 'list',
```

- [ ] **Step 6: Add the version 3 upgrade**

In `src/lib/db.ts`, widen the signature:

```ts
export function createDb(name: string = DB_NAME, ceiling: 1 | 2 | 3 = 3): LaneDb {
```

Then, after the `if (ceiling >= 2) { ... }` block's closing brace and before
`return db`, add:

```ts
  if (ceiling >= 3) {
    // No `stores` call: `default_view` is not indexed, so the schema is
    // unchanged and Dexie carries every table forward. Only the data moves.
    db.version(3).upgrade(async (tx) => {
      await tx
        .table('projects')
        .toCollection()
        .modify((project: { default_view?: string }) => {
          project.default_view ??= 'list'
        })
    })
  }
```

Note the placement: the `db.on('populate', ...)` handler stays inside the
`ceiling >= 2` block where it already is. A fresh database gets `default_view`
from `seedWorkspace` in Step 5, not from this upgrade — Dexie runs `upgrade`
only for a database that already existed.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- migration projects`

Expected: PASS, including the seven pre-existing `v1 → v2` tests. Those open
databases with the default ceiling, so they now run both upgrades in sequence —
if one of them fails, the version 3 handler is reaching for something a
freshly-migrated database does not have.

- [ ] **Step 8: Fix the two test helpers the new field breaks**

`Project` is now a wider type, so every literal of it must carry the field.
Two test helpers construct one. In `src/lib/nav.test.ts`, in `function
project(id: string): Project`, after `icon: null,`:

```ts
    default_view: 'list',
```

In `src/lib/agenda.test.ts`, in `function project(id: string, archived = false):
Project`, after `icon: null,`:

```ts
    default_view: 'list',
```

- [ ] **Step 9: Verify the whole suite and the build**

Run: `npm test && npm run build && npm run lint`

Expected: **183 passed (18 files)**, a clean `tsc -b` and vite build, and no
lint findings. If `tsc` reports a `Project` literal elsewhere, add the field
there too — the compiler is enumerating exactly the places that must agree.

- [ ] **Step 10: Commit**

```bash
git add src/lib/schema.ts src/lib/db.ts src/lib/repo/projects.ts \
  src/lib/migration.test.ts src/lib/repo/projects.test.ts \
  src/lib/nav.test.ts src/lib/agenda.test.ts
git commit -m "feat: a project row carries the view it starts in

SPEC §4.1 lists default_view on projects as the workspace-wide initial
value, and §15's standing constraint is that every row is created with
its full sync column set so P1 adds a transport rather than a migration.

Version 3 backfills it onto rows the previous build wrote, and writes no
outbox entries while doing so — unlike the v2 upgrade, which enqueued
tasks because those rows had never been enqueued at all. The value
written here is the column's own default on the server; there is nothing
for a server to learn from being told it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `view.ts` — the preference, framework-free

The rule about which view a project opens in, and the store that remembers your
answer. Pure and DOM-free so its tests run in `environment: 'node'` (SPEC §11.3
rule 2), exactly as `nav.ts` is.

**Files:**
- Create: `src/lib/view.ts`
- Test: `src/lib/view.test.ts`

**Interfaces:**
- Consumes: `Project.default_view` from Task 1 — only as the *shape* of the
  `initial` argument; this module imports nothing from `schema.ts`.
- Produces:
  ```ts
  export type ViewMode = 'list' | 'board'
  export function parseViews(raw: string | null): Record<string, ViewMode>
  export function subscribe(listener: () => void): () => void
  export function getViews(): Record<string, ViewMode>
  export function setView(projectId: string, mode: ViewMode): void
  export function resolveView(
    stored: ViewMode | undefined,
    wide: boolean,
    initial: ViewMode,
  ): ViewMode
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  getViews, parseViews, resolveView, setView, subscribe,
} from './view'

/**
 * Every test uses its own project id. The module is a singleton that loads
 * once, at import, so state written by one test is still there in the next —
 * the same reason `nav.test.ts` re-opens Inbox in a `beforeEach` rather than
 * assuming an empty store.
 */
describe('resolveView', () => {
  it('honours a stored choice over the width rule', () => {
    expect(resolveView('board', false, 'list')).toBe('board')
  })

  it('honours a stored list on a wide screen whose project starts as a board', () => {
    expect(resolveView('list', true, 'board')).toBe('list')
  })

  it("takes the project's initial value when nothing is stored and there is room", () => {
    expect(resolveView(undefined, true, 'board')).toBe('board')
  })

  it('opens a list on a narrow screen however the project starts', () => {
    // SPEC §8 rule 6: "default to list view at phone widths".
    expect(resolveView(undefined, false, 'board')).toBe('list')
  })
})

describe('the stored preference', () => {
  it('remembers a project across a reload', () => {
    setView('p-remember', 'board')
    // What a fresh tab would read: the module reloads and re-parses storage.
    expect(parseViews(localStorage.getItem('lane.view'))['p-remember']).toBe('board')
  })

  it('keeps one project’s choice out of another’s', () => {
    setView('p-alpha', 'board')
    setView('p-beta', 'list')

    expect(getViews()['p-alpha']).toBe('board')
    expect(getViews()['p-beta']).toBe('list')
  })

  it('returns the same object until something changes', () => {
    // `useSyncExternalStore` compares by identity and would loop forever on a
    // fresh object every call.
    const first = getViews()
    expect(getViews()).toBe(first)

    setView('p-identity', 'board')
    expect(getViews()).not.toBe(first)
  })

  it('neither writes nor notifies when the mode is already what you asked for', () => {
    setView('p-idempotent', 'board')
    localStorage.removeItem('lane.view')
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    setView('p-idempotent', 'board')

    expect(localStorage.getItem('lane.view')).toBeNull()
    expect(calls).toBe(0)
    unsubscribe()
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribe(() => { calls += 1 })

    setView('p-notify', 'board')
    expect(calls).toBe(1)

    unsubscribe()
    setView('p-notify', 'list')
    expect(calls).toBe(1)
  })
})

describe('parseViews', () => {
  it('reads nothing stored as nobody having chosen', () => {
    expect(parseViews(null)).toEqual({})
  })

  it('survives a value that is not JSON at all', () => {
    // A display preference is never worth a blank screen.
    expect(parseViews('{not json')).toEqual({})
  })

  it('survives JSON that is not an object', () => {
    expect(parseViews('3')).toEqual({})
  })

  it('drops modes it does not recognise', () => {
    // A newer build's value, or a hand-edited one. Falling through to the
    // width rule is right; rendering an unknown view is not.
    expect(parseViews('{"p":"kanban","q":"board"}')).toEqual({ q: 'board' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- view`

Expected: FAIL — `Failed to resolve import "./view"`.

- [ ] **Step 3: Write the module**

Create `src/lib/view.ts`:

```ts
/**
 * List or board — per project, per device.
 *
 * The third module of this shape, after `undo.ts` and `nav.ts`: a
 * framework-free singleton over `localStorage`, read through
 * `useSyncExternalStore` (SPEC §11.3 rule 2 — "prefer ~40 lines you own to a
 * package").
 *
 * SPEC §4.1 is emphatic that this preference is *not* synced: "switching to
 * board view on the tablet silently switches the phone too — and the phone
 * almost always wants the list while the tablet wants the board. This is the
 * one place where 'the same data everywhere' is the wrong instinct." So it
 * never touches IndexedDB and never reaches the outbox.
 *
 * One key holding a map rather than a key per project, so that reading is one
 * parse and a corrupt value has exactly one place to be handled.
 */
const KEY = 'lane.view'

export type ViewMode = 'list' | 'board'

/**
 * What a stored string means.
 *
 * Exported because the module reads storage once, at import: a test that writes
 * to `localStorage` afterwards proves nothing about how a fresh tab would load.
 * Anything unrecognised is dropped rather than thrown — a display preference is
 * never worth a blank screen, and falling through to the width rule is a good
 * answer.
 */
export function parseViews(raw: string | null): Record<string, ViewMode> {
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const views: Record<string, ViewMode> = {}
  for (const [id, mode] of Object.entries(parsed as Record<string, unknown>)) {
    if (mode === 'list' || mode === 'board') views[id] = mode
  }
  return views
}

let views = parseViews(localStorage.getItem(KEY))
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Returns the same object until a choice actually changes.
 * `useSyncExternalStore` compares by identity and would loop forever on a
 * fresh object every call.
 */
export function getViews(): Record<string, ViewMode> {
  return views
}

export function setView(projectId: string, mode: ViewMode): void {
  if (views[projectId] === mode) return
  views = { ...views, [projectId]: mode }
  try {
    localStorage.setItem(KEY, JSON.stringify(views))
  } catch {
    // A full origin, or private mode. The view is switched for this session
    // and forgotten by the next, which is the whole cost. `reportProblem` is
    // for writes that lost your data, and this one lost a preference.
  }
  for (const listener of listeners) listener()
}

/**
 * Which view a project opens in.
 *
 * A stored choice always wins: the width rule supplies a first answer, never
 * an override. Absent one, SPEC §8 rule 6 applies — "default to list view at
 * phone widths. The tablet is wide enough for board view; the phone mostly
 * isn't" — and above that width the project's own initial value decides.
 */
export function resolveView(
  stored: ViewMode | undefined,
  wide: boolean,
  initial: ViewMode,
): ViewMode {
  if (stored !== undefined) return stored
  return wide ? initial : 'list'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- view`

Expected: PASS, 13 tests.

- [ ] **Step 5: Verify the whole suite, the build and the lint**

Run: `npm test && npm run build && npm run lint`

Expected: **196 passed (19 files)**, clean build, no lint findings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/view.ts src/lib/view.test.ts
git commit -m "feat: remember whether a project is a list or a board

Per project and per device. SPEC §4.1 calls this the one place where
'the same data everywhere' is the wrong instinct — syncing it would mean
switching to board on the tablet switches the phone, and the phone almost
always wants the list.

A stored choice always wins; the width rule only ever supplies a first
answer. An unreadable stored value falls through to that rule rather than
throwing, because a display preference is never worth a blank screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: the board layout and the toggle

The visible half: `useView` resolves the mode, a header button switches it, and
`TaskList` grows a second layout. Drag across columns is Task 4 — after this
task the board renders, remembers and reorders vertically, and a card dragged
sideways is still restricted to the vertical axis.

**Files:**
- Create: `src/lib/useView.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/TaskList.tsx`

**Interfaces:**
- Consumes: `resolveView`, `getViews`, `subscribe`, `setView`, `ViewMode` from
  Task 2; `Project.default_view` from Task 1.
- Produces:
  ```ts
  // src/lib/useView.ts
  export function useView(project: Project | undefined): {
    view: ViewMode
    setView: (mode: ViewMode) => void
  }
  ```
  and `TaskList`'s prop type becomes
  `{ projectId: string; view: ViewMode; onOpen: (id: string) => void }`.

- [ ] **Step 1: Write the hook**

There is no test step here, and that is deliberate: SPEC §11.3 rule 2 bans
jsdom from this project, so a hook has no unit test — `useRoute.ts` has none
either. Everything testable was pushed into `view.ts` in Task 2. What is left
is verified in a browser in Task 5.

Create `src/lib/useView.ts`:

```ts
/**
 * List or board — the React seam.
 *
 * `view.ts` stores the choice and `resolveView` interprets its absence; this is
 * the hook between them. It lives here rather than in `view.ts` so `view.ts`
 * stays framework-free and its tests keep running without a DOM, which is the
 * same split as `nav.ts` / `useRoute.ts`.
 */
import { useSyncExternalStore } from 'react'
import { subscribe, getViews, setView, resolveView } from './view'
import type { ViewMode } from './view'
import type { Project } from './schema'

/**
 * Tailwind's `lg` — the same width at which the drawer stops being an overlay
 * and becomes a sidebar. Subscribed rather than read once, so that rotating a
 * tablet re-resolves a project that has no stored choice of its own.
 */
const WIDE = '(min-width: 1024px)'

function subscribeWidth(listener: () => void): () => void {
  const query = matchMedia(WIDE)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function isWide(): boolean {
  return matchMedia(WIDE).matches
}

export function useView(project: Project | undefined): {
  view: ViewMode
  setView: (mode: ViewMode) => void
} {
  const views = useSyncExternalStore(subscribe, getViews, getViews)
  const wide = useSyncExternalStore(subscribeWidth, isWide, isWide)

  const id = project?.id
  return {
    view: resolveView(
      id === undefined ? undefined : views[id],
      wide,
      project?.default_view ?? 'list',
    ),
    // Before `listProjects` answers there is no project to remember a choice
    // against, and the toggle is not on screen either.
    setView: (mode: ViewMode) => {
      if (id !== undefined) setView(id, mode)
    },
  }
}
```

- [ ] **Step 2: Add the toggle to the header**

In `src/App.tsx`, add the import beside the existing `useRoute` one:

```ts
import { useView } from './lib/useView'
```

Immediately after the existing `const { route, project, loaded } = useRoute()`:

```ts
  const { view, setView } = useView(project)
```

Inside the existing `{route.kind === 'project' && (<>…</>)}` fragment in the
header, as the **first** child, before the Rename button:

```tsx
                <button
                  type="button"
                  onClick={() => setView(view === 'board' ? 'list' : 'board')}
                  // A toggle button, not two: the phone header already carries
                  // ☰, the title, Rename, Archive and Install. `aria-pressed`
                  // is why the label stays "Board" in both states — a label
                  // that flipped to "List" would read as a different button to
                  // a screen reader that was just told the state.
                  aria-pressed={view === 'board'}
                  className={
                    'min-h-11 rounded-lg px-2 text-sm ' +
                    (view === 'board'
                      ? 'bg-accent/15 text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-500 dark:text-neutral-400')
                  }
                >
                  Board
                </button>
```

And pass the mode down — change the `TaskList` line in `<main>`:

```tsx
            <TaskList projectId={route.projectId} view={view} onOpen={setOpenTaskId} />
```

Also update the file's header comment: the line `P0b slice 5 — Today and
Upcoming (SPEC §13).` becomes

```
 * P0b slice 6 — the same project as a list or a board (SPEC §5, §13).
```

- [ ] **Step 3: Teach `TaskList` the two layouts**

In `src/components/TaskList.tsx`, replace the file's header comment with:

```tsx
/**
 * A project, as a list or as a board.
 *
 * SPEC §5: "list ⇄ board is a rendering choice, not a data choice. In list
 * view, sections are collapsible headers with tasks beneath. In board view,
 * the same sections are columns and the same tasks are cards." One component
 * makes that structurally true rather than merely intended — there is one
 * `onDrop`, one `describe`, and one place the undo-toast rule lives.
 *
 * SPEC §4: completing a task moves it into the project's done section, so the
 * row genuinely leaves the group you were looking at. In the list that section
 * is collapsed by default and is the only one that collapses; on the board it
 * is an ordinary column, which is where the gesture reads best — dragging a
 * card into Done completes it.
 */
```

Add the type import beside the existing ones:

```ts
import type { ViewMode } from '../lib/view'
```

Change the signature:

```tsx
export function TaskList({
  projectId,
  view,
  onOpen,
}: {
  projectId: string
  view: ViewMode
  onOpen: (id: string) => void
}) {
```

After the existing `const groups = groupBySection(sections, tasks)` and
`openSections` lines, add:

```tsx
  const board = view === 'board'
  // Whether the done section is somewhere you can still see. On the board it
  // always is; in the list it is behind a collapsed header unless you opened
  // it. Two things follow from it, and both are the same rule `Toast.tsx`
  // already follows: an undo toast means the row left the screen.
  const showsDone = board || doneOpen

  /** One column, wide enough to fill a phone and to fit four on a laptop. */
  const column = 'w-[85vw] shrink-0 snap-start lg:w-72'
```

Replace the `vanished` line inside `onDrop`:

```tsx
    const vanished = target.sectionId === done?.id && !showsDone
```

- [ ] **Step 4: Move the section form out of the return, so it has two homes**

Still in `src/components/TaskList.tsx`, after the existing
`const draggedTask = tasks.find((t) => t.id === dragging)` line, add:

```tsx
  // Defined once and placed in one of two slots: below the list, or as the
  // last column of the board.
  const sectionForm = (
    <form onSubmit={addNewSection} className={board ? undefined : 'mt-4'}>
      <input
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        placeholder="+ Section"
        aria-label="New section"
        enterKeyHint="done"
        className="min-h-11 w-full rounded-xl bg-transparent px-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
    </form>
  )
```

- [ ] **Step 5: Rewrite the returned tree**

Replace the whole `return (...)` block of `src/components/TaskList.tsx` with:

```tsx
  return (
    <div className={board ? 'px-3 py-2' : 'mx-auto max-w-2xl px-3 py-2'}>
      <DragArea
        onStart={setDragging}
        onDrop={onDrop}
        describe={describe}
        vertical={!board}
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
      {/* One column fills a phone and you swipe between them; four fit a
          laptop. The snap is what stops a swipe leaving you between two. */}
      <div className={board ? 'flex items-start gap-3 overflow-x-auto snap-x snap-mandatory' : undefined}>
      {groups.map((group) => {
        const isDone = group.section.is_done_section
        // Only the list collapses Done. A column costs no vertical space, and
        // a drop that completes a task has to have somewhere to land.
        const collapsed = board ? null : isDone ? !doneOpen : null
        return (
          <section key={group.section.id} className={board ? column : undefined}>
            <DragGroup
              id={group.section.id}
              itemIds={collapsed === true ? [] : group.tasks.map((t) => t.id)}
              minHeight={board}
            >
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
                {group.tasks.map((task) => (
                  <DragItem key={task.id} id={task.id}>
                    {(handle) => (
                      <TaskRow
                        task={task}
                        onOpen={onOpen}
                        handle={handle}
                        hidesOnComplete={!showsDone}
                      />
                    )}
                  </DragItem>
                ))}
              </ul>
            )}
            </DragGroup>
          </section>
        )
      })}
      {board && <div className={column}>{sectionForm}</div>}
      </div>
      </DragArea>

      {!board && sectionForm}
    </div>
  )
```

Two things changed beyond the layout, and both are the same rule:
`hidesOnComplete={!showsDone}` replaces the unconditional `hidesOnComplete`.
Ticking a card on the board moves it to the Done column in front of you, so
there is nothing to offer to undo — and the same was already true, unnoticed,
in the list with Done expanded.

- [ ] **Step 6: Give `DragArea` an axis and `DragGroup` a floor**

In `src/components/DraggableList.tsx`, add module-level constants immediately
after the imports:

```ts
/**
 * Hoisted so the array identity does not change on every render. A list can
 * only move a row up and down; a board's columns are side by side, so the
 * board takes the restriction off.
 */
const VERTICAL_ONLY = [restrictToVerticalAxis]
const FREE: typeof VERTICAL_ONLY = []
```

Add `vertical` to `DragArea`'s props and destructuring:

```tsx
export function DragArea({
  onStart,
  onDrop,
  describe,
  vertical,
  overlay,
  children,
}: {
  onStart: (id: string) => void
  /** `overId` is a task id or a section id — the caller knows which. */
  onDrop: (activeId: string, overId: string | null) => void
  /** How to name a task or a section out loud, for screen readers. */
  describe: (id: string) => string
  /** True in the list, false on the board, where columns are side by side. */
  vertical: boolean
  overlay: ReactNode
  children: ReactNode
}) {
```

and use it on the `DndContext`:

```tsx
      modifiers={vertical ? VERTICAL_ONLY : FREE}
```

Then add `minHeight` to `DragGroup`:

```tsx
export function DragGroup({
  id,
  itemIds,
  minHeight,
  children,
}: {
  id: string
  itemIds: string[]
  /**
   * A board column with no cards in it is still a place to drop one — and
   * with nothing inside, it has no height for a thumb to aim at.
   */
  minHeight?: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={
          'rounded-xl transition-colors ' +
          (minHeight === true ? 'min-h-24 ' : '') +
          (isOver ? 'bg-accent/10' : 'bg-transparent')
        }
      >
        {children}
      </div>
    </SortableContext>
  )
}
```

Finally, extend that file's header comment — after the paragraph ending "and
everything else on the row behaves normally." — with:

```
 * `verticalListSortingStrategy` stays in both views: cards still sort up and
 * down *within* a column, and a move between columns goes through the group's
 * own droppable, exactly as a move between sections does in the list.
```

- [ ] **Step 7: Verify the build, the lint and the suite**

Run: `npm run build && npm run lint && npm test`

Expected: clean `tsc -b`, no lint findings, **196 passed (19 files)** — the same
count as Task 2, because nothing in this task is unit-testable without a DOM.

If `tsc` reports `'sections' is possibly 'undefined'` inside `onDrop` or
`describe`, those two must stay **arrow consts**. A hoisted `function`
declaration does not inherit the early-return narrowing above it; this bit the
drag slice and the arrow form is why they are written that way.

- [ ] **Step 8: Commit**

```bash
git add src/lib/useView.ts src/App.tsx src/components/TaskList.tsx \
  src/components/DraggableList.tsx
git commit -m "feat: the same project, as a list or as a board

SPEC §5 calls this the core idea of the product and the thing neither
reference app does. It is a rendering choice and not a data choice, so
it is one component with two layouts rather than two components: one
onDrop, one describe, one place the toast rule lives.

Done is an ordinary column on the board, which is where the two-way
binding of SPEC §4 reads best — you complete a task by dragging it
there. Because the card is then still on screen, neither the drop nor
the checkbox offers an undo: Toast.tsx's rule is that a toast means the
row left the screen. The list with Done expanded was quietly breaking
that rule already, and now follows it too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: verify it in a real browser

SPEC §11.3 rule 2 keeps jsdom out of this project, so behaviour that only
exists in a browser is checked in one — as in slices 4 and 5. This task writes
no code unless something fails.

**Files:**
- Modify (only if a check fails): `src/components/TaskList.tsx`,
  `src/components/DraggableList.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing. A pass here is what makes the phone check in Task 5 worth
  doing.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` in the background. It serves on `http://localhost:5173`.

- [ ] **Step 2: Set up a project worth looking at**

In the browser, open `http://localhost:5173`, add a project called `Board test`
from the drawer, add a second section to it (`Doing`), and add four tasks.

- [ ] **Step 3: Work through the checks**

Each of these is a claim the design makes. A failure is a finding, not a
formality:

1. The `Board` button appears on a project route and **not** on Today or
   Upcoming.
2. Clicking it turns the list into columns; the button reads as pressed.
3. Reloading the page keeps the board. Opening a *different* project shows a
   list — the preference is per project.
4. At a 390 × 844 viewport, one column fills the width and scrolling sideways
   snaps to the next. Done is the last one.
5. Dragging a card from `Tasks` to `Doing` moves it, and the position sticks
   across a reload.
6. Dragging a card into `Done` ticks its checkbox and raises **no** undo toast.
7. Ticking a card's checkbox on the board moves it to the Done column and
   raises **no** toast.
8. Switching back to `List` shows the same tasks, with Done collapsed and its
   count right.
9. At 1280 × 800, columns are narrow (`w-72`) and several fit side by side; the
   drawer is pinned open beside them.
10. The console is clean throughout.

- [ ] **Step 4: If a drop between columns misaims, change the collision strategy**

Only if check 5 or 6 fails by landing in the wrong column: in
`src/components/DraggableList.tsx`, swap `closestCenter` for `closestCorners`
(both are `@dnd-kit/core` exports, so no new dependency), and say why in a
comment:

```tsx
      // A board is two-dimensional: `closestCenter` compares distance to a
      // single point, which aims badly when the nearest centre is in the
      // column you are dragging *out* of.
      collisionDetection={closestCorners}
```

Re-run every check above afterwards, including the list ones — the list uses
the same context.

- [ ] **Step 5: Commit anything the checks changed**

If nothing changed, skip this step; the browser pass is recorded in the PR
description instead.

```bash
git add src/components/DraggableList.tsx
git commit -m "fix: aim a drop by the card's corners, not its centre

<why, from what the browser actually did>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: the README, and the phone

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: a passing Task 4.
- Produces: nothing further depends on this.

- [ ] **Step 1: Update the status line**

In `README.md`, replace `Currently at **P0b slice 5 — Today and Upcoming**
(SPEC §13).` with `Currently at **P0b slice 6 — list ⇄ board** (SPEC §13).`,
and add a sentence to that paragraph:

```
A project is a list or a board, toggled from the header and remembered per
project and per device — the same sections, as headers or as columns, with
Done as the last column you can drag a card into to complete it.
```

- [ ] **Step 2: Update the layout map**

In the `src/` tree in `README.md`, add under `lib/`, after the `nav.ts` line:

```
    view.ts                 list or board, per project, per device (SPEC §4.1)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the README knows about the board

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Run everything one last time**

Run: `npm test && npm run build && npm run lint`

Expected: **196 passed (19 files)**, clean build, no lint findings.

- [ ] **Step 5: Finish the branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch.

The repo's convention is a PR, rebase-merged onto a linear `main`. Note in the
PR description that the PR-branch Cloudflare Workers Builds check is known to
fail on every branch and is unrelated to this work.

Then deploy a preview and use the board on the phone for a few minutes. The one
question it has to answer is the one the design flags: **does dragging a card
into a column that is scrolled off-screen work?** That needs horizontal
autoscroll mid-drag, and it may be poor on Android.

If it is poor, that is the empirical answer SPEC §14 open question 5 asked for,
and it gets reported as such — the non-drag fallback SPEC §8 rule 6 requires is
already built as the sheet's Section select, and the board remains a good
viewing and within-column reordering surface on the phone.

---

## Self-review notes

- **Spec coverage.** Board layout, toggle, drag, Done as a column, phone
  columns and `projects.default_view` each map to a task: Task 3 (layout,
  toggle, Done, columns), Task 3 + 4 (drag), Task 1 (schema). The design's
  testing section maps to Task 1 Steps 1–2 and Task 2 Step 1. The "what the
  phone has to answer" section maps to Task 5 Step 5.
- **Test counts.** 180 today → 183 after Task 1 (two migration, one project) →
  196 after Task 2 (thirteen view tests) → 196 through the end.
- **Type consistency.** `ViewMode` is defined once in `view.ts` and imported by
  `useView.ts` and `TaskList.tsx`. `Project.default_view` is typed `'list' |
  'board'` in `schema.ts` rather than as `ViewMode`, so that `schema.ts` keeps
  importing nothing — it is the bottom of the import graph.
