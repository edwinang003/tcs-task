# P0b slice 5 — Today and Upcoming, and a route that is not a project

**Status:** approved, not yet implemented
**Date:** 2026-08-20
**Spec references:** SPEC §3, §4.1, §5, §8, §9.1, §11.3, §13

## Why this slice exists

SPEC §13 ends P0b "when it's genuinely pleasant to use on one device". A task
app that can only be read one project at a time is not that: the question a
person actually asks in the morning is *what is due today*, and answering it
today means opening every project in turn and doing the arithmetic by eye.

SPEC §5 already names the answer — Today is "due today + overdue, across all
projects", Upcoming is "next 7 days, grouped by day". This slice builds both.

It is also the slice the codebase has been expecting. `nav.ts` says so in its
header comment:

> Slice 4 widens `Route` to a union with `{ kind: 'today' }` and the drawer
> grows a group above the project list; nothing else moves.

and `listTasks` deliberately filters by project *after* a workspace-wide index
read rather than adding a second index, on the stated grounds that "Today and
Upcoming span every project and want this same workspace-wide read". Both
predictions are honoured below.

### Inbox is already built

SPEC §5 lists Inbox as a view. In the data model it is a project — the one
`activeWorkspace().projectId` returns — and it is already in the drawer's
project list. Making it a second kind of thing would give the app two spellings
of the same concept. **Nothing in this slice touches Inbox.**

## What ships

| | |
|---|---|
| **Today** | Overdue pinned above, then due today, across every project |
| **Upcoming** | Tomorrow to +7 days, one group per day, empty days omitted |
| **Navigation** | Both reachable from the drawer, above the project list, and remembered across a reload |
| **Capture** | Quick add still works in both, and what it captures stays on screen |
| **Row provenance** | Every agenda row names the project it came from |

## The four decisions this design rests on

Each was a real fork, and the reasoning matters more than the outcome.

### 1. Upcoming starts tomorrow

SPEC §5 defines Today and Upcoming separately but does not say whether they
overlap. They do not: Upcoming runs tomorrow through +7.

Complementary views cannot disagree. If today appeared in both, ticking a task
in one would leave a stale copy in the other until something invalidated it,
and the app would have to explain which screen was authoritative. Today stays
the "what now" screen and Upcoming the "what's coming" one.

### 2. A ticked row stays, because it was completed today

In a project, completing a task moves it to the Done section: it leaves the
group you were looking at but stays on the screen. Today has no Done section to
move to, so the same tick would take the row off the screen entirely — on the
one screen a person looks at most, and for the action they perform most.

So an agenda view shows a task that is **incomplete, or completed today**.

The alternative considered was for the list to remember which ids you ticked
while you were looking at it. That version dies on reload, cannot be tested
without a DOM, and puts state in a component that the data can express on its
own. The completed-today rule is a pure function of the rows: the row stays put
when you tick it, is gone the next day, and survives a reload — and it gives a
mild account of what the day contained, which is the honest reading of a view
called Today.

A task completed *yesterday* and due yesterday does not appear. Overdue is for
work still owed.

### 3. Capture lands where you can see it

SPEC §3 puts capture ahead of organization, and SPEC §8 makes the phone the
capture device — so quick add cannot simply be hidden on the two screens the
phone will sit on most.

But a task typed into Today that lands undated in Inbox vanishes as you finish
typing, which reads as a bug and teaches people not to trust the field. So the
route decides the capture target:

| Route | Lands in | Dated |
|---|---|---|
| A project | that project | no |
| Today | Inbox | today |
| Upcoming | Inbox | no |

Upcoming has no single obvious date to assume, and guessing one would be the
silent mis-dating SPEC §5.1 warns about. Undated is the honest answer there.

### 4. Two lists, one row

The project list and the agenda views differ in affordances, not just in data.
The project list has drag, collapsible sections, section rename and delete, and
a new-section form. The agenda views have none of those, and need one thing the
project list must never show: which project a task belongs to.

A single component parameterised into both would read every line through two
lenses, and `TaskList.tsx` is already the largest component in the app. Two
lists that share the row keeps each one readable, and captures the duplication
that actually matters — the row is the part that must stay identical, and now
can only be changed in one place.

## Architecture

```
lib/
  nav.ts          Route becomes a union; openView, captureTarget    [modified]
  agenda.ts       what is overdue, what is due today, the next 7    [new, pure]
  useRoute.ts     the React seam, renamed from useOpenProject       [modified]
  repo/tasks.ts   listAllTasks; addTask takes an optional date      [modified]
components/
  TaskRow.tsx     one row: checkbox, title, due, delete             [new]
  AgendaList.tsx  Today and Upcoming                                [new]
  TaskList.tsx    unchanged, except its row is now TaskRow          [modified]
  Drawer.tsx      the two views, above the projects                 [modified]
App.tsx           title and actions by route; which list to render  [modified]
```

### `lib/nav.ts` — the route grows two members

```ts
export type Route =
  | { kind: 'project'; projectId: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
```

Persistence stays a single string under `lane.route`: `"today"`, `"upcoming"`,
or a project uuid. A uuid cannot collide with either word, so **a value stored
by the current build still loads as a project route** — no migration step, and
an installed phone reopens where it left off rather than at a default.

Two additions beside `openProject`:

```ts
export function openView(kind: 'today' | 'upcoming'): void
export function captureTarget(route: Route): { projectId: string; dueOn: string | null }
```

`captureTarget` is where decision 3 lives, as a pure function rather than a
branch inside `QuickAdd` — it is a rule about routes, and rules about routes
are testable in node.

`resolveProject` keeps its present job, "the stored project is gone, fall back
to Inbox", and now applies only to the project branch of the union.

### `lib/agenda.ts` — new, pure

Beside `grouping.ts` and `drag.ts`, and for the same reason both are there: the
interesting rule deserves a test, not a DOM.

```ts
export interface AgendaGroup {
  key: string
  title: string
  tasks: Task[]
}

export function todayAgenda(tasks: Task[], at?: Date): AgendaGroup[]
export function upcomingAgenda(tasks: Task[], at?: Date): AgendaGroup[]
```

`todayAgenda` returns `Overdue` then `Today`, omitting either if empty.
`upcomingAgenda` returns one group per day from tomorrow to +7, omitting days
with nothing in them — seven headers over two tasks is mostly furniture.

`at` is injected exactly as `dates.ts` injects it, so "due today at 23:00 seen
from 00:30 the next morning" is a unit test rather than a clock mock. All
comparisons stay string arithmetic on `YYYY-MM-DD`, per SPEC §4.1: a task due
Tuesday stays due Tuesday wherever you are.

Both apply the completed-today rule from decision 2, so it is stated once.

**Order within a group** is by due date, then by time with untimed last, then
by `position`. A morning's list should read down the clock; a task due "Tuesday"
with no particular time is the common case (SPEC §4.1) and has no place in that
sequence, so it follows the timed ones rather than sorting to midnight and
claiming the top of the day. `position` breaks the remaining ties so the order
is total and does not shuffle between renders.

**Tasks in archived projects do not appear.** `archiveProject` sets
`archived_at`, and `listProjects` already drops those rows — an archived
project is gone from the drawer, and a task from it surfacing in Today would be
the one place the archive leaked. The agenda reads the same project list the
drawer reads and keeps only tasks whose project is in it, which also guarantees
every row has a name for its badge.

### `lib/repo/tasks.ts` — two small changes

`listAllTasks()` runs the `[workspace_id+position]` read `listTasks` already
runs and drops only tombstones — the workspace-wide read `tasks.ts` reserved
for exactly this.

`addTask` grows an optional `{ dueOn }`. The date is written **in the create,
not in a second write**: a follow-up `setTaskDue` would append a second outbox
entry for one user action and, because the undo store holds a single step
(SPEC §4.5), would push a step over the create's own — so the undo the user
reached for would clear the date and leave the task.

No new writer of `completed_at`, `section_id` or `position` appears anywhere in
this slice. Ticking a row in an agenda view calls the same `setTaskDone` the
project list calls, and the task moves into its own project's Done section.

### `components/TaskRow.tsx` — new

Lifted verbatim out of `TaskList`, with two optional props:

- `badge?: string` — the project's name. Agenda views pass it; the project list
  never does, because there it would be the same word on every row.
- `handle?: Record<string, unknown>` — the drag grip's props. Present only in
  the project list, so **drag is absent from the agenda views because nothing
  hands them a handle**, not because a flag switched it off.

### `components/AgendaList.tsx` — new

Reads `listAllTasks` and `listProjects` through `useLiveQuery`, calls the
matching function from `agenda.ts`, and renders the groups. Empty states are
plain sentences: "Nothing due today", "Nothing in the next 7 days".

### `App.tsx` and `Drawer.tsx`

The header takes its title from the route, and Rename and Archive render only
on a project route — they have no meaning on Today, and a disabled button that
never enables is worse than an absent one. `App` picks `AgendaList` or
`TaskList` from `route.kind`.

The drawer grows Today and Upcoming above the project list, as `nav.ts`
predicted.

## Undo

Nothing new. Every mutation reachable from an agenda view — tick, delete, and
the edits in the sheet — already returns an `UndoStep`, and the row is pushed
by the same `pushUndo` the project list uses.

`addTask` with a date returns the same single step it returns without one,
which undoes the whole creation including the date.

## Testing

Following SPEC §11.3 rule 2 — no jsdom, no `@testing-library/react`:

| Unit-tested in node | Verified in a browser and on the phone |
|---|---|
| `agenda.ts`: overdue vs today bucketing, the completed-today rule, ordering within a group, tasks from archived projects excluded, day grouping, empty days omitted, the local-midnight edge | The drawer's two new entries, and that the route survives a reload |
| `nav.ts`: the route union, persistence round-trip, a stored bare uuid still loading as a project, `captureTarget` for all three routes | Ticking a row in Today leaves it in place, struck through |
| `repo`: `listAllTasks` spans projects and drops tombstones; `addTask` writes the date in one transaction | Capture from Today appearing immediately in Today |

## Out of scope

- **Drag to reschedule in Upcoming.** SPEC §5 calls Upcoming "read-mostly; drag
  to reschedule", and dropping a task on a day header would write `due_on` —
  a different column and a different binding from the drag that just shipped.
  It gets its own slice, once there is a view to drag in. Rescheduling
  meanwhile works through the sheet's due-date field, which is already built.
- **A completed log.** "Completed today" is a filter here, not a history. SPEC
  §13 puts the log in P2.
- **Search, labels, checklists, board view.** The remaining P0b items.

## Risks

| Risk | Mitigation |
|---|---|
| The local-midnight boundary: a task due today read at 00:01 tomorrow | Every comparison goes through `dates.ts`'s `todayLocal`, and `at` is injected so the boundary is a unit test |
| `listAllTasks` grows slow as the workspace grows | It is the read `listTasks` already performs; at personal scale a few thousand rows over an index is single-digit milliseconds, and SPEC §5's search paragraph settles that this scale needs no index |
| Two lists drift apart as rows gain features | The row is one component. A change to what a task looks like has one site by construction |
