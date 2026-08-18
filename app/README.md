# Lane — app

The client. See [`../docs/SPEC.md`](../docs/SPEC.md) for the design; section
numbers in code comments refer to it.

Currently at **P0a — the walking skeleton** (SPEC §13): one hardcoded list, add
a task, complete a task, persisted in IndexedDB, installable, and fully
functional with no network. No projects, no board, no drag, no account, no
sync — those are P0b and P1.

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
npm test         # vitest — the vendored fractional indexing and id property tests
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
    db.ts                   the ONLY file importing Dexie (SPEC §11.3 rule 1)
    repo.ts                 the ONLY write path (SPEC §13 P0b constraint)
  components/               UI
  sw.ts                     hand-written service worker (SPEC §11.2)
```

Two conventions worth keeping, both from SPEC §11.3:

- **Every dependency that could churn is imported in exactly one file.** Dexie
  only in `db.ts`, the PWA plugin's runtime only in `UpdatePrompt.tsx`. When
  Supabase arrives in P1 it goes in one `syncClient.ts` and nowhere else.
- **Nothing writes to the database except `repo.ts`.** P0b adds the outbox
  append inside the transactions already there, and no component changes.
