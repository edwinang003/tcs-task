# P0b slice 3 — projects, sections, and the done binding

**Status:** approved, not yet implemented
**Date:** 2026-08-18
**Spec references:** SPEC §4, §4.1, §4.2, §4.4, §4.5, §6, §9.1, §9.2, §11.3, §12.2, §13

## Why this slice exists

Slices 1 and 2 built the write seam and made a task a real thing. Both deferred
the same item to here, for the same reason:

| From | Deferred | Reason given |
|---|---|---|
| Slice 1 | The done-section move on completion | "Unchecking needs a section to restore to, and no section UI exists yet" |
| Slice 2 | The done-section move on completion | "Still no section UI to restore a task to" |
| Slice 2 | A toast on completion | "Nothing leaves the screen until the done-section move exists" |

This slice builds the section UI those deferrals were waiting on, and with it
the behaviour SPEC §4 calls the whole thesis:

> **The done section is where the two halves of the product meet.** Each project
> has exactly one section flagged `is_done_section`, and the binding runs both
> ways: checking a task's checkbox moves it into that section, and dragging a
> task into that section checks its checkbox. `completed_at` and `section_id`
> are always written together, never independently.
>
> [...] Google Tasks gives you a checkbox; Trello gives you a Done column; this
> makes them the same gesture. If they were allowed to disagree — a task sitting
> in Done but unchecked — the list and board views would be showing different
> truths about the same row, and the core promise of §5 would quietly break.

Only half of that binding is buildable now: dragging is behind the touch
drag-and-drop spike (§13), which is itself behind the phone deploy. The
checkbox half is not, and it is the half that carries `section_id` into every
completion — so building it now means the drag slice adds a gesture rather than
a data rule.

Projects come with it rather than after it, because a section belongs to a
project (§4) and a done section that only ever exists in one hardcoded list is
not the thesis, it is a filter.

## Scope

**In:**

1. Drawer navigation, with the open project persisted across a reload.
2. Projects: create, rename, archive.
3. Sections: create, rename, delete — with §4.4's rules implemented literally.
4. The list grouped by section, with Done collapsed at the foot.
5. The §4 binding on the checkbox: completing moves the task into the done
   section, unchecking moves it back out.
6. Project and Section pickers in the task sheet — the non-drag way to move a
   task.
7. A completion toast, which only now has something to undo that left the
   screen.

**Out, and where it goes instead:**

| Deferred | Why | Lands in |
|---|---|---|
| Reordering projects and sections | Dragging is the gesture for it; building a second, worse affordance first is waste | The drag slice |
| Dragging a task between sections | The touch spike gates it (§13) | The drag slice |
| Board view | Same spike | After the spike |
| Deleting a project | §4.4 makes it the one genuinely destructive action, needing a local and server-side cascade plus a confirm. Archive is the safe default §4.4 asks the UI to nudge toward, and it ships here | Its own slice |
| Inbox / Today / Upcoming | Views, not projects; they need the due dates slice 2 shipped and the nav this slice builds | Slice 4 |
| Task counts in the drawer | Useful, not load-bearing | Later, if the drawer feels blind |
| Back-button handling for the drawer and sheet | Wants a `history.pushState` overlay stack; better done once, deliberately, than half-done here | Its own small piece of work |
| A `[workspace_id+project_id+position]` index | See *Reads* below | Only if a project read measurably slows |

## Navigation

### No router

SPEC §11.3 rule 2 already settled the general question — "prefer ~40 lines you
own to a package" — when it rejected React Router. `lib/nav.ts` is a module
singleton in exactly the shape `undo.ts` established, read through
`useSyncExternalStore`:

```ts
export type Route = { kind: 'project'; projectId: string }

export function subscribe(listener: () => void): () => void
export function getRoute(): Route
export function openProject(projectId: string): void
```

It persists to `localStorage` on every change, so reopening the installed app
returns you to the project you were in rather than to a default. Slice 4 widens
`Route` to a union with `{ kind: 'today' }` and `{ kind: 'upcoming' }`, and the
drawer grows a group above the project list. Nothing else moves.

Two fallbacks, both of which are tests rather than comments: a stored project
id that no longer exists resolves to the Inbox project, and archiving the
project you are looking at moves you to Inbox too. `workspace.ts` already pins
the Inbox project id, so "Inbox" is a lookup, not a special case.

### What the drawer is

A hamburger in the header opens a left overlay on a phone; at `lg` and wider it
is pinned open as a permanent sidebar. It lists the non-archived projects, with
the open one marked, and a `+ Project` row at the foot. Project rename and
archive live on the open project's `⋯` in the header rather than on the drawer
rows, so the drawer stays a place you pass through rather than a control panel.

### The cost, stated

The Android back button does not close the drawer or the sheet, and does not
step back through projects. This is already true of slice 2's sheet. It is
listed as deferred above rather than quietly ignored.

## The repository layer

### It becomes a directory

`repo.ts` is 226 lines and this slice roughly doubles it. It becomes
`lib/repo/`, and the convention SPEC §11.3 rule 1 asks for survives intact —
restated as *nothing writes except `lib/repo/`*, and inside it nothing opens a
transaction except `write.ts`:

```
lib/repo/
  index.ts      the public surface; re-exports only
  write.ts      create / write / composite — the only place a transaction opens
  tasks.ts      task mutations (moved, unchanged)
  projects.ts   projects
  sections.ts   sections
```

Every existing import stays `from '../lib/repo'`, which is what makes the split
safe to do in the same slice as the feature: the 17 repo tests already written
must pass untouched, and if they do not, the move was wrong.

### One new primitive

`create()` and `write()` are unchanged. The only addition is a way to make
several of them one action:

```ts
/** Several writes, one undo. Reversed newest-first, the order a person expects. */
function composite(label: string, steps: UndoStep[], toast = false): UndoStep {
  return {
    label,
    toast,
    apply: async () => {
      for (const step of [...steps].reverse()) await step.apply()
    },
  }
}
```

The writes themselves become atomic by nesting: Dexie joins an inner
transaction to an outer one when the inner scope is a subset, so wrapping
several `create()` or `write()` calls in one
`db.transaction('rw', projects, sections, tasks, outbox, …)` yields one
all-or-nothing write.

**This is a behaviour the implementation must prove, not assume.** The plan
includes a test that forces a failure part-way through a batch and asserts that
nothing landed — neither rows nor outbox entries. If Dexie does not nest the
way this design expects, that test fails loudly at the point where it is cheap
to change course.

`composite`'s own `apply()` is not one transaction — it is a sequence of
ordinary mutations, each atomic with its own outbox entry, exactly as §4.5
requires ("reapplied as an ordinary new mutation"). Undo has never been atomic
across rows and does not become so here.

### The public surface this slice adds

```ts
// projects.ts
listProjects(): Promise<Project[]>                       // live, non-archived, by position
getProject(id: string): Promise<Project | undefined>
addProject(name: string): Promise<{ id: string; undo: UndoStep }>
renameProject(id: string, name: string): Promise<UndoStep | null>  // '' → null
archiveProject(id: string): Promise<UndoStep | null>     // toast: leaves the drawer

// sections.ts
listSections(projectId: string): Promise<Section[]>      // live, by position
addSection(projectId: string, name: string): Promise<{ id: string; undo: UndoStep }>
renameSection(id: string, name: string): Promise<UndoStep | null>  // '' → null
deleteSection(id: string): Promise<UndoStep>             // toast; throws if missing or refused

// tasks.ts
listTasks(projectId: string): Promise<Task[]>            // was: whole workspace
addTask(title: string, projectId: string): Promise<{ id: string; undo: UndoStep }>
setTaskSection(id: string, sectionId: string): Promise<UndoStep | null>
setTaskProject(id: string, projectId: string): Promise<UndoStep | null>
```

Two terms the rest of this document leans on, defined once:

- **the first open section** of a project — the lowest-`position` live section
  with `is_done_section === false`. Every project has one: §4.4 refuses to
  delete the last of them.
- **appending into a section** — `generateKeyBetween(last, null)` where `last`
  is the highest `position` among that section's live tasks, or `null` when the
  section is empty.

`addTask` appends into the project's first open section, so QuickAdd never
needs to know what a section is. `setTaskProject` moves the task to the target
project's first open section, because a `section_id` from the old project would
orphan the row on arrival.

### Creating a project creates its sections

SPEC §4: "each project has exactly one section flagged `is_done_section`". A
project is therefore never created alone. `addProject` writes the project, a
`Tasks` section and a `Done` section in that order — SPEC §9.2 makes the order
load-bearing, since the project cannot arrive after the sections that reference
it — and returns one `UndoStep` that tombstones all three.

The names match what `db.ts`'s `seedWorkspace` already gives the Inbox project,
so a project created by the user and the project created by the migration are
the same shape.

## The done binding

SPEC §4 is written as a rule about columns, so the rule becomes one private
function that every path into it must go through:

```ts
/** The §4 binding, in one place. Nothing else writes these three columns. */
async function moveTaskTo(
  task: Task,
  target: Section,
  label: string,
  toast: boolean,
): Promise<UndoStep | null> {
  return write(
    'tasks',
    task.id,
    {
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
```

Both public entry points are then thin, and neither can disagree with the
other:

```ts
export async function setTaskDone(id: string, done: boolean) {
  const task = await getTask(id)
  if (task === undefined) return null
  const target = done
    ? await doneSectionOf(task.project_id)
    : await firstOpenSectionOf(task.project_id)
  return moveTaskTo(task, target, done ? 'Task completed' : 'Task reopened', done)
}

export async function setTaskSection(id: string, sectionId: string) {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null
  return moveTaskTo(task, target, 'Task moved', target.is_done_section)
}
```

This is the part of the design the self-review caught. §4's binding is
two-way — "dragging a task into that section checks its checkbox" — and the
sheet's Section picker is the non-drag equivalent of that drag. If the picker
merely set `section_id`, choosing "Done" from it would produce exactly the row
§4 forbids: sitting in Done, unchecked. Routing both entry points through
`moveTaskTo` makes that unrepresentable rather than merely discouraged, and it
means the drag slice adds a third caller rather than a fourth copy of the rule.

Three columns move together in one write, so "never independently" is not
something a later edit can accidentally break by touching one of them.

### What undo does with a move

`write()` already captures the previous values of exactly the columns it
changes, inside the transaction that changes them. Completing a task changes
`completed_at`, `section_id` and `position` — so **undo restores the exact
section and the exact position the task came from, with no new machinery and no
remembered-section column.**

That gives a two-tier answer to "where does unchecking put it?", and both tiers
are honest:

- **Undo** — the exact original section and position.
- **A manual uncheck**, days later — the project's first open section. Nothing
  on the row remembers where it was. A `previous_section_id` column would fix
  that, and it would be a schema change the P1 server carries forever, for a
  case undo already covers well. Not worth it.

### Positions

Positions stay one fractional-index space per workspace (§4.2). Ordering only
ever matters *within* a section, and an append always derives from that
section's own last key, so keys within a section stay distinct. Two tasks in
different sections may hold equal or out-of-order keys relative to each other;
nothing reads them that way.

## §4.4, implemented literally

§4.4 decides these up front "rather than discovered", so the implementation
follows it line by line:

**Delete a section** → "its tasks move to the project's first remaining
section, they are *not* deleted. A section is a status label, and losing a
status should never lose the work." One transaction: append every task into the
target section, then tombstone the section. One composite undo. A toast,
because the section left the screen.

Two refusals, guarded in the repo and simply not offered in the UI:

- the done section — §4 requires exactly one per project;
- the last remaining open section — "a project therefore always has at least
  one section, and deleting the last one is refused".

**Archive a project** → "nothing is deleted; it leaves the sidebar". Sets
`archived_at`, drops out of `listProjects`, undo brings it back, and the open
project falls back to Inbox if it was the one archived.

**A task referencing a section that no longer exists** → "it lands in the
project's first section rather than being dropped. Sync must never silently
discard a row because its parent moved." This is one branch in the grouping
function below, and a test. It cannot happen locally yet — nothing deletes a
section without moving its tasks — but P1's first cross-device delete will
produce exactly this row, and a branch that already exists is much cheaper than
one discovered in the field.

## The list

### Grouping is a pure function

```ts
export interface SectionGroup {
  section: Section
  tasks: Task[]
}

export function groupBySection(
  sections: Section[],
  tasks: Task[],
): SectionGroup[]
```

In `lib/grouping.ts`, framework-free and unit-tested: sections in position
order with the done section forced last regardless of its key, tasks within a
group in position order, empty sections still rendered (they are where you drop
things), and an orphaned `section_id` folded into the first group per §4.4.

Keeping this out of the component is what makes §4.4's orphan rule testable
without a DOM.

### What it looks like

Section name as a small header, then its tasks. The done section renders last,
collapsed, with a count — `▸ DONE (7)` — and expands in place to show its tasks
struck through. It is the only collapsible section: one affordance, one piece
of state, and regular sections have no reason to hide.

The section header carries a `⋯` for Rename and Delete, hidden when the action
is refused. A `+ Section` row sits at the foot of the list, above the collapsed
Done.

### Reads, and the index this slice does not add

`listTasks(projectId)` reads `[workspace_id+position]`, already ordered, and
filters by project in memory. A `[workspace_id+project_id+position]` index
would be the tidier local mirror of §12.2, but slice 4's Today and Upcoming
span every project and want the workspace-wide read anyway — so a second index
would be a second thing to keep correct, for no measured gain on a personal
task list. If a project read ever measurably slows, it is a v3 that adds an
index and needs no upgrade function.

## The sheet

Two pickers join the existing fields: **Project** and **Section**. Changing the
project reloads the section list and moves the task to that project's first
open section. Both are native `<select>` elements — the same reasoning as slice
2's native date and time inputs: the platform's picker is better than one
hand-rolled, on both the phone and the Mac.

The Section picker lists the done section too, and choosing it completes the
task — that is §4's binding, reached without a drag. Changing either picker
commits immediately, like the due date and priority.

## Toasts

The rule from slice 2 holds — **a toast appears when the result is not visible
on screen** — and this slice is where completion finally qualifies:

| Action | Toast | Why |
|---|---|---|
| Complete a task | yes | It leaves the section you were looking at |
| Uncheck a task | no | It appears in the open section, in view |
| Delete a section | yes | The section is gone and its tasks moved |
| Archive a project | yes | It leaves the drawer |
| Create or rename anything | no | The result is on screen |
| Move a task to another open section | no | The row moves in view |
| Move a task into Done via the picker | yes | It completes and leaves the section you were looking at |

Ctrl/Cmd+Z still undoes the last action whether or not it raised a toast.

## Testing

The same posture as slice 2, and for the same reason: a component test harness
is jsdom plus `@testing-library/react` plus a peer — three dependencies against
SPEC §11.3 rule 2 — and the logic that could be subtly wrong here is pure or
repo-level.

**`grouping.test.ts`** — section order; the done section forced last even when
its position sorts first; tasks in position order within a group; empty
sections retained; a task whose `section_id` matches no live section folded
into the first group (§4.4).

**`nav.test.ts`** — persists the open project; restores it on reload; falls
back to Inbox for a stored id that no longer exists; notifies subscribers and
stops after unsubscribe.

**`repo` tests** — a batch that fails part-way leaves nothing behind, neither
rows nor outbox entries; `addProject` writes three rows and three outbox
entries in project-first order; undoing it tombstones all three; completing a
task writes `completed_at`, `section_id` and `position` in one entry; undo
restores the exact section and position; a manual uncheck lands in the first
open section; `setTaskSection` into the done section sets `completed_at` and
out of it clears `completed_at`, so the picker cannot produce a task sitting in
Done unchecked; moving an already-completed task keeps its original
`completed_at`; `deleteSection` moves its tasks before tombstoning; both refusals
throw; `archiveProject` drops the project from `listProjects` and undo brings
it back; `listTasks` returns only the given project's tasks.

Roughly 68 tests today to about 90.

**Verification is `npm test` *and* `npm run build`.** Slice 1 shipped a
TypeScript error past a green test run; `npm test` does not typecheck.

**Then the browser walk**, as in slice 2, including the one check only a real
browser gives: after a section delete moves five tasks, the outbox holds one
entry per touched row — five task entries and one section entry, not six
entries for five tasks.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/nav.ts` | new — the open project, persisted to `localStorage` |
| `src/lib/nav.test.ts` | new |
| `src/lib/grouping.ts` | new — pure: sections + tasks → display groups |
| `src/lib/grouping.test.ts` | new |
| `src/lib/repo/index.ts` | new — the public surface, re-exports only |
| `src/lib/repo/write.ts` | new — `create`, `write`, `composite`; the only place a transaction opens |
| `src/lib/repo/tasks.ts` | moved from `repo.ts`, plus section/project moves and the done binding |
| `src/lib/repo/projects.ts` | new |
| `src/lib/repo/sections.ts` | new |
| `src/lib/repo.ts` | deleted — replaced by the directory |
| `src/lib/repo.test.ts` | unchanged imports; new cases appended |
| `src/components/Drawer.tsx` | new — project list, `+ Project` |
| `src/components/SectionHeader.tsx` | new — name, `⋯` rename/delete, collapse for Done |
| `src/components/TaskList.tsx` | grouped rendering |
| `src/components/TaskSheet.tsx` | Project and Section pickers |
| `src/components/QuickAdd.tsx` | adds into the open project |
| `src/App.tsx` | header with hamburger and project name; drawer |
| `app/README.md` | status line, layout map, the repo-directory convention |

## What this slice does not answer

The drag half of §4's binding — dragging a task into the done section checking
its checkbox — is still unbuilt, and stays unbuilt until the touch spike says
whether dragging on a phone is good enough (§13). This slice's job is to make
that a question about a gesture rather than a question about data: after it,
`section_id` and `completed_at` already move together on every completion, and
the drag slice adds a second way to trigger the same write.
