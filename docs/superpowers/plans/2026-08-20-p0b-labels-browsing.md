# P0b slice 8b — labels, browsing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A label is somewhere you can go — listed in the drawer, opening a
cross-project view of every task carrying it, with rename, recolour and delete
in that view's header.

**Architecture:** The route is a third arm on `nav.ts`'s existing union, stored
as `` `label:${id}` `` so it cannot collide with the bare uuid a project
stores. Everything else is a shape the codebase already has: a pure resolver
beside `resolveProject`, a pure set-builder in `labelling.ts`, a list component
in `AgendaList`'s shape, and header controls where a project's already live.

**Tech Stack:** React 19.2.8 · Vite 8.2.1 · TypeScript 6.0.3 · Tailwind 4.3.3 ·
Dexie 4.4.5 · dexie-react-hooks 4.4.0 · Vitest 4.1.10 (`environment: 'node'`) ·
fake-indexeddb 6.2.5 · oxlint 1.78.0

**Spec:** `docs/superpowers/specs/2026-08-20-p0b-labels-design.md`

**Depends on:** slice 8a, merged. `repo/labels.ts` already ships
`listLabels`, `renameLabel`, `setLabelColor` and `deleteLabel` — tested, with
no caller. This plan is their caller.

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
  writes to the database. This slice adds no mutation: 8a wrote them all.
- **SPEC §4.5** — undo is local, session-scoped, single-level, and reapplied as
  an ordinary new mutation. Every mutation returns the `UndoStep` that reverses
  it; the component that called it pushes that step.
- Tailwind classes must be spelled out literally in source. A class name
  assembled at runtime from stored data is purged from the build and renders
  unstyled — see the design, decision 3. `dotClasses` is the only way to a
  palette colour.
- Line width in docs and comments is 79 characters.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `app/src/components/LabelList.tsx` | The label route's tasks, with their project names. |
| `app/src/components/LabelHeader.tsx` | Rename, recolour and delete, in the header. |

**Modified:**

| File | Change |
| --- | --- |
| `app/src/lib/nav.ts` | The `label` arm, `openLabel`, `resolveLabel`, `captureTarget`'s case. |
| `app/src/lib/nav.test.ts` | Those four, plus the uuid fallback they must not break. |
| `app/src/lib/labelling.ts` | `tasksWithLabel`. |
| `app/src/lib/labelling.test.ts` | Its three cases. |
| `app/src/lib/useRoute.ts` | Live-query labels; resolve a label route. |
| `app/src/components/Drawer.tsx` | A Labels list below the projects. |
| `app/src/App.tsx` | Title, header controls and body for a label route. |
| `app/README.md` | Status paragraph, Layout block, test list. |

**Deliberately not created:** a `useLabelRoute` hook. `useRoute` already owns
"which route, and does its target still exist" for projects; a second hook
answering the same question for labels is the drift `useRoute`'s own doc
comment describes.

---

### Task 1: `nav.ts` — the label route

**Files:**
- Modify: `app/src/lib/nav.ts`
- Modify: `app/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: `Label` from `./schema` (8a).
- Produces: `Route`'s third arm `{ kind: 'label'; labelId: string }`;
  `openLabel(labelId: string): void`;
  `resolveLabel(labels: Label[] | undefined, labelId: string): Route`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/nav.test.ts`:

```ts
describe('label routes', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores a label route under a prefix a uuid cannot produce', () => {
    // The whole reason for the prefix. A bare uuid already means a project,
    // so a label uuid stored bare would open a project that does not exist.
    openLabel('9f1d7c2e-0000-7000-8000-000000000001')
    expect(localStorage.getItem('lane.route')).toBe(
      'label:9f1d7c2e-0000-7000-8000-000000000001',
    )
    expect(getRoute()).toEqual({
      kind: 'label',
      labelId: '9f1d7c2e-0000-7000-8000-000000000001',
    })
  })

  it('reads a stored label route back', () => {
    expect(parseStored('label:abc')).toEqual({ kind: 'label', labelId: 'abc' })
  })

  it('still reads a bare uuid as a project', () => {
    // The guarantee that lets this union grow without a migration: a value
    // written by any previous build keeps meaning what it meant.
    expect(parseStored('9f1d7c2e-0000-7000-8000-000000000002')).toEqual({
      kind: 'project',
      projectId: '9f1d7c2e-0000-7000-8000-000000000002',
    })
    expect(parseStored('today')).toEqual({ kind: 'today' })
  })

  it('does not notify when the same label is opened twice', () => {
    openLabel('label-1')
    let calls = 0
    const off = subscribe(() => calls++)
    openLabel('label-1')
    expect(calls).toBe(0)
    openLabel('label-2')
    expect(calls).toBe(1)
    off()
  })

  it('captures into Inbox, undated and untagged, from a label route', () => {
    // Auto-tagging is defensible and deliberately not done: nav.ts already
    // refuses to guess a date for a task typed into Upcoming, and silently
    // attaching metadata nobody asked for is the same bet. The sheet is one
    // tap away. `captureTarget` returning no label field is how that is
    // enforced — there is nothing for QuickAdd to pass on.
    const target = captureTarget({ kind: 'label', labelId: 'label-1' })
    expect(target).toEqual({ projectId: inbox, dueOn: null })
  })
})

describe('resolveLabel', () => {
  function label(id: string): Label {
    return {
      id,
      name: id,
      color: 'rose',
      workspace_id: activeWorkspace().workspaceId,
      updated_at: '2026-08-20T00:00:00.000Z',
      deleted_at: null,
      client_id: 'test',
    }
  }

  it('stays on the label while it still exists', () => {
    expect(resolveLabel([label('l1')], 'l1')).toEqual({
      kind: 'label',
      labelId: 'l1',
    })
  })

  it('falls back to Inbox when the label is gone', () => {
    // Deleted here or on another device — both stop appearing in
    // `listLabels`, so one branch covers them. It falls back to a *project*
    // route rather than another label: there is no next-best label, and the
    // app's floor is Inbox, exactly as `resolveProject` decides.
    expect(resolveLabel([], 'l1')).toEqual({
      kind: 'project',
      projectId: inbox,
    })
  })

  it('trusts the stored id while the read has not answered yet', () => {
    // `undefined` means the query has not returned. Treating it as "gone"
    // would bounce every reload through Inbox for a frame.
    expect(resolveLabel(undefined, 'l1')).toEqual({
      kind: 'label',
      labelId: 'l1',
    })
  })
})
```

Extend the file's import from `./nav` with `openLabel` and `resolveLabel`, and
add `import type { Label } from './schema'` beside the existing `Project` type
import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/nav.test.ts`
Expected: FAIL — `openLabel` and `resolveLabel` are not exported.

- [ ] **Step 3: Add the arm and the prefix**

In `app/src/lib/nav.ts`, extend the union:

```ts
export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'label'; labelId: string }
```

Extend the type import to bring in `Label`:

```ts
import type { Project, Label } from './schema'
```

Add the prefix constant below `const KEY`:

```ts
/**
 * Labels store as `label:<uuid>`; every other route stores as a bare word or a
 * bare uuid. A prefix rather than a second key, because the route is one
 * value: two keys could disagree about where you are, and the reconciliation
 * would have no right answer.
 */
const LABEL_PREFIX = 'label:'
```

Then add the branch to `parseStored`, **above** the uuid fallback:

```ts
export function parseStored(stored: string | null): Route {
  if (stored === 'today') return { kind: 'today' }
  if (stored === 'upcoming') return { kind: 'upcoming' }
  // Ahead of the fallback on purpose: that fallback treats anything it does
  // not recognise as a project id, so a label reaching it would open a
  // project that does not exist.
  if (stored !== null && stored.startsWith(LABEL_PREFIX)) {
    return { kind: 'label', labelId: stored.slice(LABEL_PREFIX.length) }
  }
  return {
    kind: 'project',
    projectId: stored ?? activeWorkspace().projectId,
  }
}
```

- [ ] **Step 4: Add `openLabel`**

In `app/src/lib/nav.ts`, after `openView`:

```ts
export function openLabel(labelId: string): void {
  if (route.kind === 'label' && route.labelId === labelId) return
  go({ kind: 'label', labelId }, LABEL_PREFIX + labelId)
}
```

- [ ] **Step 5: Extend `captureTarget`**

In `app/src/lib/nav.ts`, replace `captureTarget`'s body with:

```ts
export function captureTarget(
  route: Route,
  at: Date = new Date(),
): { projectId: string; dueOn: string | null } {
  if (route.kind === 'project') {
    return { projectId: route.projectId, dueOn: null }
  }
  return {
    projectId: activeWorkspace().projectId,
    // A label route dates nothing, and — the part worth saying out loud —
    // tags nothing either. Auto-tagging a task typed while `waiting-on` is
    // open is defensible, and is the same silent metadata this function
    // already refuses to attach in Upcoming.
    dueOn: route.kind === 'today' ? todayLocal(at) : null,
  }
}
```

Also extend the doc comment above it: after the sentence ending "silent
mis-dating SPEC §5.1 warns about.", add:

```
 * A label route is Upcoming's case with one more temptation: the label is
 * right there, and attaching it would be one line. It is not attached, for
 * the same reason.
```

- [ ] **Step 6: Add `resolveLabel`**

In `app/src/lib/nav.ts`, after `resolveProject`:

```ts
/**
 * The route to actually show, given a stored label id and what exists.
 *
 * `resolveProject`'s shape, with one difference that matters: a missing
 * project resolves to *another project*, but a missing label has no next-best
 * label to fall back to, so this returns a whole `Route` and lands on Inbox.
 *
 * Deleting the label you are looking at therefore needs no navigation of its
 * own — the label leaves `listLabels`, this resolves to Inbox, and undoing
 * the delete brings both the label and the route back.
 */
export function resolveLabel(
  labels: Label[] | undefined,
  labelId: string,
): Route {
  // `undefined` means the read has not answered yet — the same reasoning
  // `resolveProject` spells out.
  if (labels === undefined) return { kind: 'label', labelId }
  const exists = labels.some((l) => l.id === labelId)
  if (exists) return { kind: 'label', labelId }
  return { kind: 'project', projectId: activeWorkspace().projectId }
}
```

- [ ] **Step 7: Update the module's doc comment**

In `app/src/lib/nav.ts`, replace the sentence "One string holds it: `'today'`,
`'upcoming'`, or a project uuid." with:

```
 * One string holds it: `'today'`, `'upcoming'`, `` `label:<uuid>` ``, or a
 * bare project uuid. A uuid cannot collide with either word or with the
 * prefix, so a value written by any previous build still loads as the route
 * it always meant and no migration is needed.
```

and delete the old trailing sentence "A uuid cannot collide with either word,
so a value written by the previous build still loads as a project route and no
migration is needed."

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/nav.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the whole suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: the suite green. **`tsc -b` will fail**, and that is the point of
doing this task first: `App.tsx` switches on `route.kind` and now has an arm it
does not handle. Task 4 closes it. If you need a green compiler before then,
stop and do Task 4 — do not silence it with a `default` branch, which would
hide the next arm the same way.

Check the exit codes directly rather than through a pipe — `$?` after `| tail`
is `tail`'s status, not the command's.

- [ ] **Step 10: Commit**

```bash
git add src/lib/nav.ts src/lib/nav.test.ts
git commit -m "feat: a label is a place you can be

The route union's third arm. Labels store under a \`label:\` prefix
because a bare uuid already means a project — stored bare, a label id
would open a project that does not exist, and the failure would look
like a missing project rather than a routing bug.

resolveLabel returns a whole Route rather than an id: a missing project
falls back to another project, but a missing label has no next-best
label and lands on Inbox. Deleting the label you are looking at
therefore needs no navigation of its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `labelling.ts` — which tasks carry one label

**Files:**
- Modify: `app/src/lib/labelling.ts`
- Modify: `app/src/lib/labelling.test.ts`

**Interfaces:**
- Consumes: `TaskLabel` from `./schema` (8a).
- Produces: `tasksWithLabel(links: TaskLabel[], labelId: string): Set<string>`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/labelling.test.ts`, inside the file's top level (a new
`describe` beside the existing three):

```ts
describe('tasksWithLabel', () => {
  it('collects the tasks carrying one label', () => {
    const links = [link('t1', 'a'), link('t2', 'a'), link('t3', 'b')]
    expect([...tasksWithLabel(links, 'a')].sort()).toEqual(['t1', 't2'])
  })

  it('ignores a tombstoned link', () => {
    // SPEC §9: deletions are soft, so a tombstone is still a row. A task
    // someone untagged must not appear under the label they removed.
    const links = [link('t1', 'a', '2026-08-20T00:00:00.000Z')]
    expect(tasksWithLabel(links, 'a').size).toBe(0)
  })

  it('is empty for a label nothing carries', () => {
    // Not an error: a label with no tasks is the ordinary state of one you
    // just created, and its route renders an empty list rather than failing.
    expect(tasksWithLabel([link('t1', 'a')], 'unused').size).toBe(0)
  })
})
```

Extend the file's import from `./labelling` with `tasksWithLabel`. The `link`
helper already exists at the top of this file, with the same signature these
cases use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/labelling.test.ts`
Expected: FAIL — `tasksWithLabel` is not exported.

- [ ] **Step 3: Write it**

In `app/src/lib/labelling.ts`, after `labelsByTask`:

```ts
/**
 * The tasks carrying one label.
 *
 * A `Set` rather than a filtered task list, because the caller has the tasks
 * already — this is the one fact it is missing, and returning a set keeps the
 * filter a membership test rather than a nested scan.
 *
 * It reads the same `task_labels` rows the dots are built from (design,
 * decision 7): the label route filters data the app is holding regardless,
 * which is why `task_labels` carries no `[workspace_id+label_id]` index.
 */
export function tasksWithLabel(
  links: TaskLabel[],
  labelId: string,
): Set<string> {
  const tasks = new Set<string>()
  for (const link of links) {
    // SPEC §9: a tombstone is still a row, and the reader filters it. Doing
    // it here too means a caller reaching past the reader cannot list a task
    // under a label someone removed from it.
    if (link.deleted_at !== null) continue
    if (link.label_id !== labelId) continue
    tasks.add(link.task_id)
  }
  return tasks
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/labelling.test.ts`
Expected: PASS, 15 tests in this file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test -- --run && npm run lint`
Expected: green. `npx tsc -b` still fails on `App.tsx`'s missing arm until
Task 4 — that is expected and is not this task's doing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/labelling.ts src/lib/labelling.test.ts
git commit -m "feat: which tasks carry one label

A Set, not a filtered list: the caller already has the tasks, so this
returns the one fact it is missing and the filter stays a membership
test.

It reads the same join rows the row dots are built from, which is why
task_labels still needs only one access-path index.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The drawer lists labels, and `useRoute` resolves them

**Files:**
- Modify: `app/src/lib/useRoute.ts`
- Modify: `app/src/components/Drawer.tsx`

**Interfaces:**
- Consumes: `resolveLabel`, `openLabel` from `../lib/nav` (Task 1);
  `listLabels` from `../lib/repo` (8a); `dotClasses` from `../lib/labelling`
  (8a).
- Produces: `Nav` gains `labels: Label[]` and `label: Label | undefined`.

- [ ] **Step 1: Teach `useRoute` about labels**

Three edits in `app/src/lib/useRoute.ts`.

a) Extend the imports:

```ts
import { listProjects, listLabels } from './repo'
import { subscribe, getRoute, resolveProject, resolveLabel } from './nav'
import type { Route } from './nav'
import type { Project, Label } from './schema'
```

b) Extend the `Nav` interface, after `projects`:

```ts
  /** Every live label, in name order — what the drawer lists. */
  labels: Label[]
  /** The open label's row, on a label route once `listLabels` answers. */
  label: Label | undefined
```

and extend `route`'s doc comment in that interface with a second sentence:

```
   * A `label` route likewise always names a label that exists — one deleted
   * here or on another device resolves to Inbox before any component sees it.
```

c) Replace the hook body:

```ts
export function useRoute(): Nav {
  const stored = useSyncExternalStore(subscribe, getRoute, getRoute)
  const projects = useLiveQuery(() => listProjects(), [])
  const labels = useLiveQuery(() => listLabels(), [])

  // Both resolutions happen here rather than in the components, for the
  // reason this file's header gives: when the header and the list each
  // worked the route out for themselves, they drifted.
  let route: Route = stored
  if (stored.kind === 'project') {
    route = {
      kind: 'project',
      projectId: resolveProject(projects, stored.projectId),
    }
  } else if (stored.kind === 'label') {
    route = resolveLabel(labels, stored.labelId)
    // A label that resolved away lands on a project route, which then wants
    // the same existence check every project route gets.
    if (route.kind === 'project') {
      route = {
        kind: 'project',
        projectId: resolveProject(projects, route.projectId),
      }
    }
  }

  return {
    route,
    project:
      route.kind === 'project'
        ? projects?.find((p) => p.id === route.projectId)
        : undefined,
    projects: projects ?? [],
    labels: labels ?? [],
    label:
      route.kind === 'label'
        ? labels?.find((l) => l.id === route.labelId)
        : undefined,
    // Still the projects' read alone: `loaded` gates the header's title, and
    // a label route's title comes from `label`, which is undefined until its
    // own query answers.
    loaded: projects !== undefined,
  }
}
```

- [ ] **Step 2: Add the Labels list to the drawer**

Four edits in `app/src/components/Drawer.tsx`.

a) Extend the imports:

```ts
import { openProject, openView, openLabel } from '../lib/nav'
import { dotClasses } from '../lib/labelling'
```

b) Destructure the new field and compute the open label id, replacing the two
lines after `export function Drawer({...}) {`:

```ts
  const { route, projects, labels } = useRoute()
  const openId = route.kind === 'project' ? route.projectId : null
  const openLabelId = route.kind === 'label' ? route.labelId : null
  const [adding, setAdding] = useState('')
```

c) Add the section between the projects `<ul>` and the `<form>` that adds a
project. The projects list keeps `flex-1 overflow-y-auto`; this one does not
grow, so a long project list stays scrollable and the labels stay reachable
below it:

```tsx
        {labels.length > 0 && (
          <>
            <p className="px-3 pb-2 pt-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Labels
            </p>
            {/* Capped, and scrollable past the cap, for the same reason the
                projects list is: the drawer is a fixed-height column and
                whichever list grows without limit pushes the other off it. */}
            <ul className="max-h-48 shrink-0 overflow-y-auto">
              {labels.map((label) => (
                <li key={label.id}>
                  <button
                    type="button"
                    aria-current={label.id === openLabelId ? 'page' : undefined}
                    onClick={() => {
                      openLabel(label.id)
                      onClose()
                    }}
                    className={
                      'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left ' +
                      (label.id === openLabelId
                        ? 'bg-accent/10 font-medium text-neutral-900 dark:text-neutral-100'
                        : 'text-neutral-600 dark:text-neutral-300')
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        'size-2 shrink-0 rounded-full ' + dotClasses(label.color)
                      }
                    />
                    <span className="truncate">{label.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
```

The whole section is behind `labels.length > 0`: a heading over nothing is
noise in a drawer someone opens to move, and 8a's picker is where the first
label comes from.

d) Extend the file's doc comment. After the sentence ending "give the app two
spellings of one concept.", add a paragraph:

```
 * Labels sit below the projects, and are rows only: tapping one opens it.
 * Rename, recolour and delete live in that route's header, which is where a
 * project's live too — see the next paragraph, which is the rule they both
 * follow.
```

- [ ] **Step 3: Run the suite and the linter**

Run: `npm test -- --run && npm run lint`
Expected: green, with the test count unchanged from Task 2 — nothing here is
unit-testable under SPEC §11.3 rule 2. `npx tsc -b` still fails on `App.tsx`'s
missing arm; Task 4 closes it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/useRoute.ts src/components/Drawer.tsx
git commit -m "feat: labels in the drawer, and a route that resolves them

useRoute owns 'which route, and does its target still exist' for
projects already; labels join it there rather than getting a second
hook that could disagree with the first. A label route whose label is
gone resolves to Inbox, and then through the project resolver as well,
so one deleted label cannot land the app on a project that is also
gone.

The rows are rows only. Rename, recolour and delete belong in the
route's header, where a project's already are.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The label route's list

**Files:**
- Create: `app/src/components/LabelList.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `tasksWithLabel` from `../lib/labelling` (Task 2);
  `listAllTasks`, `listProjects`, `listAllTaskLabels` from `../lib/repo` (8a);
  `useProgress`, `useLabels`.
- Produces: `<LabelList labelId={string} onOpen={(id: string) => void} />`.

- [ ] **Step 1: Write `LabelList.tsx`**

Create `app/src/components/LabelList.tsx`:

```tsx
/**
 * One label's tasks, across every project.
 *
 * `AgendaList`'s shape rather than `TaskList`'s: no sections, no section CRUD,
 * no drag, and every row names the project it came from — because the question
 * a label answers ("what am I waiting on?") is never scoped to one project.
 *
 * Its own component rather than a third `kind` on `AgendaList`, for the reason
 * that file gives for not being a mode of `TaskList`: the two differ in
 * affordances and not merely in data. An agenda is grouped by day and a label
 * is not grouped at all — there is no day to group by, and inventing one would
 * be the silent mis-dating SPEC §5.1 warns about.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTasks, listProjects, listAllTaskLabels } from '../lib/repo'
import { tasksWithLabel } from '../lib/labelling'
import { TaskRow } from './TaskRow'
import { useProgress } from '../lib/useProgress'
import { useLabels } from '../lib/useLabels'

export function LabelList({
  labelId,
  onOpen,
}: {
  labelId: string
  onOpen: (id: string) => void
}) {
  const tasks = useLiveQuery(() => listAllTasks(), [])
  const projects = useLiveQuery(() => listProjects(), [])
  const links = useLiveQuery(() => listAllTaskLabels(), [])
  const progress = useProgress()
  const labels = useLabels()

  if (tasks === undefined || projects === undefined || links === undefined) {
    // First read from IndexedDB. Deliberately blank rather than a spinner —
    // it resolves in a frame or two and a flash of spinner reads as slow.
    return <div className="min-h-32" />
  }

  const carrying = tasksWithLabel(links, labelId)
  // `listAllTasks` is position-ordered across the workspace, and this keeps
  // that order rather than imposing one of its own: a label spans projects,
  // and any ordering by due date or name would claim a priority the label
  // does not have.
  const shown = tasks.filter((task) => carrying.has(task.id))
  const names = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="mx-auto max-w-2xl px-3 py-2">
      {shown.length === 0 && (
        <p className="px-2 py-8 text-center text-neutral-400 dark:text-neutral-500">
          Nothing carries this label.
        </p>
      )}
      <ul>
        {shown.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              onOpen={onOpen}
              badge={names.get(task.project_id)}
              progress={progress.get(task.id)}
              labels={labels.get(task.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Note the row still gets its `labels` prop: a task under `waiting-on` that also
carries `errand` shows both dots. Hiding the label you are inside would make
the row disagree with the same row in Today.

- [ ] **Step 2: Render it, and title the route**

Three edits in `app/src/App.tsx`.

a) Add the import after `AgendaList`'s:

```ts
import { LabelList } from './components/LabelList'
```

b) Destructure `label` from `useRoute` and extend the title. Replace:

```ts
  const { route, project, loaded } = useRoute()
```

with:

```ts
  const { route, project, label, loaded } = useRoute()
```

and replace the `title` expression with:

```ts
  const title =
    route.kind === 'project'
      ? loaded
        ? (project?.name ?? 'Lane')
        : ''
      : route.kind === 'label'
        ? // Blank rather than 'Lane' until the label's own query answers:
          // the name arrives in a frame or two, and a placeholder that
          // flashes a different word first reads as the wrong page.
          (label?.name ?? '')
        : TITLES[route.kind]
```

c) Replace the `<main>` body:

```tsx
        <main className="flex-1 overflow-y-auto">
          {route.kind === 'project' ? (
            <TaskList
              projectId={route.projectId}
              view={view}
              onOpen={setOpenTaskId}
            />
          ) : route.kind === 'label' ? (
            <LabelList labelId={route.labelId} onOpen={setOpenTaskId} />
          ) : (
            <AgendaList kind={route.kind} onOpen={setOpenTaskId} />
          )}
        </main>
```

The final `else` narrows to `'today' | 'upcoming'`, which is what `AgendaList`
takes and what `TITLES` is keyed by — so `tsc` catches a fourth arm the same
way it caught this one.

- [ ] **Step 3: Run the suite and the compiler**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **all green now**, including `tsc -b` — the arm Task 1 opened is
closed. If `tsc` still reports a missing case, something else switches on
`route.kind`; find it rather than widening a type.

- [ ] **Step 4: Commit**

```bash
git add src/components/LabelList.tsx src/App.tsx
git commit -m "feat: a label opens the tasks that carry it

AgendaList's shape — every project, and a badge naming which — because
the question a label answers is never scoped to one project. Its own
component rather than a third kind on AgendaList: an agenda groups by
day and a label has no day to group by.

Position order is kept rather than replaced. Ordering by due date would
claim a priority the label does not have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rename, recolour and delete, in the header

**Files:**
- Create: `app/src/components/LabelHeader.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `renameLabel`, `setLabelColor`, `deleteLabel` from `../lib/repo`
  (8a, tested and until now uncalled); `PALETTE`, `dotClasses` from
  `../lib/labelling` (8a); `useInlineRename`; `pushUndo`.
- Produces: `<LabelHeader label={Label} rename={InlineRename} />`.

- [ ] **Step 1: Write `LabelHeader.tsx`**

Create `app/src/components/LabelHeader.tsx`:

```tsx
/**
 * What you can do to the label you are looking at.
 *
 * In the header, not on the drawer row, because that is where a project's
 * rename and archive live and `Drawer.tsx` says why: "the drawer stays a place
 * you pass through rather than a control panel."
 *
 * Delete navigates nowhere. `resolveLabel` sends a route whose label is gone
 * to Inbox, so tombstoning the row moves the app on its own — and undoing the
 * delete brings the label and the route back together.
 */
import { useState } from 'react'
import { setLabelColor, deleteLabel } from '../lib/repo'
import { PALETTE, dotClasses } from '../lib/labelling'
import { pushUndo } from '../lib/undo'
import type { Label } from '../lib/schema'
import type { InlineRename } from '../lib/useInlineRename'

export function LabelHeader({
  label,
  rename,
}: {
  label: Label
  rename: InlineRename
}) {
  const [picking, setPicking] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setPicking((open) => !open)}
        aria-expanded={picking}
        aria-label={`Colour ${label.name}`}
        className="min-h-11 shrink-0 px-2"
      >
        <span
          aria-hidden="true"
          className={'block size-3 rounded-full ' + dotClasses(label.color)}
        />
      </button>
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
        onClick={() => void deleteLabel(label.id).then(pushUndo)}
        className="min-h-11 px-2 text-sm text-neutral-500 dark:text-neutral-400"
      >
        Delete
      </button>
      {picking && (
        // A row of eight, not a colour picker: the palette is a fixed set
        // (design, decision 3), so every choice is one tap. Cycling on tap
        // would be smaller and would cost seven taps to reach one colour.
        <div
          role="group"
          aria-label="Label colour"
          className="absolute right-2 top-full z-30 mt-1 flex gap-1 rounded-xl border border-black/10 bg-white p-2 shadow-lg dark:border-white/15 dark:bg-ink"
        >
          {PALETTE.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPicking(false)
                void setLabelColor(label.id, key).then(pushUndo)
              }}
              aria-label={key}
              aria-pressed={key === label.color}
              className={
                'size-6 rounded-full ' +
                dotClasses(key) +
                (key === label.color ? ' ring-2 ring-accent ring-offset-2' : '')
              }
            />
          ))}
        </div>
      )}
    </>
  )
}
```

`setLabelColor` and `deleteLabel` both push their `UndoStep`, so recolouring by
mistake is Ctrl+Z and deleting is the toast — `deleteLabel` returns its step
with `toast: true`, which 8a already set.

- [ ] **Step 2: Render it in the header**

Three edits in `app/src/App.tsx`.

a) Add the import after `LabelList`'s:

```ts
import { LabelHeader } from './components/LabelHeader'
```

b) Extend the imports from `./lib/repo` with `renameLabel`:

```ts
import { renameProject, archiveProject, renameLabel } from './lib/repo'
```

c) The header needs a rename session for whichever nameable thing is open.
Replace the existing `useInlineRename` call with:

```ts
  // One session for both, because only one of them can be open at a time and
  // two hooks would each hold their own `renaming` flag — leaving a stale one
  // armed when the route changes underneath it.
  const renameable = project ?? label
  const rename = useInlineRename(renameable?.name ?? '', async (name) => {
    if (route.kind === 'label' && label !== undefined) {
      pushUndo(await renameLabel(label.id, name))
      return
    }
    if (project === undefined) return
    pushUndo(await renameProject(project.id, name))
  })
```

d) Make the header's title editable on a label route too. Replace the
`route.kind === 'project' && rename.renaming` condition and the `<h1>`'s
`onDoubleClick` with:

```tsx
            {rename.renaming && renameable !== undefined ? (
              <input
                {...rename.inputProps}
                aria-label={
                  route.kind === 'label' ? 'Label name' : 'Project name'
                }
                className="min-h-11 flex-1 bg-transparent text-lg font-semibold tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
              />
            ) : (
              <h1
                onDoubleClick={
                  renameable !== undefined ? rename.start : undefined
                }
                className="flex-1 truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {title}
              </h1>
            )}
```

e) Add the controls after the closing `)}` of the `route.kind === 'project' &&`
block and before `<InstallButton />`:

```tsx
            {route.kind === 'label' && label !== undefined && (
              <LabelHeader label={label} rename={rename} />
            )}
```

f) The swatch row is positioned against the header, so the header's inner row
needs to be a positioning context. Add `relative` to it:

```tsx
          <div className="relative mx-auto flex max-w-2xl items-center gap-3">
```

g) Update the file's doc comment. Replace "P0b slice 6 — the same project as a
list or a board (SPEC §5, §13)." with "P0b slice 8b — labels (SPEC §4, §13)."
and extend the last paragraph:

```
 * Rename and Archive leave the header on an agenda route rather than being
 * disabled there: a button that never enables is worse than an absent one. A
 * label route swaps them for its own three, by the same rule.
```

- [ ] **Step 3: Run the suite, the compiler and the linter**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: all green, test count unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/LabelHeader.tsx src/App.tsx
git commit -m "feat: rename, recolour and delete a label from its header

Where a project's rename and archive live, and for the reason
Drawer.tsx gives: the drawer stays a place you pass through rather than
a control panel.

Recolour is a row of eight swatches rather than a picker, because the
palette is a fixed set — one tap to any colour, against seven to reach
one by cycling. Delete navigates nowhere: resolveLabel moves a route
whose label is gone, so undo brings back the label and the route
together.

One rename session serves both a project and a label. Two hooks would
each hold their own flag, and the route can change under either.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The browser pass, and the README

**Files:**
- Modify: `app/README.md`

- [ ] **Step 1: Run the full check**

Run: `npm test -- --run && npx tsc -b && npm run lint`
Expected: **256 passed (256)**, 23 files — no new test *file*, since both
additions land in files that already exist. Slice 8a left 245; this slice adds
3 in `labelling.test.ts` and 8 in `nav.test.ts`. If that arithmetic does
not match what you see, reconcile it before moving on rather than editing the
number here. Tasks 3, 4 and 5 add none: SPEC §11.3 rule 2 rules out jsdom and
`@testing-library/react`.

- [ ] **Step 2: Verify in the browser**

Run `npm run dev` and drive the app at a phone viewport (390×844) and a desktop
one. Check the console at the end — the standing bar for this project is zero
errors and zero warnings.

Walk this list:

1. With at least two labels created from a task sheet, open the drawer. A
   `Labels` heading sits below the projects, each row a coloured dot and a
   name.
2. Tap one. The drawer closes, the header shows the label's name, and the body
   lists every task carrying it — from more than one project, each row naming
   its project.
3. A task carrying two labels shows both dots here, including the one you are
   inside.
4. Reload. You are still on the label route — it survived in `localStorage`.
5. Type into the quick-add field. The task lands in Inbox, undated, **and
   untagged** — open it and confirm the Labels row is empty.
6. Double-tap the header title, rename the label, press Enter. The name changes
   in the header and in the drawer. Ctrl+Z puts it back.
7. Tap the header's dot. Eight swatches appear, the current one ringed. Tap
   another: the dot changes, and so does every dot for that label on every row
   behind it.
8. Tap Delete. The toast offers the undo, and the app lands on Inbox by itself.
   Take the undo: the label comes back, and so does the route.
9. Open a label carrying nothing. "Nothing carries this label." — not an empty
   screen.
10. Untag the last task from a label's sheet while that label's route is open
    behind it. The row leaves the list live.
11. At 390px, check the drawer with a long project list: the projects scroll
    and the labels stay reachable below them.
12. Delete a label that a task carries, from the header. Go to that task in
    Today: its dot is gone, and the row is otherwise untouched.

Record anything that surprises you. A finding here is worth more than a passing
test: it is the only place these components are checked at all.

- [ ] **Step 3: Update the README**

In `app/README.md`:

a) Replace the status paragraph's first sentence — "Currently at **P0b slice 8a
— labels** (SPEC §13)." — and the sentence that follows it, with:

```markdown
Currently at **P0b slice 8b — labels** (SPEC §13). A task carries
cross-project tags: create one by typing its name in the sheet, and every task
row shows what it carries as coloured dots — in the list, on a board card and
in Today and Upcoming alike. Labels are listed in the drawer, and opening one
shows every task carrying it across every project, with rename, recolour and
delete in that view's header. Deleting a task takes its labels with it, and one
undo brings back both.
```

b) In the `Layout` code block, add two lines to the `components/` group, after
the `LabelDots.tsx` line:

```
    LabelList.tsx           one label's tasks, across projects
    LabelHeader.tsx         rename, recolour, delete
```

c) In the `npm test` comment inside the Commands block, the parenthesised list
already names `nav` and `labelling`; leave it as it is.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: labels are somewhere you can go

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

**With 8b, slice 8 is done.** What §4 still owes labels after this — `@name` in
quick add, multi-label filtering, reordering — is out of scope by the design's
own list, and the first two belong to §5's search slice.

## Self-review

Run against the spec before starting:

- **8b bullet 1 (drawer list)** — Task 3, behind `labels.length > 0`.
- **8b bullet 2 (`label` route)** — Task 1's union arm and prefix, Task 4's
  list. Rendered like Today: project badges, no sections, no drag.
- **8b bullet 3 (rename, recolour, delete)** — Task 5, in the header, per the
  design's amended Components note.
- **8b bullet 4 (delete tombstones the join rows, tasks untouched)** — shipped
  and tested in 8a's `deleteLabel`; Task 6 item 12 confirms it in the app.
- **Decision 6 (route not filter)** — Task 4. Nothing here filters a project
  in place, and no affordance is added to the list or the board.
- **Decision 7 (one index)** — Task 2 reads `listAllTaskLabels`, the same read
  the dots already run. No new index.
- **`nav.ts`'s stored form** — Task 1, with the bare-uuid fallback tested so
  the union can grow without a migration.
- **`captureTarget`'s new case** — Task 1, asserted to attach neither a date
  nor a label; Task 6 item 5 confirms it in the app.
- **`tasksWithLabel`** — Task 2, the one function the design's `labelling.ts`
  sketch named that 8a did not need.
