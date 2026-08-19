# Lane — app

The client. See [`../docs/SPEC.md`](../docs/SPEC.md) for the design; section
numbers in code comments refer to it.

Currently at **P0b slice 3 — projects, sections and the done binding** (SPEC
§13). Real projects now, each with its own sections: create, rename, archive
and switch between them in a drawer that is an overlay on a phone and a pinned
sidebar on a desktop, and the project you were in survives a reload. A task is
a real thing — notes, a due date and time, a priority — and it lives in a
section of a project, which the sheet's two pickers can change. Checking a task
moves it into that project's Done section, collapsed at the foot of the list;
that is SPEC §4's binding, and it is the point of the slice. Anything you do
can be undone. Everything is persisted in IndexedDB, installable, and fully
functional with no network. Every write still records an outbox entry in the
same transaction — but there is no transport draining it yet. That is P1.

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

## Deploying to Cloudflare Pages

SPEC §15 step 3: this has to happen on day one. `localhost` develops fine but
will never let you install on the phone, and the phone is where the judgement
has to happen.

Once, to create the project:

```sh
npx wrangler pages project create lane --production-branch main
```

Then for each deploy:

```sh
npm run build
npx wrangler pages deploy dist --project-name lane
```

Or connect the GitHub repo in the Cloudflare dashboard with build command
`npm run build`, output directory `dist`, and root directory `app`.

`public/_headers` keeps `sw.js` and `index.html` uncached so a new deploy is
actually noticed (SPEC §9.8), while hashed assets are cached forever.

## Layout

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

Two conventions worth keeping, both from SPEC §11.3:

- **Every dependency that could churn is imported in exactly one file.** Dexie
  only in `db.ts`, the PWA plugin's runtime only in `UpdatePrompt.tsx`. When
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
