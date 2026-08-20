# Lane — app

The client. See [`../docs/SPEC.md`](../docs/SPEC.md) for the design; section
numbers in code comments refer to it.

Currently at **P0b slice 5 — Today and Upcoming** (SPEC §13). Two views sit
above the projects now: **Today**, with overdue pinned above what is due today,
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
                 #   repo, grouping, nav, undo, dates)
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
    undo.ts                 the single-step undo store (SPEC §4.5)
    dates.ts                due-date formatting and the overdue predicate
    grouping.ts             tasks into sections, incl. SPEC §4.4's orphan rule
    drag.ts                 where a drop lands (pure; SPEC §8, §13)
    agenda.ts               what is due, and when (pure; SPEC §5)
    db.ts                   the ONLY file importing Dexie (SPEC §11.3 rule 1)
    outbox.ts               the coalescing append (SPEC §9.1)
    repo/                   the ONLY write path (SPEC §13 P0b constraint)
      write.ts              create / write / composite / batch
      positions.ts          where a task lands in a section
      tasks.ts · projects.ts · sections.ts
  components/               UI
    Drawer.tsx              the two views, then the projects
    SectionHeader.tsx       rename, delete, collapse
    DraggableList.tsx       the ONLY file importing dnd-kit (SPEC §11.3 rule 1)
    TaskRow.tsx             one row, shared by both lists
    AgendaList.tsx          Today and Upcoming
    TaskSheet.tsx           the task editor, auto-saving
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
