# Lane — Draft Specification

> **Status:** Draft v0.7 · 2026-08-18 — reviewed, believed build-ready
> **Working name:** "Lane" (placeholder — a lane is both a list and a board column)
> **Author:** drafted with Claude Code, pending review by Edwin

A personal task manager that sits between Google Tasks and Trello: the capture
speed and low ceremony of Tasks, the spatial structure of Trello, and nothing
else. Installable as a PWA on **Android phone, Android tablet, and MacBook**.
Single user at launch, with the data model and authorization built so that
adding teammates later — and turning it into a multi-tenant SaaS after that —
is additive rather than a rewrite (§12.3).

### Changes since v0.6 — fourth pass: dependencies and the SaaS future

Two constraints arrived after v0.6 and both cut against parts of §11 and §12:
**minimise dependency churn**, and **do not paint the SaaS future into a
corner**. Neither changes the architecture — which is the point — but both
change details that are cheap now and expensive later.

- **The sync boundary is now stated: two RPCs, never direct table access** (§9.11). It was left implicit, and §9.8 already assumed a server that could return `426` — which raw PostgREST table access cannot. This is the single chokepoint where quota, rate limiting, audit and version negotiation live if they are ever needed.
- **Pull is paginated from day one** (§9.11). At personal scale it never matters; the §9.7 full re-sync on a stale cursor is what makes it matter later, and retrofitting pagination means changing every client that ever shipped.
- **The outbox can now be told "no" permanently** (§9.1, §9.11). It previously assumed every push failure was transient. Over-quota, revoked membership and suspended workspace are not transient, and retrying them forever is as wrong as dropping them.
- **Dependency policy is written down** (§11.3). React stays. React Router does not — v5→v6 and v6→v7 rewrote its surface twice, which is the worst churn record in the stack for five routes' worth of value.
- **§12.3 extends §12's eight team things with six SaaS things**, and — more importantly — says which SaaS concerns stay non-goals, so this section doesn't become a licence to build a billing system for one user.

### Changes since v0.5 — third review pass

A consistency sweep plus the interaction details the earlier passes skipped in
favour of infrastructure.

- **Two dangling references fixed.** §12.3 didn't exist, and `workspaces.timezone` was used to compute `reminder_at` without ever being a column (§4.1).
- **`is_done_section` had no defined behaviour** despite being the product's whole thesis. The binding is two-way — checking a task moves it to the done section, dragging it there checks it — and `completed_at` and `section_id` are always written together. Let them disagree and the list and board views show different truths about the same row (§4).
- **`default_view` would have synced, and shouldn't.** Switching to board on the tablet would silently switch the phone, which almost always wants the list. Per-device preference, deliberately not in Postgres (§4.1).
- **Quick add now specifies that parsing must be visible and reversible** (§5.1). "Ship the May report" silently acquiring a 1 May due date is the kind of bug that stops you trusting every date in the app.
- **Notes are plain text with linkification**, not markdown — decided rather than left open (§4.1).
- **The five-noun model stress-tested against real tasks** (§4.6). It holds, with one bend: projects serve as both areas of life and endeavours with an end. Resolved by leaning on archiving rather than adding a sixth noun — which makes archiving a prominence requirement in the UI, not an afterthought.

### Changes since v0.4 — second review pass

v0.4 fixed contradictions in what was written. This pass went after what was
*missing* — the load-bearing claims the spec made but never actually specified.

- **RLS was the spec's central claim and had no policies in it** (§12.1). Now written out, with the three traps: a policy that filters tombstones silently breaks sync forever and is invisible in single-device testing; a membership policy on `workspace_members` recurses infinitely; and a bare `auth.uid()` re-evaluates per row where `(select auth.uid())` runs once.
- **No indexes anywhere** (§12.2). The pull query's access path is `(workspace_id, updated_at)` on every synced table — without it every sync is a sequential scan, and the symptom is "sync got slow" with no obvious cause.
- **The sync engine was untestable as designed** (§9.9). "Two devices edited offline then reconciled" cannot be produced by hand, and it's exactly where the bugs are. Reconciliation is now a pure function with injected time and ids, plus a multi-client simulation harness.
- **No backup story** (§9.10). A hand-rolled sync engine holding years of tasks needs an escape hatch that doesn't depend on the sync engine being correct. JSON export moves into P1.
- **A PWA can't force an update** (§9.8), so an old client will push an old schema shape during exactly the window you're iterating fastest. Added a protocol version with an explicit upgrade prompt instead of a silent sync failure.
- **P0 validated the riskiest assumptions last.** Split into P0a — a walking skeleton deployed and installed on the phone on day one — and P0b, the real app. Also moved the touch drag-and-drop spike early, since a bad answer there deletes a chunk of P0b (§13).

### Changes since v0.3 — review pass

Three internal contradictions found and resolved, plus four modelling gaps
closed. Every one of these would have surfaced as rework during P1.

- **Per-field LWW had no mechanism.** §9 promised per-field conflict resolution; §4.1 gave every row a single `updated_at`, which cannot express it. Resolved by moving the resolution to *write* time: the outbox carries a dirty-column set, the push sends only those columns, and the server updates only them (§9).
- **Outbox coalescing contradicted per-field merge.** §9.1 said to store current row values — which discards the dirty-column set the merge depends on, quietly degrading per-field LWW back to whole-row clobbering (§9.1).
- **Pull could destroy unsent edits.** Applying a remote row wholesale overwrites locally-dirty columns. Pull now merges column-wise, skipping dirty ones (§9).
- **`workspace_id` was missing** from `sections`, `checklist_items` and `task_labels`, contradicting §12's first rule and forcing multi-table joins in every RLS policy (§4.1).
- **`due_at timestamptz` could not express an all-day task** and would shift the due day when travelling. Split into `due_on date` + optional `due_time time` (§4.1).
- **Server-owned columns were pushable by clients** — a stale `reminder_sent_at` would cause duplicate reminder buzzes (§4.1).
- **Recurring instances had no link to their series**, and generation was unspecified — it must happen client-side, or a task completed offline vanishes until sync (§4.3).
- **New: §4.4 parent-deletion rules and §4.5 undo semantics**, neither of which survives contact with an outbox unless decided up front.

### Changes since v0.2

- **Offline editing confirmed as a hard requirement** (A2). This doesn't change the architecture — §9 already assumed it — but it removes the escape hatch, so the parts that were previously hand-waved are now load-bearing and specified: the outbox, offline auth, clock skew, cold start, and local migrations. See §9.1–§9.7.
- **P0 gains an architectural constraint.** Writes must go through a repository layer that already emits outbox entries, even with no server to push to (§13). Otherwise every write path is rewritten in P1.
- All major stack and scope questions are now closed. §14 is down to preferences.

### Changes since v0.1

- **iPad and iOS dropped from scope.** Every Apple-mobile constraint in v0.1 — manual Share-sheet install, no Background Sync, push-only-once-installed, aggressive storage eviction, the $99/yr provisioning tax — is gone with it. If an iPad returns later, revisit §8.
- **Closed-app reminders confirmed as a hard requirement** on phone and tablet. This settles open question Q2 and promotes reminders from P2 to P1.
- **Native (Flutter / Capacitor) evaluated and rejected.** Reasoning recorded in §11.
- Remaining targets are all Chrome-class, which upgrades several capabilities from "verify" to "supported" (§8) and makes Background Sync usable (§9).
- New §10: reminder delivery architecture, since it is now a P1 requirement.

---

## 1. Assumptions

These shaped the whole document. Correct any that are wrong and the spec changes
materially.

| # | Assumption | If wrong… |
|---|---|---|
| A1 | Three devices — Android phone, Android tablet, MacBook — so cross-device sync is required. | A local-only app halves the work; drop §9 entirely. |
| A2 | **Confirmed.** Full offline editing — create, edit, complete, reorder — with no network, on any device. | — settled, see §9. |
| A3 | **Confirmed.** Due-date reminders must arrive on phone and tablet while the app is closed. | — settled, see §10. |
| A4 | Personal scale: hundreds of active tasks, low thousands lifetime. | A different scale changes the sync strategy (§9). |
| A5 | You'd rather run managed infrastructure than self-host. | Self-hosting is viable; see §11 alternatives. |
| A6 | "Team later" means a handful of people in shared projects, not org-wide with permissions matrices. | Real multi-tenancy needs more up-front modelling. |
| A7 | No iPad or iPhone in scope. | If either returns, §8 and §10 need rework — Apple platforms are the constrained case. |
| A8 | A multi-tenant SaaS is plausible later — not planned, but likely enough that the parts which are expensive to retrofit get built for it now (§12.3). | If it is genuinely never happening, everything §12.3 asks for is still cheap and §9.11 is still the right shape. Nothing is wasted. |

---

## 2. Positioning

The point of the product is what it refuses to become.

**Taken from Google Tasks**
- Capture in under two seconds, one-handed, from the phone lock screen outward
- A task is a line of text with a checkbox. Everything else is optional
- Flat, fast, forgettable — no setup ritual before you can use it
- Completing something is satisfying and immediate

**Taken from Trello**
- Tasks live in named columns you define; a column *means* something
- Drag to change state; position carries information
- A card can open into detail — notes, checklist, labels — without demanding it
- You can see a whole project's shape at a glance

**Taken from neither**
- The same project is viewable as **either a list or a board**, toggled, over identical data. A column in board view is a section header in list view. This is the core idea of the product, and it's the thing neither reference app does.

---

## 3. Principles

1. **The UI never waits for the network.** Every read and write hits the local database. Sync is a background process the user never watches. (See §9.)
2. **Capture beats organization.** If adding a task takes more than one field, the design is wrong. Sorting it out later is a separate, optional act.
3. **No empty-state homework.** The app is useful the first second it opens, with defaults already in place.
4. **Simple means fewer concepts, not fewer features.** Every new noun the user must learn is expensive; a new verb on an existing noun is cheap.
5. **Single-user today, multi-user-shaped underneath.** Nothing in the schema or the authorization path assumes there is only one person. (See §12.)

---

## 4. Core concepts

Five nouns. That is the whole mental model.

```
Workspace          your personal space; later, a shared team space
  └── Project      "Home", "Work", "Reading" — a board or a list
        └── Section    a column: "Todo" / "Doing" / "Done", or "This week" / "Later"
              └── Task     the thing itself
                    └── Checklist item   sub-steps, no nesting beyond this
Label              cross-project tags: "errand", "waiting-on", "quick"
```

Deliberate constraints:
- **Sections belong to a project.** No global status vocabulary to maintain.
- **Checklist items are not tasks.** They have no due date, no labels, no detail view. This is what stops the app growing into a project-management tool.
- **One level of nesting.** No subtask trees.
- **A task is in exactly one project and one section.** Labels handle everything cross-cutting.

**The done section is where the two halves of the product meet.** Each project
has exactly one section flagged `is_done_section`, and the binding runs both
ways: checking a task's checkbox moves it into that section, and dragging a task
into that section checks its checkbox. `completed_at` and `section_id` are
always written together, never independently.

This is worth stating explicitly because it is the whole thesis in one
behaviour. Google Tasks gives you a checkbox; Trello gives you a Done column;
this makes them the same gesture. If they were allowed to disagree — a task
sitting in Done but unchecked — the list and board views would be showing
different truths about the same row, and the core promise of §5 would quietly
break.

### 4.1 Data model

Every table carries the sync and multi-user columns from day one, even while
they're trivially populated. See §12 for why.

```
users              id · email · display_name · created_at
workspaces         id · name · timezone · created_at
workspace_members  workspace_id · user_id · role(owner|member) · joined_at
projects           id · workspace_id · name · color · icon · default_view(list|board)
                   · position · archived_at
sections           id · workspace_id · project_id · name · position
                   · is_done_section
tasks              id · workspace_id · project_id · section_id
                   · title · notes · due_on · due_time · reminder_at
                   · reminder_sent_at · priority(0-3) · completed_at
                   · recurrence_rule · recurrence_parent_id · position
                   · created_by · assignee_id
checklist_items    id · workspace_id · task_id · title · done · position
labels             id · workspace_id · name · color
task_labels        workspace_id · task_id · label_id
push_subscriptions id · user_id · device_label · endpoint · p256dh · auth
                   · reminders_enabled · created_at · last_seen_at
```

**`workspace_id` really is on every row**, including `sections`,
`checklist_items` and `task_labels` where it is strictly redundant — you could
reach it by joining through the parent. Denormalizing it is what lets every RLS
policy be the same single-table membership check (§12.1) instead of a two- or
three-table join, which is both faster and much harder to get subtly wrong.

**Due dates are a date plus an optional time, not a timestamp.** `due_on date`
and `due_time time` (nullable) rather than a single `due_at timestamptz`. Two
reasons: "due Tuesday" with no particular time is the common case and a
timestamp can't express it without a fake hour; and a task due Tuesday should
stay due Tuesday when you fly somewhere, which a `timestamptz` will not do.
`reminder_at` *is* a `timestamptz` — it names a real instant — and is computed
from `due_on` + `due_time` + the workspace timezone at the moment the reminder
is set.

**Priority runs 0 = none, 3 = highest**, so `!2` in quick-add is "high" and the
default is a real zero rather than a magic sentinel.

**`workspaces.timezone`** is what turns a `due_on` + `due_time` into the
`reminder_at` instant. It belongs on the workspace rather than the device
precisely so that all three devices agree on when "Tuesday 9am" is, regardless
of which one set it or where you happen to be standing.

**`default_view` is a per-device preference and is deliberately NOT synced.**
It lives in local storage, not in Postgres, despite appearing on `projects`
above as the workspace-wide *initial* value. Syncing it would mean switching to
board view on the tablet silently switches the phone too — and the phone almost
always wants the list while the tablet wants the board. This is the one place
where "the same data everywhere" is the wrong instinct.

**Notes are plain text**, with URLs auto-linked at render time. Not markdown.
A notes field is where a simple task app grows a rich-text editor, a toolbar,
and a serialization format to migrate later; plain text with linkification
covers the actual use — a phone number, an address, a link, a couple of lines of
context — at a fraction of the cost.

Present on **every** syncable row:

```
id           UUIDv7, generated on the client (offline creation requires this;
             v7 is time-sortable, which keeps index locality sane)
updated_at   server-stamped on write
deleted_at   soft delete — a tombstone, so other devices learn about deletions
client_id    which device last wrote; used to skip echoing your own changes
```

`push_subscriptions` is the one table that is deliberately **not** synced to
clients — it is per-device server state, written once at subscribe time.

**Server-owned columns are never pushed by a client.** `updated_at` and
`reminder_sent_at` are written by the server only; a client that pushes a stale
`reminder_sent_at` would silently un-send a reminder and cause a duplicate
buzz. The push payload whitelist is explicit, and these columns are not on it.

### 4.2 Ordering: use fractional indexing

`position` is a **string**, not an integer — a base-62 fractional index
(the `fractional-indexing` npm package, LexoRank-style).

This is worth insisting on early. With integer positions, dropping a card
between two others means renumbering its neighbours, so two devices reordering
the same list offline produce a merge conflict across many rows. With fractional
indexing, an insert between `"a0"` and `"a1"` is a single write of `"a0V"`
touching one row, and concurrent reorders on different devices merge without
conflict. Retrofitting this later means migrating every ordered table.

### 4.3 Recurring tasks

Store a rule on the task; when it's completed, generate the next instance and
leave the completed one in history. Two modes are needed and they behave
differently — pick per task:

- **From due date** — "every Monday" stays every Monday even if you check it off on Wednesday.
- **From completion** — "every 30 days" restarts the clock when you actually do it (water plants, change filter).

When a recurring task regenerates, its `reminder_at` shifts with it and
`reminder_sent_at` resets to null.

Each generated instance carries `recurrence_parent_id` pointing at the original.
Without it there is no way to answer "show me this task's history" or to edit
the series rather than one occurrence — and adding the link later means
backfilling relationships that no longer exist anywhere.

**Generation happens on the client, in the same transaction as the completion.**
Doing it server-side would mean a task completed offline produces no next
instance until sync — so the recurring task silently vanishes from your list
until you have signal. The generated instance is an ordinary local insert with a
client-generated id, so it syncs like anything else.

### 4.4 What happens when a parent goes away

Soft deletes plus offline editing make orphaning a real possibility rather than
a theoretical one, so these are decided up front rather than discovered:

- **Delete a section** → its tasks move to the project's first remaining section, they are *not* deleted. A section is a status label, and losing a status should never lose the work. A project therefore always has at least one section, and deleting the last one is refused.
- **Delete a project** → its sections, tasks and checklist items are tombstoned with it, cascading locally and server-side. This is the one genuinely destructive action in the app, so it confirms and stays undoable for the session.
- **Archive a project** → nothing is deleted; it leaves the sidebar and its tasks leave Today and Upcoming. Archiving is the safe default the UI should nudge toward.
- **Delete a label** → `task_labels` rows tombstone; tasks are untouched.
- **A task arrives referencing a section deleted on another device** → it lands in the project's first section rather than being dropped. Sync must never silently discard a row because its parent moved.

### 4.5 Undo

Undo is listed as a must-have, and with an outbox it needs a definition rather
than a hand-wave. It is **local, session-scoped, and single-level per action**:
the previous value of the changed columns is held in memory and reapplied as an
ordinary new mutation. It is not a sync operation and it never rewinds the
outbox — an undo that shipped after its own edit already pushed would race the
server. Undoing a soft delete is simply clearing `deleted_at`, which is why
soft deletes make this cheap.

### 4.6 Stress-testing the five nouns

A model this small is only worth defending if real tasks actually fit it. Run
the awkward ones through before building:

| Real thing | Where it lands | Verdict |
|---|---|---|
| "Buy milk" | Inbox, no project | Fine — this is the common case |
| "Pay rent", monthly | Home project, recurrence from due date | Fine |
| "Waiting on Bob's reply" | `waiting-on` label, any project | Fine — this is what labels are for |
| "Someday: learn piano" | A "Someday" section in a project | Fine — a section, not a new concept |
| "Plan trip to Japan" with a dozen dated steps | **Its own project**, steps as tasks | See below |
| A task belonging to two projects | Not supported; use a label | Accepted limitation |

The trip is the one that bends the model. It has an end, whereas "Home" and
"Work" do not — so projects end up serving as both *areas of life* and
*endeavours with a finish line*. Things.app splits these into Areas and
Projects; Todoist nests sub-projects.

**Resolution: let projects be both, and lean on `archived_at`.** Adding a sixth
noun to keep the taxonomy tidy costs more than the tidiness is worth, and Trello
— one of the two reference points — already treats a board as both. What this
does require is that **archiving be prominent in the UI**, not buried: it is the
only thing distinguishing a finished endeavour from a permanent area, and if
archiving is hard to reach, the sidebar fills with dead projects within months.
Checklist items cover the trip's small steps; sections cover its phases.

---

## 5. Views

| View | What it is | Notes |
|---|---|---|
| **Inbox** | Default landing spot for anything captured without a project | The pressure valve that makes fast capture possible |
| **Today** | Due today + overdue, across all projects | Overdue pinned at top and visually distinct |
| **Upcoming** | Next 7 days, grouped by day | Read-mostly; drag to reschedule |
| **Project** | One project, toggled between **list** and **board** | The toggle is per-project and remembered |
| **Search** | Full-text across title + notes, filterable by label/project/date | Local index — must work offline |

**Search is local and deliberately dumb.** IndexedDB has no full-text engine,
and at personal scale it needs none: a case-insensitive substring scan over
titles and notes across a few thousand rows is single-digit milliseconds. Build
that, not an index. If it ever slows down, add an in-memory inverted index
(MiniSearch) built at load — still no server round trip, because a search that
fails offline would violate the app's central promise.

**List ⇄ board is a rendering choice, not a data choice.** In list view, sections
are collapsible headers with tasks beneath. In board view, the same sections are
columns and the same tasks are cards. Dragging works in both. Nothing is lost
switching between them, and there is no "convert this project" action.

### 5.1 Quick add, and why the parser must show its work

Quick add is the "capture beats organization" principle made concrete, so it
gets a real definition rather than one example.

```
pay rent fri 5pm #home @errand !2
└─ title ────┘ └date┘ └proj┘ └label┘ └priority
```

- `#name` project · `@name` label · `!0`–`!3` priority · everything else is date text, parsed with **chrono-node**, and whatever remains is the title.
- Unknown `#project` offers to create it inline rather than failing.
- A literal `#` or `@` survives by being escaped, or simply by not matching a known name.

**The rule that makes this trustworthy: parsing must be visible and
reversible.** As you type, the matched tokens highlight in place and a preview
line reads "Home · Fri 22 Aug, 5:00pm · high". Any token can be dismissed with a
click or Escape, which drops it back into the plain title.

Without that, a task titled "Ship the May report" silently acquires a due date
of 1 May, and "email #2 about the invoice" silently acquires a project. Natural
language parsing is *guessing*, and a guess that hides itself is worse than no
parsing at all — one silent mis-date is enough to stop trusting every date in
the app. This is why quick add sits in P2: the naive version is an afternoon,
and the trustworthy version is the only one worth shipping.

---

## 6. Scope

**Must have (P0–P1)**
- Create / edit / complete / delete tasks; undo for destructive actions
- Projects with sections; drag to reorder and to move between sections
- Due dates and times; overdue state
- Notes (plain text or lightweight markdown) and checklist items
- Labels with colors; filter by label
- List ⇄ board toggle per project
- Inbox / Today / Upcoming / Search
- Quick add from anywhere, keyboard-first on desktop
- Works fully offline; syncs across all devices
- Installable PWA with a real app icon on all three devices
- **Push reminders on phone and tablet, with complete/snooze from the notification** (§10)
- **Export the whole workspace to a JSON file** (§9.10) — the backup story for a hand-rolled sync engine

**Should have (P2)**
- Natural-language quick add: `pay rent fri 5pm #home !2` parses date, project, priority
- Recurring tasks
- Android share-target: share a link or text from any app to create a task
- Archive completed tasks; a completed-log view
- Per-device reminder toggle (phone and tablet yes, laptop optional)
- App icon badge showing today's due count
- Light/dark following the OS

**Later (P3+, team)**
- Invite people to a workspace; assignees
- Comments on tasks; activity feed
- Per-project sharing rather than whole-workspace

---

## 7. Non-goals

Explicit, so future-me doesn't relitigate them:

- Swimlanes, multiple boards per project, or nested boards
- Automations, rules, "power-ups", integrations marketplace
- Gantt charts, dependencies, timelines, story points, sprints
- Time tracking
- Custom fields
- Two-way calendar sync (one-way ICS feed out is acceptable in P3)
- Email-in / task-from-email
- Native Android or macOS applications (see §11 for the reasoning)
- iOS / iPadOS support (A7)
- Real-time collaborative cursors or collaborative rich-text editing

---

## 8. Platform reality

With Apple's mobile platforms out of scope, all three targets are Chrome-class
and the capability picture is uniform.

> ⚠️ Browser support moves quickly. Verify against current Chrome and Safari
> release notes at build time rather than trusting this table.

| Capability | Android phone + tablet (Chrome) | MacBook (Chrome / Edge) | MacBook (Safari 17+) |
|---|---|---|---|
| Install | Prompted, in-app | Prompted, in-app | Add to Dock |
| Offline / service worker | Yes | Yes | Yes |
| Web push | Yes — via FCM | Yes | Yes |
| Notification actions (complete / snooze) | Yes | Yes | Limited — verify |
| Background Sync API | Yes | Yes | No |
| App badge count | Yes | Yes | Verify |
| Share target (share *into* the app) | Yes | No | No |
| Persistent storage | Granted for installed PWAs | Generally granted | More conservative |

Consequences for the build:

1. **Install is prompted, not manual.** `beforeinstallprompt` fires on Android Chrome and desktop Chrome, so a real "Install" button works. No Share-sheet instructions needed.
2. **Background Sync is available** on both Android and desktop Chrome. Use it to flush the outbox opportunistically — but keep the foreground triggers in §9 as the primary path, since Safari on the MacBook lacks it and depending on it would make the Mac a second-class client.
3. **Reminders go through Web Push, and on Android that is FCM** — the same transport a native Android app uses. See §10.
4. **Android is the capture device; the Mac is the organizing device.** Share-target and one-handed quick add matter on Android. Keyboard shortcuts, multi-select, and drag-heavy board reorganizing matter on the Mac. Design each interaction for the device it actually happens on.
5. **Storage persistence is reliable here.** Still call `navigator.storage.persist()` on first run, and still treat the server as the durable copy.
6. **Drag on a phone is awkward regardless of platform.** Use `dnd-kit` for real touch support, always offer a non-drag "Move to…" fallback, and default to list view at phone widths. The tablet is wide enough for board view; the phone mostly isn't.

---

## 9. Offline and sync

**Architecture in one line:** the UI reads and writes IndexedDB; a background
sync loop reconciles IndexedDB with Postgres.

```
 UI components
      │  live queries (Dexie + useLiveQuery)
      ▼
 IndexedDB  ──────────── outbox (dirty rows) ────────────┐
      ▲                                                   │
      │  apply remote changes                             │ push
      │                                                   ▼
 sync engine ◄──── pull: sync_pull(workspace, cursor, limit) ────── Postgres
      ▲                                                   │
      └───────── realtime invalidation (websocket) ◄──────┘
```

**Pull.** Client keeps a `last_pulled_at` cursor. It asks for every row in the
workspace changed after that cursor, tombstones included, and applies them
locally — a page at a time, advancing the stored cursor only once the last page
lands (§9.11).

**Push.** Dirty rows go up in one batch. The server stamps `updated_at`,
returns the new cursor, and answers with a verdict per entry (§9.11).

**Conflicts.** Last-write-wins, resolved per field rather than per row, so
editing a task's due date on the phone while editing its notes on the laptop
doesn't lose either. Combined with fractional-index positions, this removes
essentially every conflict a single user can realistically create. Full CRDTs
(Yjs) are only warranted if collaborative editing of note bodies is ever wanted
— that's a P3+ question, not a now question.

**How per-field LWW actually works**, since a single row-level `updated_at`
cannot express it: the resolution happens at *write* time, not at merge time.
The outbox records which columns are dirty (§9.1), the push sends only those
columns, and the server issues an `UPDATE` touching only them. A field nobody
edited is never written, so it cannot be clobbered. Two devices dirtying the
*same* field is the only real collision left, and that one falls back to
whoever pushes last (§9.4).

This has a consequence for pull that is easy to miss: **applying a remote row
must not overwrite locally-dirty columns.** A whole-row overwrite on pull would
silently discard unsent local edits — exactly the data loss the outbox exists to
prevent. Merge remote rows column-wise, skipping any column currently dirty in
the outbox.

**Triggers.** On launch, on tab becoming visible, every 60s while focused, on
realtime notification, after any local write settles (debounced ~2s), and via
Background Sync where available.

**Deletions are soft.** `deleted_at` is set, the row stays. A device offline for
a week must learn that something was deleted; without tombstones it silently
resurrects it on next push. Purge tombstones server-side after ~90 days.

Offline editing is a hard requirement (A2), which makes everything below
load-bearing rather than nice-to-have. These are the parts that go wrong.

### 9.1 The outbox

Every local mutation writes the row **and** appends an outbox entry **in the same
IndexedDB transaction**. A row written without its outbox entry is a silently
lost change — this atomicity is the single most important detail in the sync
engine.

- **Ordered.** Entries carry a monotonic local sequence number and push in that order.
- **Coalesced per row, keyed by dirty column.** Editing one task's title twelve times offline is one push carrying the final value, not twelve. An entry stores the row id and the **set of dirty column names** — not a delta log, and not the whole row. The dirty set is what makes per-field merge possible (§9); a coalesced "current row values" entry would throw away exactly the information the server needs, and quietly turn per-field LWW back into whole-row clobbering.
- **Idempotent.** Pushing the same entry twice must be harmless — the server upserts by row id, so a retry after an ambiguous network failure is safe.
- **Durable under failure.** On success, clear the entries; on failure, exponential backoff and keep them. Never drop an entry because a push failed.
- **Rejectable, not merely retryable.** Some failures never resolve: the workspace is over a plan limit, membership was revoked, the row breaks a server-side rule (§12.3). Retrying those forever is wrong and so is silently dropping them. The push response carries a **per-entry verdict** — accepted, retry, or rejected-with-reason — and a rejected entry is parked, surfaced to the user with its reason, and never retried automatically. This costs one field in a response shape today; retrofitting it into an outbox that assumes all failures are transient means auditing every write path in the app (§9.11).
- **Visible but not blocking.** The UI never waits on the outbox, but a subtle "3 pending" indicator earns trust — especially in the first weeks when you don't yet believe the sync works.

### 9.2 Push in referential order

Create a project offline, add a section to it, add tasks to that — then sync.
If tasks arrive before their project, the foreign key fails.

Push each batch in fixed dependency order: `workspaces → projects → sections →
tasks → checklist_items → labels → task_labels`. This is simpler and more
debuggable than deferring constraints server-side, and the ordering never
changes because the schema's shape doesn't.

### 9.3 Auth must not gate the local database

The one that bites hardest. Supabase JWTs expire (an hour by default) and
refreshing needs the network. If the app requires a valid session to render,
then opening it on a plane means a login wall in front of data already sitting
on the device.

**Rule: auth gates sync, never the UI.** Persist the user and workspace ids
locally. On launch, render from IndexedDB immediately, attempt a token refresh
in the background, and surface an auth problem only when a sync actually fails —
as a quiet banner, not a redirect. Reads and writes to the local database must
work with no session at all.

### 9.4 Clock skew: never let the client's wall clock resolve a conflict

Device clocks are wrong, sometimes by hours. Last-write-wins comparisons must
not depend on them.

- The **server** stamps `updated_at` authoritatively on receipt. That value resolves conflicts.
- The **client** orders its own pending edits with a local monotonic counter, not wall time.
- Client wall-clock time is fine for *display* ("edited 5 minutes ago"), corrected by the offset observed at last sync.

The accepted consequence: an edit made offline at 09:00 and pushed at 17:00 gets
`updated_at` of 17:00, so it beats a competing edit that synced at noon —
"newest sync wins", not "newest edit wins". For one person across three devices
this is usually the intuitive result anyway. If it ever proves wrong, the fix is
to send the client timestamp alongside, corrected by measured skew, and resolve
on that — more correct, meaningfully more complex, and not worth it yet.

### 9.5 Cold start on a new device

The first sync pulls the whole workspace. At personal scale that's a few
thousand rows and a handful of megabytes — fine, but paginate it (cursor plus
limit) so it can't time out on a bad connection, and show progress. Local writes
during the initial pull are safe, since ids are client-generated UUIDs and can't
collide.

### 9.6 Local schema migrations with a dirty outbox

Dexie versions the local schema, and upgrades will land while entries are still
pending. Keep the **outbox schema stable** and version only the data tables. If
the outbox format ever genuinely must change, drain it under the old shape
before applying the new one — and never ship a migration that discards pending
entries.

### 9.7 Conflicts a single user can actually create

| Situation | Resolution |
|---|---|
| Same field edited on two devices | Server `updated_at` wins (§9.4) |
| Different fields of one task edited on two devices | Both survive — per-field merge |
| Reordered on two devices | Both apply; fractional indices merge without collision (§4.2) |
| Deleted on A, edited offline on B | **Tombstone wins.** If the task is open on B when the deletion arrives, say so rather than closing it silently |
| Device offline longer than the 90-day tombstone purge | `last_pulled_at` older than the purge window forces a **full re-sync** instead of a delta pull — otherwise deleted rows resurrect |

That last row matters: the 90-day purge and the delta-pull cursor are only safe
together if the client checks its cursor age on every pull.

### 9.8 Two clients on different versions

A PWA cannot force an update. A service worker on the tablet may sit a version
behind the phone for days, which means **an old client will push a payload
shaped for an old schema** — during exactly the window when you're iterating
fastest.

Put a `protocol_version` integer in every push and pull payload. The server
accepts the current version and the one before it, and returns a explicit
`426 Upgrade Required` outside that window; the client turns that into a "Lane
needs to reload to keep syncing" banner with a reload button, rather than a
silent sync failure. Local edits stay safe in the outbox throughout — this is a
pause, never a loss.

### 9.9 Making the sync engine testable

The sync engine is the one part of this app that cannot be verified by using it.
"Two devices edited the same task offline and then reconciled" is not a thing
you can reliably produce by hand, and it is precisely where the bugs will be.
So the design has to be shaped for testing from the start:

- **Write the reconciliation as a pure function** — `(localRows, outbox, remoteChanges) → (rowsToWrite, outboxAfter, pushPayload)`. No IndexedDB, no fetch, no clock. Everything in §9.1–§9.7 is then a unit test that runs in milliseconds with no browser.
- **Inject time and ids.** A sync engine that calls `Date.now()` or `crypto.randomUUID()` internally cannot be tested deterministically. Pass both in.
- **Build a multi-client simulation harness** — N in-memory clients plus a fake server, scripted to go offline, diverge, and reconcile. Every conflict row in §9.7 becomes a scenario. This is a few hundred lines and it is the difference between trusting the sync and hoping.
- **Property test the fractional indexing.** Random interleaved reorders from two clients should always converge to a consistent order with no duplicate positions.

The rest of the app can be tested by using it. This part cannot, and it is also
the part where a bug means silently losing work rather than a visible error.

### 9.10 Export, because the sync engine is hand-rolled

A hand-rolled sync engine holding years of personal tasks needs an escape hatch
that does not depend on the sync engine being correct. **Export the whole
workspace to a JSON file, generated entirely from the local database, in P1.**

It costs an afternoon, it is the backup story, it is the "I want to leave"
story, and it is the thing that makes a sync bug an inconvenience rather than a
catastrophe. Import of that same file can wait.

### 9.11 The sync boundary is two endpoints, not table access

The spec has been describing pull and push as if they were HTTP endpoints
without ever saying they must be. Supabase makes direct table access the path of
least resistance — `supabase.from('tasks').select()` with RLS doing the
authorization — and for a single user that genuinely works. It is still the
wrong shape, and §9.8 already proved it: a protocol version that returns
`426 Upgrade Required` needs a server that can *decide* something, which raw
PostgREST table access cannot.

**Rule: the client's sync engine calls exactly two server functions, and no
component anywhere calls a Supabase table directly.**

```
sync_pull(workspace_id, since_cursor, protocol_version, limit)
  → { rows, next_cursor, has_more, server_time }
sync_push(workspace_id, protocol_version, entries[])
  → { cursor, server_time, results: [{ entry_id, verdict, reason? }] }
```

Implement them as Postgres functions to start with — they are a `select … where
updated_at > cursor` and a set of column-scoped upserts, and RLS still enforces
the tenancy underneath, so this is not extra security machinery. It is a seam.

Three things fall out of it, each cheap now and unpleasant later:

**1. Pull is paginated from day one.** `limit` and `has_more` in the signature
above, and a client loop that pulls until `has_more` is false before advancing
its stored cursor. At personal scale this never fires — but §9.7 mandates a
**full re-sync** whenever the cursor is older than the 90-day tombstone purge,
and a full re-sync of a busy workspace is exactly the response that falls over.
Pagination added later has to be added to every client version that ever
shipped, and a PWA cannot force an update (§9.8).

**2. Push answers per entry, not per batch.** The `results` array is what makes
§9.1's rejection verdict possible. A batch-level "ok / not ok" cannot say *this
one task was refused and the other eleven were fine*, and that is precisely the
answer a quota or a revoked membership produces (§12.3).

**3. Some tables are pulled but never pushed.** `push_subscriptions` is already
excluded from sync entirely (§4.1), and §4.1 already forbids clients from
pushing server-owned *columns*. The missing category is a server-owned **table**
— plan, entitlements, limits, anything the server asserts and the client only
reads. There are none today. The push handler should nonetheless validate its
entries against an explicit table whitelist rather than accepting whatever
arrives, so that adding the first such table is a one-line change instead of a
security review.

**What this does not mean.** No REST API design exercise, no versioned URL
scheme, no gateway. Two functions, called from one client module (§11.3). The
entire value is that quota checks, rate limiting, audit and version negotiation
have somewhere obvious to go if they are ever needed — and if they never are,
this cost about twenty lines more than the direct-table version.

---

## 10. Reminders

Now a P1 requirement, so it gets a real design rather than a bullet.

**Why this needs a server.** A PWA cannot reliably schedule a local notification
for next Tuesday — there is no guaranteed background timer, and the Notification
Triggers API never shipped to stable. So the server holds the schedule and sends
a push when the moment arrives. The backend already exists for sync, so this is
an increment on top of it, not new infrastructure.

**How it works on Android.** Chrome's push endpoint *is* Firebase Cloud
Messaging. A web push notification and a native Android app's push notification
travel the same pipe, with the same doze-breaking behaviour and the same
delivery characteristics. This is the reason the PWA is viable for a
reminder-dependent app on Android specifically.

### 10.1 Flow

1. **Subscribe.** When the user sets their first reminder (not on page load — permission prompts on load get denied), request notification permission from that tap, then `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`. Store the resulting endpoint and keys in `push_subscriptions` with a human device label.
2. **Schedule.** The task's `reminder_at` is just a column. Nothing else happens at set time.
3. **Dispatch.** A `pg_cron` job runs every minute, selecting tasks where `reminder_at <= now() AND reminder_sent_at IS NULL AND completed_at IS NULL AND deleted_at IS NULL`, and calls an Edge Function that sends Web Push to each of that user's subscriptions with `reminders_enabled = true`. It stamps `reminder_sent_at` in the same transaction.
4. **Display.** The service worker's `push` handler calls `showNotification` with the task title, the project as body, and actions: **Done**, **Snooze 1h**, **Open**.
5. **Act.** The `notificationclick` handler resolves the action. *Done* and *Snooze* write straight to IndexedDB and queue an outbox entry — no window needs to open. *Open* focuses or launches the app at that task.

### 10.2 Details that will bite

- **Subscriptions rot.** Endpoints get rotated and invalidated. Handle the `pushsubscriptionchange` service-worker event, re-validate the subscription on every app launch, and delete any row whose push attempt returns `404` or `410 Gone`.
- **Timing is approximate.** A one-minute cron means reminders land within ~60s of target. Correct for a task app; do not build an alarm clock on it.
- **Delivery needs connectivity.** A local notification fires offline; a push does not. A reminder set for a moment when the phone is in airplane mode arrives when it reconnects, not before.
- **OEM battery management** (Samsung, Xiaomi and friends) can delay notifications. This affects native apps too — arguably less so for web, since Chrome is the host process and rarely gets killed.
- **Deduplicate across devices.** Phone and tablet both receive the push. That is usually correct, but the notification should dismiss on the other device once acted on — use a stable `tag` per task and close it in the `notificationclick` handler.
- **`reminder_sent_at` must be idempotent.** If the Edge Function retries, the stamp is what prevents a double buzz.

### 10.3 Where reminders and offline collide

Both are hard requirements (A2, A3), and they interact badly in two places that
the sections above each quietly assumed away.

**Subscribing requires the network.** §10.1 step 1 calls `pushManager.subscribe()`
at the moment the user sets their first reminder — which fails outright if that
moment happens offline. Treat the subscription as its own piece of durable
state: record the *intent* locally, retry on every reconnect until it succeeds,
and let the user set reminders in the meantime. Never block setting a reminder
on a successful subscribe, and never silently swallow the failure — if it's been
failing for days, say so.

**A reminder set offline can come due before the server ever hears about it.**
Set a reminder for twenty minutes from now, stay offline for an hour, and the
row reaches Postgres with `reminder_at` already in the past. The dispatch query
in §10.1 fires it immediately, so the buzz arrives — but potentially hours late,
which is worse than not arriving. **Drop reminders staler than one hour** rather
than firing them: `reminder_at > now() - interval '1 hour'` in the dispatch
predicate, still stamping `reminder_sent_at` so it doesn't retry forever. The
task remains visibly overdue in Today, which is the honest signal. A 3am buzz
for a 9pm reminder is a bug, not a feature.

---

## 11. Stack decision

### 11.1 Native was considered and rejected

Flutter (and a Capacitor wrapper) were evaluated once the device list settled.
Recording the reasoning so it doesn't get relitigated:

- **Native doesn't reduce the hard part.** Schema, RLS, sync protocol, conflict handling and tombstones are identical in any client language. Native changes only the shell, so it buys nothing against the actual difficulty.
- **The reminder argument evaporated with Android-only mobile.** Local notifications were native's real advantage. But Android web push rides FCM — the same transport — and since Android 12 even native apps need `SCHEDULE_EXACT_ALARM` for exact alarms, with 13/14 restricting `USE_EXACT_ALARM` to genuine clock apps. The gap is far narrower than it looks.
- **The iPad was the other argument, and it's out of scope.** No Apple provisioning, no $99/yr, no annual certificate churn, no Mac in the build loop.
- **Flutter's weakest target would have been the organizing device.** Desktop macOS Flutter works but trails on menu bar, window management and keyboard-first interaction — exactly what the MacBook is for here.
- **One build vs. three release pipelines.** The PWA deploys everywhere at once and updates on refresh. Native means Play Store or sideload, plus a signed macOS bundle, for every change.

**Reversibility:** the backend is client-agnostic. If a native client is ever
wanted, it reuses 100% of the Postgres schema, RLS policies and sync protocol.
The cheapest path at that point is Capacitor around the existing web code, not a
Dart rewrite.

### 11.2 Recommended stack

| Layer | Choice | Why this one |
|---|---|---|
| UI | React + TypeScript + Vite | Boring, fast, huge ecosystem for the pieces below |
| Routing | Hand-rolled over the History API (~60 lines), or `wouter` | Five routes plus notification deep links. React Router rewrote its surface at v5→v6 and again at v6→v7 — the worst churn record in this stack, bought for nothing at this size (§11.3) |
| PWA shell | `vite-plugin-pwa` in **`injectManifest`** mode | You write the service worker — it hosts the §10 push and `notificationclick` handlers regardless — and the plugin's only job is generating the precache file list |
| Styling | Tailwind CSS | Fast iteration on a UI that's mostly density and spacing |
| Drag & drop | `dnd-kit` | Real touch support, accessible, purpose-built rather than a wrapper. Verify its current release cadence at build time — a large rewrite has been in progress |
| Local store | Dexie (IndexedDB) + `dexie-react-hooks` | Live queries mean the UI re-renders from the local DB automatically; this is what makes the "never wait for the network" rule cheap |
| Ordering | `fractional-indexing`, **vendored** | ~100 lines, MIT, effectively frozen — and §9.9 already property-tests it. A vendored copy under your own tests is strictly more robust than a package you upgrade (§4.2) |
| Dates | `Intl` + a ~40-line module | The only real operation is `due_on` + `due_time` + `workspaces.timezone` → instant (§4.1). `Intl.DateTimeFormat` supplies the zone data natively |
| Quick-add parsing | `chrono-node` — P2 only | Returns match spans, which is what makes §5.1's visible, reversible parsing implementable at all |
| Backend | Supabase — Postgres + Auth + Row Level Security + Realtime | RLS is the reason single→team→SaaS is a policy change instead of a rewrite (§12) |
| Sync transport | Two Postgres functions, `sync_pull` / `sync_push` | §9.11 |
| Reminders | `pg_cron` + Edge Function + `web-push` (VAPID) | §10 |
| Hosting | Cloudflare Pages or Vercel (static) + Supabase managed | Free tier covers single-user use comfortably |

Runtime dependencies through P1, in full: `react`, `react-dom`, `dexie`,
`dexie-react-hooks`, `@dnd-kit/*`, `@supabase/supabase-js`, `tailwindcss`.
`chrono-node` joins at P2. Everything else above is either code you own or a
build-time tool, where a breaking change costs an afternoon rather than a
working app.

**Sync is hand-rolled**, roughly 300–400 lines against the design in §9. That's
deliberate: small enough to fully understand and debug, and it avoids betting
the project on a sync framework's roadmap.

**Alternatives**, should hand-rolled sync become tiresome: **PowerSync** or
**ElectricSQL** bolt real offline sync onto the same Postgres; **Triplit** or
**InstantDB** trade lock-in for less work; **self-hosting** Supabase or a small
Fastify + SQLite service is viable if you'd rather own the box.

### 11.3 Dependency policy

A personal tool that has to survive years of use fails from dependency churn
long before it fails from missing features. The stack above is chosen against
that, and the rules below are what keep it that way as it grows.

**The largest anti-churn decision is already made**, and it is §11.2's last
paragraph: sync is hand-rolled. A sync framework is the one dependency that
could not be survived — it sits under every read and write, so abandonment or a
breaking rewrite means a data migration rather than a refactor. 350 lines you
own is a better trade permanently.

**The PWA choice is also a robustness decision, not only a cost one.** §11.1
argued it on effort. The stronger argument is that native Android *mandates*
churn — annual `targetSdk` bumps to remain in the Play Store, Gradle and AGP
upgrades, certificate renewals — while service workers, IndexedDB and Web Push
have been backwards-compatible for a decade. Code written against them in 2019
still runs untouched.

Four rules:

1. **Every risky dependency is imported in exactly one file.** This matters more
   than the dependency count. Supabase behind a single `syncClient.ts` (§9.11
   makes this nearly free — two function calls), `dnd-kit` behind a single
   `<DraggableList>`, Dexie behind the repository layer that §13's P0b
   constraint already mandates. Swapping any of them then costs a day in one
   file instead of an archaeology expedition.
2. **Prefer ~40 lines you own to a package, when it is genuinely ~40 lines.**
   This is why `date-fns` is out, `fractional-indexing` is vendored, and the
   router is hand-rolled. It is emphatically *not* a licence to reimplement
   Dexie or `dnd-kit` — those solve problems that are hard, not verbose.
3. **Lockfile committed, versions pinned exactly, nothing auto-merged.**
   Upgrade deliberately, in batches, when you choose to. Six dependencies on
   autopilot break more often than twelve on a leash.
4. **Isolate the framework from the sync engine.** §9.9 already requires
   reconciliation to be a pure function with no IndexedDB, no fetch and no
   clock. Hold that line specifically because React's effect semantics —
   StrictMode double-invocation, concurrent re-runs — are a real hazard for
   code holding subscriptions, timers and a debounced flush. The engine should
   touch React at exactly one boundary, and sync logic must never be scattered
   across `useEffect` bodies in components.

**Known weak points**, stated rather than discovered later:

- **`dnd-kit`** is the least replaceable client dependency, on the riskiest
  interaction. Rule 1 is the mitigation, along with the fact that list view and
  the non-drag "Move to…" fallback (§8) mean the app still functions if drag
  degrades.
- **Supabase is a platform dependency**, not a package one, and no amount of npm
  discipline touches it. What protects you is that §11.1's reversibility claim
  is real — standard Postgres, standard SQL, standard RLS — plus §9.10's export.
  The exit existing is what makes the dependency acceptable.
- **Vite and Tailwind take majors roughly annually.** Tailwind v4 was a genuine
  migration and is the precedent for what the next one costs.

---

## 12. What to get right on day one for the multi-user future

The expensive part of "single user now, team later" is not the invite screen. It
is that authorization and sync get written assuming one person, and then every
query has to be rewritten. These eight things cost almost nothing now and are
painful to retrofit:

1. **`workspace_id` on every row from the start**, including while there is exactly one workspace.
2. **`workspace_members` exists on day one** with a single row — you, as owner. Adding a teammate must be an `INSERT`, not a migration.
3. **Write RLS policies against membership, never against ownership.** `EXISTS (SELECT 1 FROM workspace_members WHERE …)`, not `owner_id = auth.uid()`. The former already works for teams; the latter has to be rewritten everywhere.
4. **`created_by` and `assignee_id` on tasks from the start.** For now both are always you. The UI can hide them entirely.
5. **Sync pulls changes by workspace, not by user.** The protocol must never assume one person's changes are the only changes.
6. **Soft deletes and tombstones from the start** (§9) — needed for sync regardless, and doubly needed once someone else can delete your things.
7. **No user identity baked into IDs, storage keys, or cache names.** A second user on the same device must not collide.
8. **Leave room for `comments` and `activity`** in the schema's shape — but do not build them.

Everything else about teams — invites, roles, notifications, per-project
sharing, presence — can wait, and should.

### 12.1 The policies, concretely

The whole "single→team is a policy change" claim rests on these actually being
written correctly, so here they are rather than described. Every synced table
gets the same shape:

```sql
create policy "workspace members read"    on tasks for select
  using (workspace_id in (select workspace_id from my_workspaces()));
create policy "workspace members write"   on tasks for all
  using      (workspace_id in (select workspace_id from my_workspaces()))
  with check (workspace_id in (select workspace_id from my_workspaces()));
```

Three traps, each of which is quiet rather than loud:

**1. Do not filter tombstones in the policy.** A policy reading
`... and deleted_at is null` looks tidy and breaks sync completely: the client
stops being told about deletions, so deleted tasks resurrect on every device
forever. Tombstone visibility is the sync protocol's business, never the
security layer's. This one is invisible in single-user testing on one device.

**2. `workspace_members` recurses if you're careless.** A membership policy on
`workspace_members` that queries `workspace_members` is infinite recursion, and
Postgres will say so at query time rather than at definition time. Break it with
a `security definer` function that bypasses RLS:

```sql
create function my_workspaces() returns table (workspace_id uuid)
  language sql security definer stable set search_path = '' as $$
    select workspace_id from public.workspace_members
    where user_id = (select auth.uid())
  $$;
```

**3. Wrap `auth.uid()` in a subselect.** `(select auth.uid())` is evaluated once
as an InitPlan; a bare `auth.uid()` is re-evaluated per row. On a pull returning
a few thousand rows the difference is large and entirely avoidable.

Because RLS is enforced on the pull query itself, the sync endpoint needs no
authorization logic of its own — which is the actual reason this approach makes
teams cheap later.

### 12.2 Indexes the sync engine depends on

Not optional, and easy to forget until pulls get slow with no obvious cause:

- **Every synced table:** `(workspace_id, updated_at)` — this is the pull query's access path, and without it every sync is a sequential scan.
- **`tasks`:** `(workspace_id, due_on)` for Today and Upcoming; `(workspace_id, project_id, section_id)` for project views.
- **Reminder dispatch:** a partial index on `(reminder_at)` `where reminder_sent_at is null and completed_at is null and deleted_at is null` — the cron runs this every minute forever, and the partial predicate keeps it tiny.
- **`workspace_members`:** `(user_id)`, since `my_workspaces()` runs on every policy check.

### 12.3 …and the SaaS future, which needs six more

A8 says a multi-tenant SaaS is plausible rather than planned. The good news is
that §12's eight items are most of the work — a SaaS *is* the team model with
strangers in it, and membership-based RLS already assumes strangers. §9.11's
sync boundary and §9.8's protocol version cover most of the protocol side.

Six things remain, chosen by the same test as §12: near-free now, painful to
retrofit.

1. **The client must never assume there is one workspace.** The protocol already
   pulls by workspace (§12, item 5). The easy mistake is on the client — a Dexie
   schema, a store, or a `useTasks()` hook that quietly hardcodes "the"
   workspace. Keep an explicit *active workspace id* in local state from day
   one, key the sync cursor by workspace, and let the local database hold rows
   for more than one. The UI can still show no workspace switcher at all.
2. **Workspace creation is one server-side transaction, not a sequence of client
   inserts.** Today you create your workspace by hand, once, and it is tempting
   to do it with three `INSERT`s from the app. Signup at scale runs that path
   thousands of times, and a partial failure leaves an orphaned tenant with no
   owner. Write it as a `security definer` function now — workspace, owner
   membership, default project and sections, in one call.
3. **`users` rows come from a trigger on `auth.users`, and email is never a
   key.** The `users` table in §4.1 is the *profile*; Supabase Auth owns
   identity. Populate it by trigger on signup, join on the auth uuid, and treat
   email as a mutable attribute. Emails change, and a schema that joins on them
   is a migration under load later.
4. **Push validates against an explicit table whitelist** (§9.11), so the
   first server-owned table — plan, entitlements, limits — is a one-line
   addition rather than a security review of the push handler.
5. **Cross-tenant isolation is a CI test, not a code review.** For a single user
   an RLS mistake is invisible; for a SaaS it is a data breach. Two workspaces,
   two users, a test asserting that B's session sees exactly zero of A's rows on
   every synced table — and the §12.1 tombstone trap makes this non-obvious,
   since the correct policy deliberately *does* return deleted rows. §9.9
   already establishes the harness habit; this is one more file in it.
6. **The sync engine emits its events through one sink.** Every push result,
   rejection, conflict and full re-sync goes through a single `report(event)`
   function that today does nothing but `console.debug`. Sync problems in a
   SaaS are invisible unless instrumented, and threading telemetry through a
   finished sync engine means touching every branch of the code you least want
   to touch.

**What stays a non-goal**, so this section does not become permission to build a
billing system for one user: billing and plans, roles beyond `owner|member`,
organisation hierarchies, SSO, invite flows, admin impersonation, per-workspace
rate limits, transactional email, multi-region. Every one of them is additive
given the six above plus §12's eight, and none of them is cheaper to build
speculatively than to build when a paying customer exists.

Two things already done that the SaaS version would otherwise have to retrofit,
worth naming because they were built for other reasons: **soft deletes with
tombstones** (§9) double as the deletion audit trail, and **JSON export**
(§9.10) is the beginning of the data-portability story.

---

## 13. Roadmap

The ordering below is deliberate about **risk, not size**. The v0.3 plan built
all of P0's CRUD and then checked whether the PWA installed and felt right on a
phone — which validates the riskiest assumptions last, after the most work is
sunk. Splitting P0 fixes that.

**P0a · Walking skeleton** — The thinnest thing that is genuinely installed and
used. One hardcoded list, add a task, complete a task, stored in Dexie, built
with `vite-plugin-pwa`, deployed to Cloudflare Pages, installed on the phone
from its own home-screen icon. Nothing else — no projects, no board, no drag.

The point is to answer the questions that would invalidate the plan, on day one:
does an installed PWA actually feel like an app on your phone? Is the update
flow tolerable? Does typing a task feel fast enough to beat Google Tasks? If any
answer is no, that is worth knowing before building the other 90%.

Note that "installable" needs the bundle served over HTTPS, so the Cloudflare
deploy exists from the first commit. `localhost` develops fine but will never
let you install on the phone, which is where the judgement has to happen.

**P0b · The real local app** — On the skeleton: projects and sections, full task
CRUD with undo, list ⇄ board toggle, drag-and-drop with touch, checklist items,
labels, Inbox/Today/Upcoming, search. Still no account and no backend — but
every write goes through the repository and outbox layer below. Ends when it's
genuinely pleasant to use on one device.

Do the **touch drag-and-drop spike early inside P0b**, before the board view is
built out. It's the second-riskiest thing in the plan — dragging a card across a
narrow phone screen may simply not be good enough — and if it isn't, board view
becomes tablet-and-desktop-only and a chunk of P0b disappears.

> **Constraint carried by A2:** even with nothing to sync to, every write in P0b
> goes through a repository layer that writes the row and appends an outbox
> entry in one transaction (§9.1), and every row is created with its full sync
> column set (§4.1). P1 then implements a *transport* against an outbox that
> already exists. Skip this and P1 rewrites every write path in the app — which
> is the single most common way local-first projects stall.

**P1 · Sync and reminders** — Supabase project, schema with §4 columns, §12.1
policies and §12.2 indexes, auth (passkey preferred over magic link, since it
needs no inbox access on a new device), the §9 sync engine behind its two RPCs
(§9.11) with its simulation harness (§9.9), realtime invalidation, JSON export
(§9.10), then the §10 reminder pipeline end to end. Ends when a task added on the phone appears on the
MacBook without thought, and a reminder set for tomorrow morning actually
buzzes.

Build the sync engine's pure reconciliation function and its test harness
*before* wiring it to Supabase. It's the one component where a bug loses work
silently, and it's far cheaper to get right against a fake server than against a
real one.

**P2 · Daily-driver polish** — Natural-language quick add, recurring tasks,
Android share target, archive + completed log, per-device reminder toggle, badge
count, keyboard shortcuts, search. Ends when you stop reaching for whatever you
use today.

**P3 · Team** — Invites, assignees, comments, activity feed, per-project sharing,
role checks in the UI. Only start this when a second real person needs in.

---

## 14. Open questions

Resolved: ~~closed-app reminders~~ (required, §10), ~~native vs. web~~ (web,
§11.1), ~~iPad~~ (out of scope, A7), ~~offline editing~~ (hard requirement, §9).

Nothing structural is open. What remains is preference, and none of it blocks P0:

1. **Name.** "Lane" is a placeholder.
2. **Managed or self-hosted?** (A5) Needed at the start of P1, not P0.
3. **Any calendar involvement?** A read-only ICS feed out is cheap; two-way sync is a project of its own and is currently a non-goal.
4. **Import from anywhere?** If tasks currently live in Google Tasks, Todoist, or Trello, a one-time import is worth an afternoon in P1 — and worth knowing now, because it constrains the schema slightly.
5. **How much does the board view matter on the phone?** The tablet is wide enough for it; the phone mostly isn't. The P0b touch-drag spike (§13) answers this empirically rather than by argument, which is why it goes first.
6. **Does the MacBook get reminders too, or only the Android devices?** Cheap either way — `push_subscriptions.reminders_enabled` is per-device — but it changes the default.
7. **How real is the SaaS future?** (A8) §12.3 buys the cheap insurance either way and nothing there is wasted if the answer is "never". But if it becomes a stated goal rather than a possibility, billing, invites and onboarding stop being non-goals, P3 changes shape, and open question 2 above resolves to *managed* — self-hosting a product you sell is a different job from self-hosting a tool you use.

---

## 15. Where to start

The spec has been through three review passes and nothing structural is open.
The first session's work, in order:

1. **`npm create vite@latest`** — React + TypeScript. Add `vite-plugin-pwa` (in `injectManifest` mode, §11.2), Tailwind, Dexie. No router yet — one view doesn't need one.
2. **One hardcoded list.** Add a task, complete a task, persisted in Dexie. No projects, no board, no drag.
3. **Deploy to Cloudflare Pages.** This has to happen on day one — HTTPS is what makes the app installable, and `localhost` will never let you install on the phone.
4. **Install it on your phone** from its own home-screen icon and use it for a day.

That is P0a, and it exists to answer the questions that would invalidate
everything after it: does an installed PWA feel like an app, is the update flow
tolerable, and is typing a task genuinely faster than Google Tasks. Those
answers are worth more than any further refinement of this document.

Three things to carry into P0b so they don't need retrofitting: every write goes
through a repository that emits an outbox entry (§9.1); every row is created
with its full sync column set (§4.1) including a real `workspace_id` from a
variable rather than a constant (§12.3); and every dependency that could churn
is imported in exactly one file (§11.3). Everything else in here can be built
when you reach it.
