# Lane — app

The client. See [`../docs/SPEC.md`](../docs/SPEC.md) for the design; section
numbers in code comments refer to it.

Currently at **P0b polish — quiet menus, and the board by default**
(SPEC §13). Rename, delete, archive and recolour moved off the screen and
behind a `…` on the row they belong to: a section header's, a drawer
project's, a drawer label's. They were on screen permanently in aid of
actions used about as often as a project is created, and the project header
had grown to six controls across 390px. A project now opens as a board
unless you have told it otherwise — SPEC §8 rule 6 predicted the phone would
want the list, and a day of using it said otherwise.

Before that, **slice 9b — search filters** (SPEC §13). A field finds a task by any
words you remember from its title or its notes, across every live project —
title matches first, then tasks that matched only in their notes, each showing
the stretch of note that matched. The terms are ANDed rather than matched as
one string, because the words you remember are rarely contiguous. Completed
tasks are findable, since half of why you search is to find what you already
did; archived projects are not. It is a route like Today, listed in the
drawer, and it works with the network off like everything else.

Under the field is a row of chips: four date presets — overdue, today, this
week, no date — then every label, then every project. They combine with the
words by AND, and with each other by the rule that makes sense for the kind:
two projects widen, because a task has exactly one, and two labels narrow,
because a task carries many. A chip is a query on its own, so finding
everything labelled `waiting-on` that is overdue takes no words at all. None
of it persists — the route does, the query does not.

A task carries
cross-project tags: create one by typing its name in the sheet, and every task
row shows what it carries as coloured dots — in the list, on a board card and
in Today and Upcoming alike. Labels are listed in the drawer, and opening one
shows every task carrying it across every project, with rename, recolour and
delete in that view's header. Deleting a task takes its labels with it, and one
undo brings back both.

A task also holds sub-steps: add, tick, rename and delete them in the sheet,
and every task row says how far through them you are — `2/5` next to the due
date. A project is a list or a board, toggled from the header and remembered
per project and per device — the same sections, as headers or as columns, with
Done as the last column you can drag a card into to complete it.

Two views sit above the projects: **Today**, with overdue pinned above what
is due today,
and **Upcoming**, the next seven days grouped by day — both across every
project, each row named with the project it came from, and the view you were in
survives a reload. A ticked row stays where it is rather than vanishing, because
a view shows what is incomplete *or completed today*. Real projects, each with
its own sections: create, rename, archive and switch between them in a drawer
that is an overlay on a phone and a pinned sidebar on a desktop. A task is a
real thing — notes, a due date and time, a priority — and it lives in a section
of a project. Tasks are reordered and moved between sections by dragging the
grip at the right of each row, by touch or by keyboard; the sheet's two pickers
do the same thing without a drag. Checking a task moves it into that project's
Done section, collapsed at the foot of the list — and dropping a task there
completes it, by the same rule read the other way round. That is SPEC §4's
binding, and it is the point of these slices. Anything you do can be undone.
Everything is persisted in IndexedDB, installable, and fully functional with no
network. Every write still records an outbox entry in the same transaction —
but there is no transport draining it yet. That is P1.

P0a exists to answer three questions before the other 90% is built:

1. Does an installed PWA actually feel like an app on the phone?
2. Is the update flow tolerable?
3. Is typing a task genuinely faster than Google Tasks?

## Commands

```sh
npm install
npm run dev      # vite dev server; the service worker is enabled here too
npm run build    # tsc -b && vite build  → dist/
npm run preview  # serve dist/ locally
npm test         # vitest — lib unit tests (ids, order keys, db, migration, outbox,
                 #   repo, grouping, nav, undo, dates, progress, labelling,
                 #   search, filters, menu)
npm run lint     # oxlint
npm run icons    # regenerate public/icon-*.png
```

## Deploying to Cloudflare

SPEC §15 step 3: this has to happen on day one. `localhost` develops fine but
will never let you install on the phone, and the phone is where the judgement
has to happen.

The repo is connected to **Workers Builds** as the project `tcs-task`, so a
push to `main` builds and deploys itself. `wrangler.jsonc` lives here in `app/`
next to `package.json`, and declares a Worker that is nothing but static
assets: no `main`, because there is no server-side code.

The settings that cannot live in the file, because Workers Builds keeps them in
the dashboard (Workers & Pages → `tcs-task` → Settings → Build):

| Setting | Value |
| --- | --- |
| Root directory | `app` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**The root directory is the setting that matters.** Left at `/`, the build
system finds no `package.json`: it detects no Node version, caches no
dependencies, and `npm run build` fails with `ENOENT ... /opt/buildhome/repo/
package.json` before it ever reaches wrangler. Pointed at `app`, everything
else is the default. `dist/` is gitignored, so the deploy uploads what the
build just made rather than anything committed.

**In practice, only `main` goes green.** Every push to a non-production
branch builds at `/` and fails with exactly the `ENOENT` above — an empty
`Detected the following tools from environment:` line and "No dependencies
detected to cache" are the giveaway. This is *not* a repo problem: `app/
package.json` has sat in `app/` since the first commit and no commit ever moved
it, and the same tree builds green on `main`.

Nor is it a setting you have simply missed. Workers Builds shares the root
directory and build command across all branches — only the deploy command
differs (`npx wrangler deploy` on production, `npx wrangler versions upload`
elsewhere) — so a root directory of `app` should apply to branch builds too. It
does not, which points at the preview path rather than at this repo. Until that
changes, read build status on `main` and treat red checks on feature branches as
noise.

The workaround, if preview builds are ever worth having, is to make the shared
build command work from either directory:

```sh
[ -f package.json ] || { cd app && npm ci; }; npm run build
```

From `app/` that is exactly today's behaviour; from `/` it steps into `app`
first. The non-production deploy command then also needs `-c app/wrangler.jsonc`
so wrangler finds its config.

Note too that the dashboard's **Retry build** replays the original build's
configuration snapshot rather than current settings, so retrying after changing
one proves nothing — only a build from a new commit reads what the dashboard
says today.

To deploy by hand — before the dashboard settings are in place, or to push a
build without a commit:

```sh
npm run build
npx wrangler deploy            # from app/, where wrangler.jsonc lives
```

`public/_headers` is honoured by Workers static assets exactly as it was by
Pages: `sw.js`, the shell and the manifest are uncached so a new deploy is
actually noticed (SPEC §9.8), while hashed assets are immutable. Verified
against `wrangler dev`:

```
/                        no-cache
/sw.js                   no-cache
/manifest.webmanifest    no-cache
/assets/index-*.js       public, max-age=31536000, immutable
```

`not_found_handling` is set to `single-page-application`, so a hard refresh on
any path returns the shell rather than a 404 — the app has no router, but the
service worker's scope and the home-screen launch URL still have to resolve.

## Layout

```
src/
  lib/
    ids.ts                  UUIDv7, vendored (SPEC §4.1)
    fractional-indexing.ts  order keys, vendored (SPEC §4.2, §11.2)
    schema.ts               row shapes + the sync column set (SPEC §4.1)
    device.ts               per-device id, no user identity (SPEC §12 item 7)
    workspace.ts            the active workspace (SPEC §12.3 item 1)
    nav.ts                  the open route, persisted (no router)
    view.ts                 list or board, per project, per device (SPEC §4.1)
    menu.ts                 where a … panel goes (pure)
    undo.ts                 the single-step undo store (SPEC §4.5)
    dates.ts                due-date formatting and the overdue predicate
    grouping.ts             tasks into sections, incl. SPEC §4.4's orphan rule
    drag.ts                 where a drop lands (pure; SPEC §8, §13)
    agenda.ts               what is due, and when (pure; SPEC §5)
    progress.ts             how far through a checklist a task is (pure)
    labelling.ts            the palette, and which labels a task carries (pure)
    search.ts               titles and notes, scanned (pure; SPEC §5)
    filters.ts              the chips, as rules (pure; SPEC §4, §4.1)
    useCrossProject.ts      what every cross-project view subscribes to
    db.ts                   the ONLY file importing Dexie (SPEC §11.3 rule 1)
    outbox.ts               the coalescing append (SPEC §9.1)
    repo/                   the ONLY write path (SPEC §13 P0b constraint)
      write.ts              create / write / composite / batch
      positions.ts          where a task lands in a section
      tasks.ts · projects.ts · sections.ts
      checklist.ts          sub-steps on a task (SPEC §4)
      labels.ts             cross-project tags, and the join rows (SPEC §4)
  components/               UI
    Drawer.tsx              the three views, then the projects, then labels
    ProjectRow.tsx          one drawer project, and its …
    LabelRow.tsx            one drawer label, its … and its colours
    Menu.tsx                the … every row hides its actions behind
    SectionHeader.tsx       collapse, and a … holding rename and delete
    DraggableList.tsx       the ONLY file importing dnd-kit (SPEC §11.3 rule 1)
    TaskRow.tsx             one row, shared by both lists
    AgendaList.tsx          Today and Upcoming
    CrossProjectRows.tsx    the rows those three views share
    SearchList.tsx          the field, and what it found
    FilterChips.tsx         project, label and date, under the field
    TaskSheet.tsx           the task editor, auto-saving
    Checklist.tsx           the sheet's sub-steps, live-queried
    LabelPicker.tsx         the sheet's labels, live-queried
    LabelDots.tsx           a row's labels, as colour only
    LabelList.tsx           one label's tasks, across projects
    Toast.tsx               the undo offer and Ctrl+Z
  sw.ts                     hand-written service worker (SPEC §11.2)
```

Two conventions worth keeping, both from SPEC §11.3:

- **Every dependency that could churn is imported in exactly one file.** Dexie
  only in `db.ts`, the PWA plugin's runtime only in `UpdatePrompt.tsx`,
  `dnd-kit` only in `DraggableList.tsx`. When
  Supabase arrives in P1 it goes in one `syncClient.ts` and nowhere else.
- **Nothing writes to the database except `repo/`**, and inside it nothing
  opens a transaction except `write.ts`, whose `create()`, `write()` and
  `batch()` each span the data tables and the outbox in one transaction. P1
  adds a transport that drains the outbox; it does not touch these call sites.

> Checking a task moves it into its project's done section: SPEC §4's binding,
> written once in `moveTaskTo` so the checkbox and the sheet's Section picker
> cannot disagree. `completed_at`, `section_id` and `position` always move
> together.

Every mutation in `repo/` returns the `UndoStep` that reverses it, and the
component that called it pushes that step. Undo is an ordinary new mutation —
it never rewinds the outbox (SPEC §4.5).
